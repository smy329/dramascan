import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requireUser, type ActorContext } from '@/modules/authorization';
import { getPublicEpisodeContentReference } from '@/modules/content';
import type { DbExecutor } from '@/platform/db/executor';
import { NotFoundError } from '@/platform/errors';

import { playback_progress, watched_state } from './schema';

/**
 * Episode watch-state reset.
 *
 * Replacing an episode's video source invalidates every viewer's playback
 * position: the stored position refers to a file that is no longer served.
 * The reset therefore puts the position back to the beginning and marks the
 * episode unwatched for everybody.
 *
 * The watch *history* is deliberately not touched. History is the record of
 * what somebody watched and when; replacing a source does not rewrite the
 * past, and the historical dates have to survive.
 *
 * The service takes an optional executor so a caller can run the reset inside
 * its own transaction. A source replacement has to update the episode, reset
 * the watch state, and write the operational record as one unit: a partially
 * applied replacement would leave viewers with a reset position but no audit
 * trail, or an audit trail for a source that was never changed.
 */

/** What the reset changed. */
export type EpisodeWatchStateResetResult = {
  /** Number of playback-progress rows that were reset. */
  progressRows: number;
  /** Number of watched-state rows that were cleared. */
  watchedRows: number;
};

/**
 * Reset every viewer's progress and watched state for one episode.
 *
 * @param episodeId Episode whose watch state is reset.
 * @param executor  Transaction handle to run in; defaults to the pool.
 */
export async function resetEpisodeWatchState(
  episodeId: string,
  executor: DbExecutor = db
): Promise<EpisodeWatchStateResetResult> {
  const progress = await executor
    .update(playback_progress)
    .set({
      position: 0,
      completed: false,
    })
    .where(eq(playback_progress.episode_id, episodeId))
    .returning({ id: playback_progress.id });

  const watched = await executor
    .update(watched_state)
    .set({
      watched_minutes: 0,
      threshold_met: false,
      completed_at: null,
      completed_at_reset_at: new Date(),
    })
    .where(eq(watched_state.episode_id, episodeId))
    .returning({ id: watched_state.id });

  return {
    progressRows: progress.length,
    watchedRows: watched.length,
  };
}

/** Options for a manual watched-state change. */
export type SetEpisodeWatchedStateOptions = {
  /** Transaction handle to run in; defaults to the pool. */
  executor?: DbExecutor;
  /** The server clock; defaults to the current time. */
  now?: Date;
};

/** What a manual watched-state change did. */
export type SetEpisodeWatchedStateResult = {
  watched: boolean;
};

/**
 * Mark one episode watched or unwatched for a signed-in viewer.
 *
 * The episode is validated by the content module first, so a guessed id of a
 * draft or trashed episode cannot create a personal record.
 *
 * Marking unwatched also returns the stored position to the beginning. Leaving
 * the position at the end would be inconsistent with the viewer's decision: the
 * very next playback heartbeat would satisfy the completion threshold and mark
 * the episode watched again. The two rows therefore move together, which is
 * what keeps the state consistent across devices.
 *
 * The first completion date is never rewritten. Marking an episode unwatched
 * clears the current state and records when it was reset; the moment the
 * episode was first completed is kept, so a later re-watch restores that date
 * instead of inventing a new one.
 *
 * @param actor     The viewer; resolved from the session by the caller.
 * @param episodeId The episode to change.
 * @param watched   The desired state.
 * @param options   The transaction handle and the clock.
 */
export async function setEpisodeWatchedState(
  actor: ActorContext,
  episodeId: string,
  watched: boolean,
  options: SetEpisodeWatchedStateOptions = {}
): Promise<SetEpisodeWatchedStateResult> {
  const { userId } = requireUser(actor);

  if (userId === null) {
    throw new NotFoundError('Episode not found.');
  }

  const now = options.now ?? new Date();

  // The read and the write run in one transaction, so the row lock below
  // really holds until the decision is stored.
  if (options.executor) {
    return writeEpisodeWatchedState(userId, episodeId, watched, options.executor, now);
  }

  return db.transaction(tx => writeEpisodeWatchedState(userId, episodeId, watched, tx, now));
}

