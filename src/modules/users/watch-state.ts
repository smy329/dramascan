import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

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
