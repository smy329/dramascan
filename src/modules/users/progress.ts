import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requireUser, type ActorContext } from '@/modules/authorization';
import { getMovieContentReference, getPublicEpisodeContentReference } from '@/modules/content';
import { serverConfig } from '@/platform/config';
import type { DbExecutor } from '@/platform/db/executor';
import { AuthenticationError, NotFoundError, ValidationError } from '@/platform/errors';

import { playback_progress, watched_state } from './schema';
import { parsePlaybackProgressInput } from './validation';

/**
 * Playback-progress persistence.
 *
 * A viewer's position is a resume point, not a log: one row per user and
 * episode (or per user and movie), updated in place. The write therefore
 * upserts; it never appends.
 *
 * Three rules make the write safe:
 *
 *  - **An older observation never overwrites a newer one.** The browser sends
 *    the moment it observed the position. The server clamps that moment to its
 *    own clock — a timestamp from the future is never stored — and ignores an
 *    update that is not newer than the stored one. The rule is enforced by the
 *    database, not by the read that precedes the write: the two target rows are
 *    locked for the duration of the transaction, and the upsert itself carries
 *    the condition. Two tabs or two devices reporting at the same time
 *    therefore converge on the newer observation, whichever request arrives
 *    last — and a request that arrives late can no longer undo a newer one.
 *  - **A position never crosses a source replacement.** The browser sends the
 *    version of the source it was watching. When an administrator replaces the
 *    source, the version moves on and every stored position is reset; a report
 *    that was already in flight still carries the old version, and it describes
 *    a position in a file that is no longer served. Such a report is ignored.
 *  - **The watched state is sticky.** Once the completion threshold has been
 *    reached, the episode stays watched until an administrator replaces the
 *    video source or the viewer marks it unwatched explicitly. The first
 *    completion date is preserved.
 *
 * The watch *history* is not written here. History is append-only and belongs
 * to the watch-history feature; writing a row on every progress update would
 * duplicate history for every debounce tick.
 */

/** What a progress write did. */
export type PlaybackProgressSaveResult = {
  /** False when the update was older than the stored one and was ignored. */
  applied: boolean;
  /** The position that is stored after the call. */
  positionSeconds: number;
  /** The duration that is stored after the call. */
  durationSeconds: number;
  /** Whether the item counts as watched. */
  thresholdMet: boolean;
};

/** Options for a progress write. */
export type PlaybackProgressSaveOptions = {
  /** Transaction handle to run in; defaults to the pool. */
  executor?: DbExecutor;
  /** The server clock; defaults to the current time. */
  now?: Date;
};

/** The content item a progress row belongs to. */
type ProgressTarget =
  | { kind: 'episode'; episodeId: string; dramaId: string }
  | { kind: 'movie'; movieId: string };

function progressTargetWhere(userId: string, target: ProgressTarget) {
  return and(
    eq(playback_progress.user_id, userId),
    target.kind === 'episode'
      ? eq(playback_progress.episode_id, target.episodeId)
      : eq(playback_progress.movie_id, target.movieId)
  );
}

function watchedTargetWhere(userId: string, target: ProgressTarget) {
  return and(
    eq(watched_state.user_id, userId),
    target.kind === 'episode'
      ? eq(watched_state.episode_id, target.episodeId)
      : eq(watched_state.movie_id, target.movieId)
  );
}

/** The target columns shared by both progress rows and watched-state rows. */
function targetColumns(target: ProgressTarget): {
  content_type: 'drama' | 'movie';
  content_id: string;
  drama_id: string | null;
  movie_id: string | null;
  episode_id: string | null;
} {
  return target.kind === 'episode'
    ? {
        content_type: 'drama',
        content_id: target.dramaId,
        drama_id: target.dramaId,
        movie_id: null,
        episode_id: target.episodeId,
      }
    : {
        content_type: 'movie',
        content_id: target.movieId,
        drama_id: null,
        movie_id: target.movieId,
        episode_id: null,
      };
}

/**
 * Store the playback position of an episode or a movie for a signed-in viewer.
 *
 * @param actor   The viewer; resolved from the session by the caller.
 * @param input   The observed position, duration, and observation time.
 * @param options The transaction handle and the clock.
 */
export async function savePlaybackProgress(
  actor: ActorContext,
  input: unknown,
  options: PlaybackProgressSaveOptions = {}
): Promise<PlaybackProgressSaveResult> {
  const { userId } = requireUser(actor);

  if (userId === null) {
    // `requireUser` already rejects an anonymous actor; this keeps the type
    // narrow without a cast.
    throw new AuthenticationError('Authentication required.');
  }

  const now = options.now ?? new Date();

  // The read and the write have to run in the same transaction: the row locks
  // below only hold until the transaction ends. A caller that already owns a
  // transaction passes its handle in, and nothing is nested.
  if (options.executor) {
    return writePlaybackProgress(userId, input, options.executor, now);
  }

  return db.transaction(tx => writePlaybackProgress(userId, input, tx, now));
}

/**
 * The write itself.
 *
 * The two target rows are locked before they are read. That makes the
 * staleness decision and the write one atomic step: a second request for the
 * same viewer and episode waits for the first one to finish and then sees the
 * row the first one wrote, instead of a snapshot that is already outdated.
 */
