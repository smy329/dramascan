import 'server-only';

import { desc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { watch_history } from './schema';

/**
 * Read model for the viewer's own watch history.
 *
 * The history is append-only: the same episode may appear several times,
 * because each viewing session is a record. The read never updates a row.
 */

/** One recorded viewing session. */
export type WatchHistoryItem = {
  id: string;
  contentType: 'drama' | 'movie';
  contentId: string;
  /** Set when the session watched an episode of a drama. */
  episodeId: string | null;
  /** When the session happened. */
  watchedAt: Date;
  /** Total minutes watched in this session. */
  watchDuration: number | null;
};

/**
 * The viewer's watch history, most recent first.
 *
 * The row limit bounds the query: the page shows a recent slice, and the
 * history itself is never truncated in the database.
 */
export async function listWatchHistoryItems(
  userId: string | null,
  limit = 50,
  executor: DbExecutor = db
): Promise<WatchHistoryItem[]> {
  if (userId === null) {
    return [];
  }

  const rows = await executor
    .select({
      id: watch_history.id,
      contentType: watch_history.content_type,
      contentId: watch_history.content_id,
      episodeId: watch_history.episode_id,
      watchedAt: watch_history.watched_at,
      watchDuration: watch_history.watch_duration,
    })
    .from(watch_history)
    .where(eq(watch_history.user_id, userId))
    .orderBy(desc(watch_history.watched_at), desc(watch_history.id))
    .limit(Math.max(1, Math.min(limit, 200)));

  return rows.map(row => ({
    id: row.id,
    contentType: row.contentType === 'movie' ? 'movie' : 'drama',
    contentId: row.contentId,
    episodeId: row.episodeId,
    watchedAt: row.watchedAt,
    watchDuration: row.watchDuration,
  }));
}
