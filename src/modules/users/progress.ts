import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requireUser, type ActorContext } from '@/modules/authorization';
import { getEpisodeContentReference } from '@/modules/content';
import { serverConfig } from '@/platform/config';
import type { DbExecutor } from '@/platform/db/executor';
import { AuthenticationError, NotFoundError } from '@/platform/errors';

import { playback_progress, watched_state } from './schema';
import { parsePlaybackProgressInput } from './validation';

/**
 * Playback-progress persistence.
 *
 * A viewer's position is a resume point, not a log: one row per user and
 * episode, updated in place. The write therefore upserts; it never appends.
 *
 * Two rules make the write safe:
 *
 *  - **An older observation never overwrites a newer one.** The browser sends
 *    the moment it observed the position. The server clamps that moment to its
 *    own clock — a timestamp from the future is never stored — and ignores an
 *    update that is not newer than the stored one. Two tabs or two devices
 *    reporting at the same time therefore converge on the newer observation,
 *    whichever request arrives last.
 *  - **The watched state is sticky.** Once the completion threshold has been
 *    reached, the episode stays watched until an administrator replaces the
 *    video source, which resets it explicitly. The first completion date is
 *    preserved.
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
  /** Whether the episode counts as watched. */
  thresholdMet: boolean;
};

/** Options for a progress write. */
export type PlaybackProgressSaveOptions = {
  /** Transaction handle to run in; defaults to the pool. */
  executor?: DbExecutor;
  /** The server clock; defaults to the current time. */
  now?: Date;
};

/**
 * Store the playback position of an episode for a signed-in viewer.
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

  const values = parsePlaybackProgressInput(input);
  const executor = options.executor ?? db;
  const now = options.now ?? new Date();

  const reference = await getEpisodeContentReference(values.episodeId, executor);

  if (!reference) {
    throw new NotFoundError('Episode not found.');
  }

  const { dramaId } = reference;

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
    .where(
      and(
        eq(playback_progress.user_id, userId),
        eq(playback_progress.episode_id, values.episodeId)
      )
    )
    .limit(1);

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
    .where(
      and(
        eq(watched_state.user_id, userId),
        eq(watched_state.episode_id, values.episodeId)
      )
    )
    .limit(1);

  const alreadyCompleted = storedWatched?.thresholdMet === true;
  const completed = alreadyCompleted || thresholdMet;

  await executor
    .insert(playback_progress)
    .values({
      user_id: userId,
      content_type: 'drama',
      content_id: dramaId,
      drama_id: dramaId,
      episode_id: values.episodeId,
      position: positionSeconds,
      duration: values.durationSeconds,
      last_watched_at: watchedAt,
      completed,
    })
    .onConflictDoUpdate({
      target: [playback_progress.user_id, playback_progress.episode_id],
      targetWhere: sql`${playback_progress.episode_id} is not null`,
      set: {
        content_type: 'drama',
        content_id: dramaId,
        drama_id: dramaId,
        episode_id: values.episodeId,
        position: positionSeconds,
        duration: values.durationSeconds,
        last_watched_at: watchedAt,
        completed,
      },
    });

  await executor
    .insert(watched_state)
    .values({
      user_id: userId,
      content_type: 'drama',
      content_id: dramaId,
      drama_id: dramaId,
      episode_id: values.episodeId,
      watched_minutes: Math.max(
        storedWatched?.watchedMinutes ?? 0,
        Math.floor(positionSeconds / 60)
      ),
      threshold_met: completed,
      last_watched_at: watchedAt,
      completed_at: storedWatched?.completedAt ?? (completed ? now : null),
    })
    .onConflictDoUpdate({
      target: [watched_state.user_id, watched_state.episode_id],
      targetWhere: sql`${watched_state.episode_id} is not null`,
      set: {
        content_type: 'drama',
        content_id: dramaId,
        drama_id: dramaId,
        episode_id: values.episodeId,
        watched_minutes: Math.max(
          storedWatched?.watchedMinutes ?? 0,
          Math.floor(positionSeconds / 60)
        ),
        threshold_met: completed,
        last_watched_at: watchedAt,
        completed_at: storedWatched?.completedAt ?? (completed ? now : null),
      },
    });

  return {
    applied: true,
    positionSeconds,
    durationSeconds: values.durationSeconds,
    thresholdMet: completed,
  };
}