async function writePlaybackProgress(
  userId: string,
  input: unknown,
  executor: DbExecutor,
  now: Date
): Promise<PlaybackProgressSaveResult> {
  const values = parsePlaybackProgressInput(input);

  let target: ProgressTarget;

  if (values.movieId !== undefined) {
    const reference = await getMovieContentReference(values.movieId, executor);

    if (!reference) {
      throw new NotFoundError('Movie not found.');
    }

    target = { kind: 'movie', movieId: reference.movieId };
  } else {
    const episodeId = values.episodeId;

    if (episodeId === undefined) {
      throw new ValidationError('Invalid playback progress.', {
        episodeId: ['An episode or a movie is required.'],
      });
    }

    const reference = await getPublicEpisodeContentReference(episodeId, executor);

    if (!reference) {
      throw new NotFoundError('Episode not found.');
    }

    // A position that belongs to a replaced source describes a file that is no
    // longer served. The report is ignored: applying it would move the viewer
    // into the middle of a different video, and would undo the reset the
    // replacement performed.
    if (values.sourceVersion !== reference.sourceVersion) {
      const [stored] = await executor
        .select({
          position: playback_progress.position,
          duration: playback_progress.duration,
          completed: playback_progress.completed,
        })
        .from(playback_progress)
        .where(
          and(
            eq(playback_progress.user_id, userId),
            eq(playback_progress.episode_id, episodeId)
          )
        )
        .limit(1);

      return {
        applied: false,
        positionSeconds: stored?.position ?? 0,
        durationSeconds: stored?.duration ?? 0,
        thresholdMet: stored?.completed === true,
      };
    }

    target = { kind: 'episode', episodeId, dramaId: reference.dramaId };
  }

  // A position beyond the end of the media means the duration was reported
  // late or incorrectly; the media itself is the authority.
  const positionSeconds =
    values.durationSeconds > 0
      ? Math.min(values.positionSeconds, values.durationSeconds)
      : values.positionSeconds;

  // The observation time is the client's, clamped to the server clock: a
  // timestamp from the future is never stored, so a device with a fast clock
  // cannot lock itself out.
  const watchedAt =
    values.watchedAt.getTime() <= now.getTime() ? values.watchedAt : now;

  const [storedProgress] = await executor
    .select({
      position: playback_progress.position,
      duration: playback_progress.duration,
      completed: playback_progress.completed,
      lastWatchedAt: playback_progress.last_watched_at,
    })
    .from(playback_progress)
    .where(progressTargetWhere(userId, target))
    .limit(1)
    // The row is locked until the transaction ends, so a second request for
    // the same viewer and episode waits here instead of deciding on a
    // snapshot that the first request is about to replace.
    .for('update');

  if (storedProgress && storedProgress.lastWatchedAt.getTime() >= watchedAt.getTime()) {
    // The stored observation is newer: this update is stale and is ignored.
    return {
      applied: false,
      positionSeconds: storedProgress.position ?? 0,
      durationSeconds: storedProgress.duration ?? 0,
      thresholdMet: storedProgress.completed === true,
    };
  }

  const thresholdPercent = serverConfig.playbackCompletionThresholdPercent;
  const thresholdMet =
    values.durationSeconds > 0 && positionSeconds >= values.durationSeconds * thresholdPercent / 100;

  const [storedWatched] = await executor
    .select({
      watchedMinutes: watched_state.watched_minutes,
      thresholdMet: watched_state.threshold_met,
      completedAt: watched_state.completed_at,
    })
    .from(watched_state)
    .where(watchedTargetWhere(userId, target))
    .limit(1)
    // The same lock as the progress row: the watched state and the position
    // are one decision and must not be read from two different snapshots.
    .for('update');

  const alreadyCompleted = storedWatched?.thresholdMet === true;
  const completed = alreadyCompleted || thresholdMet;

  const watchedMinutes = Math.max(
    storedWatched?.watchedMinutes ?? 0,
    Math.floor(positionSeconds / 60)
  );
  const completedAt = storedWatched?.completedAt ?? (completed ? now : null);
  const columns = targetColumns(target);

  await executor
    .insert(playback_progress)
    .values({
      user_id: userId,
      ...columns,
      position: positionSeconds,
      duration: values.durationSeconds,
      last_watched_at: watchedAt,
      completed,
    })
    .onConflictDoUpdate({
      target:
        target.kind === 'episode'
          ? [playback_progress.user_id, playback_progress.episode_id]
          : [playback_progress.user_id, playback_progress.movie_id],
      targetWhere:
        target.kind === 'episode'
          ? sql`${playback_progress.episode_id} is not null`
          : sql`${playback_progress.movie_id} is not null`,
      set: {
        ...columns,
        position: positionSeconds,
        duration: values.durationSeconds,
        last_watched_at: watchedAt,
        completed,
      },
      // The condition is the database's own guarantee that an older
      // observation never overwrites a newer one: the update only happens
      // when the stored row is not newer than the incoming one.
      setWhere: sql`${playback_progress.last_watched_at} <= excluded.last_watched_at`,
    });

  await executor
    .insert(watched_state)
    .values({
      user_id: userId,
      ...columns,
      watched_minutes: watchedMinutes,
      threshold_met: completed,
      last_watched_at: watchedAt,
      completed_at: completedAt,
    })
    .onConflictDoUpdate({
      target:
        target.kind === 'episode'
          ? [watched_state.user_id, watched_state.episode_id]
          : [watched_state.user_id, watched_state.movie_id],
      targetWhere:
        target.kind === 'episode'
          ? sql`${watched_state.episode_id} is not null`
          : sql`${watched_state.movie_id} is not null`,
      set: {
        ...columns,
        watched_minutes: watchedMinutes,
        threshold_met: completed,
        last_watched_at: watchedAt,
        completed_at: completedAt,
      },
      // The watched state follows the same monotonic rule as the position.
      setWhere: sql`${watched_state.last_watched_at} <= excluded.last_watched_at`,
    });

  return {
    applied: true,
    positionSeconds,
    durationSeconds: values.durationSeconds,
    thresholdMet: completed,
  };
}
