import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { episodes } from './schema';

/**
 * Episode content references.
 *
 * A viewer's progress row points at the drama an episode belongs to, because
 * the progress table stores a drama reference beside the episode reference.
 * The mapping belongs to the content module — it owns the episode hierarchy —
 * so every other module resolves it here instead of reading the episode table
 * directly.
 */

/** The drama an episode belongs to. */
export type EpisodeContentReference = {
  episodeId: string;
  dramaId: string;
};

/**
 * Resolve the drama of an episode.
 *
 * Returns `null` when the episode does not exist or has been moved to the
 * Trash: a trashed episode is not something a viewer can make progress in.
 *
 * @param episodeId The episode to resolve.
 * @param executor  Transaction handle to run in; defaults to the pool.
 */
export async function getEpisodeContentReference(
  episodeId: string,
  executor: DbExecutor = db
): Promise<EpisodeContentReference | null> {
  const [row] = await executor
    .select({ id: episodes.id, dramaId: episodes.drama_id })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), isNull(episodes.deleted_at)))
    .limit(1);

  if (!row) {
    return null;
  }

  return { episodeId: row.id, dramaId: row.dramaId };
}