/** The write itself; see `setEpisodeWatchedState` for the rules it applies. */
async function writeEpisodeWatchedState(
  userId: string,
  episodeId: string,
  watched: boolean,
  executor: DbExecutor,
  now: Date
): Promise<SetEpisodeWatchedStateResult> {
  const reference = await getPublicEpisodeContentReference(episodeId, executor);

  if (!reference) {
    throw new NotFoundError('Episode not found.');
  }

  const columns = {
    content_type: 'drama' as const,
    content_id: reference.dramaId,
    drama_id: reference.dramaId,
    movie_id: null,
    episode_id: episodeId,
  };

  // The two rows are locked in the same order as the progress write locks
  // them: the progress row first, the watched-state row second. Two paths
  // that touch the same rows in the same order cannot deadlock.
  await executor
    .select({ id: playback_progress.id })
    .from(playback_progress)
    .where(
      and(
        eq(playback_progress.user_id, userId),
        eq(playback_progress.episode_id, episodeId)
      )
    )
    .limit(1)
    // The row is locked until the transaction ends, so a playback report that
    // arrives at the same moment cannot write over the decision.
    .for('update');

  const [existing] = await executor
    .select({ completedAt: watched_state.completed_at })
    .from(watched_state)
    .where(
      and(
        eq(watched_state.user_id, userId),
        eq(watched_state.episode_id, episodeId)
      )
    )
    .limit(1)
    // The same lock as the progress row: the watched state and the position
    // are one decision and must not be read from two different snapshots.
    .for('update');

  // The first completion date is preserved: a later manual change does not
  // rewrite the moment the episode was first completed. It is only set for the
  // first time here, when the episode has never been completed before.
  const completedAt = existing?.completedAt ?? (watched ? now : null);

  // The two rows are written in the same order as the progress write writes
  // them: the progress row first, the watched-state row second. A row that
  // does not exist yet is inserted, and an inserted row takes a lock too, so
  // the write order has to match the lock order.
  if (watched) {
    // A progress row keeps the manual decision visible to the watch page and
    // the details page even when the viewer never played the episode.
    await executor
      .insert(playback_progress)
      .values({
        user_id: userId,
        ...columns,
        position: 0,
        duration: 0,
        last_watched_at: now,
        completed: true,
      })
      .onConflictDoUpdate({
        target: [playback_progress.user_id, playback_progress.episode_id],
        targetWhere: sql`${playback_progress.episode_id} is not null`,
        set: { completed: true },
      });
  } else {
    await executor
      .update(playback_progress)
      .set({
        completed: false,
        position: 0,
        // The observation time moves on with the decision: a playback report
        // that was already in flight describes the position from before this
        // decision, so it is stale and is ignored.
        last_watched_at: now,
      })
      .where(
        and(
          eq(playback_progress.user_id, userId),
          eq(playback_progress.episode_id, episodeId)
        )
      );
  }

  await executor
    .insert(watched_state)
    .values({
      user_id: userId,
      ...columns,
      watched_minutes: 0,
      threshold_met: watched,
      last_watched_at: now,
      completed_at: completedAt,
      completed_at_reset_at: watched ? null : now,
    })
    .onConflictDoUpdate({
      target: [watched_state.user_id, watched_state.episode_id],
      targetWhere: sql`${watched_state.episode_id} is not null`,
      set: {
        ...columns,
        threshold_met: watched,
        // The observation time moves on with the decision: a playback report
        // that was already in flight describes the position from before this
        // decision, so it is stale and is ignored.
        last_watched_at: now,
        completed_at: completedAt,
        completed_at_reset_at: watched ? null : now,
      },
    });

  return { watched };
}
