import 'server-only';

import { and, count, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';
import { isForeignKeyViolation, isUniqueViolation } from '@/platform/db/errors';

import { playback_analytics_events, playback_viewing_sessions } from './schema';
import { utcHourBucket } from './date-filters';
import {
  PLAYBACK_EVENT_TYPES,
  type PlaybackEventTarget,
  type PlaybackEventType,
} from './playback-events.shared';
import {
  clampPlaybackPosition,
  isCompletionSupported,
  resolvePlaybackWatchSeconds,
} from './playback-plausibility';
import {
  playbackContentIdExpression,
  playbackTargetIdExpression,
  playbackTargetTypeExpression,
} from './typed-targets';
import { analyticsViewerType } from './viewer-types';
import { resolveAnalyticsVisitor, type AnalyticsVisitor } from './visitor';

/**
 * The playback analytics workflow (Prompts 141, 142, D-090).
 *
 * The player reports five kinds of event:
 *
 *   - `play`: playback started (the first play of a viewing session).
 *   - `play_pause`: playback started or paused.
 *   - `seek`: the viewer moved to another position.
 *   - `completion`: the viewer reached the completion threshold.
 *   - `exit`: the viewer left the player.
 *
 * Every event carries the **cumulative** watch seconds the viewer accumulated
 * since the start of the viewing session, and the key of that session. The
 * server keeps the cumulative watch time it has already accounted for, in a
 * viewing-session row of its own, so it decides what a claim is worth:
 *
 *   - The first beacon of a session is measured against the moment the server
 *     stamped, so it cannot claim a watch time it did not earn.
 *   - A repeated claim is a delta of zero, so an event whose acknowledgement
 *     was lost cannot count its watch time twice.
 *   - Two tabs are two sessions, so one tab cannot reset the baseline of the
 *     other.
 *
 * Writes are bounded. At most one event of each type is stored per visitor,
 * per content item, per hour, so a long session cannot turn the table into a
 * per-second log. The bound is enforced by a partial unique index.
 */

/**
 * The event types the player reports.
 *
 * The catalogue itself lives in a shared file, because the player reports the
 * same events from the browser (D-085).
 */
export { PLAYBACK_EVENT_TYPES };

/** One playback event type. */
export type { PlaybackEventType };

/** What a playback event is about. */
export type { PlaybackEventTarget };

/**
 * The session key used when a beacon carries none.
 *
 * The contract requires a key, so this only guards a caller that reaches the
 * module without the contract.
 */
export const DEFAULT_CLIENT_SESSION_KEY = 'default';

/** The result of one playback event write. */
export type PlaybackEventResult = {
  /** Whether the event was stored. */
  recorded: boolean;
  /** Whether the event was suppressed because the hour bucket already held it. */
  duplicate: boolean;
  /** The visitor the event was attributed to. */
  visitor: AnalyticsVisitor;
  /**
   * The cumulative watch seconds the server has accounted for.
   *
   * The browser uses it to know which part of its claim the server already
   * counted, so a dropped event does not lose its watch time and a repeated
   * claim is recognised as a repetition.
   */
  accountedWatchSeconds: number;
};

/**
 * Record one playback event.
 *
 * The beacon is public, so the server decides what it may claim: the watch
 * time is the part of the cumulative claim the server has not accounted for
 * yet, bounded by the time that really passed since the last stored event of
 * the viewing session, and an impossible media position is dropped (D-070,
 * D-090).
 *
 * @param input the event
 * @returns whether the event was stored
 */
export async function recordPlaybackEvent(input: {
  target: PlaybackEventTarget;
  eventType: PlaybackEventType;
  positionSeconds?: number | null;
  cumulativeWatchSeconds?: number | null;
  clientSessionKey?: string | null;
  completionThresholdMet?: boolean;
  userId: string | null;
  sessionId: string;
  now?: Date;
}): Promise<PlaybackEventResult> {
  const now = input.now ?? new Date();
  const visitor = await resolveAnalyticsVisitor({
    userId: input.userId,
    sessionId: input.sessionId,
  });

  const episodeId = input.target.type === 'drama' ? input.target.episodeId : null;
  const movieId = input.target.type === 'movie' ? input.target.movieId : null;
  const dramaId = input.target.type === 'drama' ? input.target.dramaId : null;

  // The event is about one episode or one movie; the viewing session is about
  // the title they belong to.
  const contentId = input.target.type === 'drama' ? input.target.episodeId : input.target.movieId;
  const titleId = input.target.type === 'drama' ? input.target.dramaId : input.target.movieId;
  const clientSessionKey = normalizeClientSessionKey(input.clientSessionKey);

  // The baseline of the session, read inside the transaction. The catch
  // clauses below need it when the write is refused.
  let accountedWatchSeconds = 0;

  try {
    // The session row is created before the event is written, so an event the
    // bounded write drops does not take the baseline of the session with it.
    await ensureViewingSession({
      guestSessionId: visitor.guestSessionId,
      titleId,
      contentType: input.target.type,
      dramaId,
      movieId,
      clientSessionKey,
      now,
    });

    return await db.transaction(async tx => {
      const session = await lockViewingSession(tx, {
        guestSessionId: visitor.guestSessionId,
        titleId,
        clientSessionKey,
      });

      accountedWatchSeconds = session.accountedCumulativeSeconds;

      const watch = resolvePlaybackWatchSeconds({
        cumulativeWatchSeconds: input.cumulativeWatchSeconds,
        accountedCumulativeSeconds: session.accountedCumulativeSeconds,
        lastEventAt: session.lastEventAt,
        startedAt: session.startedAt,
        now,
      });

      // A completion is a claim about a viewing, so the viewer's own watch history
      // has to support it. The rule is only consulted for a completion claim, so
      // the ordinary playback event pays nothing for it (D-073).
      const completionSupported =
        input.eventType === 'completion' && input.completionThresholdMet === true
          ? await isCompletionSupportedByHistory(
              visitor.guestSessionId,
              contentId,
              watch.watchDurationSeconds,
              tx
            )
          : false;

      await tx.insert(playback_analytics_events).values({
        guest_session_id: visitor.guestSessionId,
        viewer_type: analyticsViewerType(input.userId),
        content_id: contentId,
        content_type: input.target.type,
        drama_id: dramaId,
        movie_id: movieId,
        episode_id: episodeId,
        event_type: input.eventType,
        position_seconds: clampPlaybackPosition(input.positionSeconds),
        watch_duration_seconds: watch.watchDurationSeconds,
        // The completion flag is honoured on a completion event only, and only
        // when the viewer's own watch history supports the claim. The validation
        // contract enforces the event type, and the write enforces the history,
        // so no caller of this module can record a completion that did not
        // happen (D-070, D-073).
        completion_threshold_met: completionSupported,
        event_at: now,
        event_hour_bucket: utcHourBucket(now),
      });

      // The baseline only advances when the row was written. An event the
      // bounded write dropped leaves its watch time to the next event, and a
      // claim that went backwards restarts the session.
      await tx
        .update(playback_viewing_sessions)
        .set({
          last_cumulative_watch_seconds: watch.accountedCumulativeSeconds,
          last_event_at: now,
          updated_at: now,
        })
        .where(eq(playback_viewing_sessions.id, session.id));

      return {
        recorded: true,
        duplicate: false,
        visitor,
        accountedWatchSeconds: watch.accountedCumulativeSeconds,
      };
    });
  } catch (error) {
    // The hour bucket already holds an event of this type for this visitor and
    // content item. The bound is the point: the event is dropped, not retried.
    if (isUniqueViolation(error)) {
      return { recorded: false, duplicate: true, visitor, accountedWatchSeconds };
    }

    // The episode or the film was deleted between the availability check and
    // this insert. The event describes a title that no longer exists, so it is
    // dropped — and the beacon is fire-and-forget, so this is a normal
    // outcome rather than a server error.
    if (isForeignKeyViolation(error)) {
      return { recorded: false, duplicate: false, visitor, accountedWatchSeconds };
    }

    throw error;
  }
}

/**
 * The viewing session of a visitor, created when it does not exist yet.
 *
 * The session row is the server's own baseline of the viewing: it carries the
 * moment the server stamped, the moment it stored the last event, and the
 * cumulative watch time it has accounted for.
 *
 * The row is created outside the transaction of the event, so an event the
 * bounded write drops does not take the baseline of the session with it: the
 * watch time the dropped event carried is measured against the last stored
 * event, not against a session that starts again.
 *
 * @param input the visitor, the title, and the session key
 */
async function ensureViewingSession(input: {
  guestSessionId: string;
  titleId: string;
  contentType: 'drama' | 'movie';
  dramaId: string | null;
  movieId: string | null;
  clientSessionKey: string;
  now: Date;
}): Promise<void> {
  await db
    .insert(playback_viewing_sessions)
    .values({
      guest_session_id: input.guestSessionId,
      content_id: input.titleId,
      content_type: input.contentType,
      drama_id: input.dramaId,
      movie_id: input.movieId,
      client_session_key: input.clientSessionKey,
      started_at: input.now,
    })
    .onConflictDoNothing({
      target: [
        playback_viewing_sessions.guest_session_id,
        playback_viewing_sessions.content_id,
        playback_viewing_sessions.client_session_key,
      ],
      where: sql`${playback_viewing_sessions.deleted_at} IS NULL`,
    });
}

/**
 * The baseline of the viewing session, locked for the rest of the transaction.
 *
 * Two events of the same session cannot both read the same baseline: the
 * second one waits for the first one to write its delta.
 *
 * @param executor the transaction
 * @param input the visitor, the title, and the session key
 * @returns the baseline of the session
 */
async function lockViewingSession(
  executor: DbExecutor,
  input: {
    guestSessionId: string;
    titleId: string;
    clientSessionKey: string;
  }
): Promise<{
  id: string;
  startedAt: Date;
  lastEventAt: Date | null;
  accountedCumulativeSeconds: number;
}> {
  const [row] = await executor
    .select({
      id: playback_viewing_sessions.id,
      startedAt: playback_viewing_sessions.started_at,
      lastEventAt: playback_viewing_sessions.last_event_at,
      accountedCumulativeSeconds: playback_viewing_sessions.last_cumulative_watch_seconds,
    })
    .from(playback_viewing_sessions)
    .where(
      and(
        eq(playback_viewing_sessions.guest_session_id, input.guestSessionId),
        eq(playback_viewing_sessions.content_id, input.titleId),
        eq(playback_viewing_sessions.client_session_key, input.clientSessionKey),
        isNull(playback_viewing_sessions.deleted_at)
      )
    )
    .for('update')
    .limit(1);

  if (!row) {
    throw new Error('The viewing session could not be created.');
  }

  return row;
}

/**
 * Does the viewer's own watch history support a completion claim?
 *
 * The history is the server's own record: the playback starts it stored and
 * the watch durations it accepted. The watch duration of the completion event
 * itself is added, because that event carries the watch time the browser
 * accumulated since the previous event the server stored.
 *
 * @param guestSessionId the visitor
 * @param contentId the episode or movie
 * @param currentWatchSeconds the accepted watch time of this event
 * @param executor the database executor
 * @returns whether the completion may be counted
 */
async function isCompletionSupportedByHistory(
  guestSessionId: string,
  contentId: string,
  currentWatchSeconds: number,
  executor: DbExecutor
): Promise<boolean> {
  const [row] = await executor
    .select({
      playbackStarts: sql<number>`count(*) filter (where ${playback_analytics_events.event_type} = 'play')::int`,
      watchSeconds: sql<number>`coalesce(sum(${playback_analytics_events.watch_duration_seconds}), 0)::int`,
    })
    .from(playback_analytics_events)
    .where(
      and(
        eq(playback_analytics_events.guest_session_id, guestSessionId),
        // The typed content decides which episode or movie the history belongs
        // to (D-032 §4, D-082).
        sql`${playbackContentIdExpression} = ${contentId}`,
        isNull(playback_analytics_events.deleted_at)
      )
    );

  return isCompletionSupported({
    hasPlaybackStart: Number(row?.playbackStarts ?? 0) > 0,
    cumulativeWatchSeconds: Number(row?.watchSeconds ?? 0) + currentWatchSeconds,
  });
}

/**
 * The playback summary of a content item.
 *
 * The summary is read from the raw events, so it is available immediately.
 * The watch duration is the sum of the per-event deltas: every event carries
 * the watch seconds the viewer accumulated since the previous event it
 * reported, so the events of a viewing session add up to the time actually
 * watched.
 */
export async function getPlaybackAnalyticsSummary(
  type: 'drama' | 'movie',
  contentId: string,
  executor: DbExecutor = db
): Promise<{
  totalPlaybackEvents: number;
  completionEvents: number;
  totalWatchDurationSeconds: number;
}> {
  const targetFilter =
    type === 'drama'
      ? sql`${playbackTargetTypeExpression} = 'drama' and ${playbackTargetIdExpression} = ${contentId}`
      : sql`${playbackTargetTypeExpression} = 'movie' and ${playbackTargetIdExpression} = ${contentId}`;

  const [row] = await executor
    .select({
      totalPlaybackEvents: count(),
      completionEvents: sql<number>`count(*) filter (where ${playback_analytics_events.completion_threshold_met})::int`,
      totalWatchDurationSeconds: sql<number>`coalesce(sum(${playback_analytics_events.watch_duration_seconds}), 0)::int`,
    })
    .from(playback_analytics_events)
    .where(
      and(
        // The typed target decides which title a row belongs to, so the
        // summary and the grouping of the dashboard cannot disagree about it
        // (D-032 §4, D-082).
        targetFilter,
        isNull(playback_analytics_events.deleted_at)
      )
    );

  return {
    totalPlaybackEvents: Number(row?.totalPlaybackEvents ?? 0),
    completionEvents: Number(row?.completionEvents ?? 0),
    totalWatchDurationSeconds: Number(row?.totalWatchDurationSeconds ?? 0),
  };
}

/**
 * The session key of a beacon.
 *
 * @param clientSessionKey the key the beacon carries
 * @returns the key, or the default one
 */
function normalizeClientSessionKey(clientSessionKey: string | null | undefined): string {
  if (typeof clientSessionKey !== 'string') {
    return DEFAULT_CLIENT_SESSION_KEY;
  }

  const trimmed = clientSessionKey.trim();

  if (trimmed.length === 0) {
    return DEFAULT_CLIENT_SESSION_KEY;
  }

  return trimmed.slice(0, 128);
}
