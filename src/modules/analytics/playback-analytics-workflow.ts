import 'server-only';

import { and, count, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';
import { isForeignKeyViolation, isUniqueViolation } from '@/platform/db/errors';

import { playback_analytics_events } from './schema';
import { utcHourBucket } from './date-filters';
import { resolveAnalyticsVisitor, type AnalyticsVisitor } from './visitor';

/**
 * The playback analytics workflow (Prompts 141, 142).
 *
 * The player reports five kinds of event:
 *
 *   - `play`: playback started (the first play of a viewing session).
 *   - `play_pause`: playback started or paused.
 *   - `seek`: the viewer moved to another position.
 *   - `completion`: the viewer reached the completion threshold.
 *   - `exit`: the viewer left the player.
 *
 * Every event carries the watch seconds the viewer accumulated since the
 * previous event they reported. The deltas of a viewing session add up to the
 * time actually watched, and a delta survives an event the bounded write
 * dropped, because the browser computes it from the last event it sent.
 *
 * Writes are bounded. At most one event of each type is stored per visitor,
 * per content item, per hour, so a long session cannot turn the table into a
 * per-second log. The bound is enforced by a partial unique index.
 */

/** The event types the player reports. */
export const PLAYBACK_EVENT_TYPES = [
  'play',
  'play_pause',
  'seek',
  'completion',
  'exit',
] as const;

/** One playback event type. */
export type PlaybackEventType = (typeof PLAYBACK_EVENT_TYPES)[number];

/** What a playback event is about. */
export type PlaybackEventTarget =
  | { type: 'drama'; episodeId: string; dramaId: string }
  | { type: 'movie'; movieId: string };

/** The result of one playback event write. */
export type PlaybackEventResult = {
  /** Whether the event was stored. */
  recorded: boolean;
  /** Whether the event was suppressed because the hour bucket already held it. */
  duplicate: boolean;
  /** The visitor the event was attributed to. */
  visitor: AnalyticsVisitor;
};

/**
 * Record one playback event.
 *
 * @param input the event
 * @param executor the database executor
 * @returns whether the event was stored
 */
export async function recordPlaybackEvent(
  input: {
    target: PlaybackEventTarget;
    eventType: PlaybackEventType;
    positionSeconds?: number | null;
    watchDurationSeconds?: number | null;
    completionThresholdMet?: boolean;
    userId: string | null;
    sessionId: string;
    now?: Date;
  },
  executor: DbExecutor = db
): Promise<PlaybackEventResult> {
  const now = input.now ?? new Date();
  const visitor = await resolveAnalyticsVisitor(
    { userId: input.userId, sessionId: input.sessionId },
    executor
  );

  const contentId = input.target.type === 'drama' ? input.target.episodeId : input.target.movieId;
  const dramaId = input.target.type === 'drama' ? input.target.dramaId : null;
  const movieId = input.target.type === 'movie' ? input.target.movieId : null;
  const episodeId = input.target.type === 'drama' ? input.target.episodeId : null;

  try {
    await executor.insert(playback_analytics_events).values({
      guest_session_id: visitor.guestSessionId,
      content_id: contentId,
      content_type: input.target.type,
      drama_id: dramaId,
      movie_id: movieId,
      episode_id: episodeId,
      event_type: input.eventType,
      position_seconds: input.positionSeconds ?? null,
      watch_duration_seconds: input.watchDurationSeconds ?? null,
      completion_threshold_met: input.completionThresholdMet ?? false,
      event_at: now,
      event_hour_bucket: utcHourBucket(now),
    });

    return { recorded: true, duplicate: false, visitor };
  } catch (error) {
    // The hour bucket already holds an event of this type for this visitor and
    // content item. The bound is the point: the event is dropped, not retried.
    if (isUniqueViolation(error)) {
      return { recorded: false, duplicate: true, visitor };
    }

    // The episode or the film was deleted between the availability check and
    // this insert. The event describes a title that no longer exists, so it is
    // dropped — and the beacon is fire-and-forget, so this is a normal
    // outcome rather than a server error.
    if (isForeignKeyViolation(error)) {
      return { recorded: false, duplicate: false, visitor };
    }

    throw error;
  }
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
      ? eq(playback_analytics_events.drama_id, contentId)
      : eq(playback_analytics_events.movie_id, contentId);

  const [row] = await executor
    .select({
      totalPlaybackEvents: count(),
      completionEvents: sql<number>`count(*) filter (where ${playback_analytics_events.completion_threshold_met})::int`,
      totalWatchDurationSeconds: sql<number>`coalesce(sum(${playback_analytics_events.watch_duration_seconds}), 0)::int`,
    })
    .from(playback_analytics_events)
    .where(
      and(
        eq(playback_analytics_events.content_type, type),
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
