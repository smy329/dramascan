import 'server-only';

import { and, count, eq } from 'drizzle-orm';

import { db } from '@/db/client';

import { bookmarks, playback_progress, watched_state, watch_history } from './schema';

/**
 * User-facing content references that must follow a content identity when it
 * changes type (drama → movie). The `users` module owns these writes; callers
 * pass their transaction so the move is atomic with the conversion.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = Tx | typeof db;

export type ContentReferenceType = 'drama' | 'movie';

export type UserContentReferenceCounts = {
  bookmarks: number;
  playbackProgress: number;
  watchedState: number;
  watchHistory: number;
};

/** Count the bookmark/progress/history rows pointing at one content item. */
export async function countContentReferences(
  tx: DbOrTx,
  type: ContentReferenceType,
  id: string
): Promise<UserContentReferenceCounts> {
  const [[bookmarkRow], [progressRow], [watchedRow], [historyRow]] = await Promise.all([
    tx
      .select({ total: count() })
      .from(bookmarks)
      .where(and(eq(bookmarks.content_type, type), eq(bookmarks.content_id, id))),
    tx
      .select({ total: count() })
      .from(playback_progress)
      .where(
        and(eq(playback_progress.content_type, type), eq(playback_progress.content_id, id))
      ),
    tx
      .select({ total: count() })
      .from(watched_state)
      .where(and(eq(watched_state.content_type, type), eq(watched_state.content_id, id))),
    tx
      .select({ total: count() })
      .from(watch_history)
      .where(and(eq(watch_history.content_type, type), eq(watch_history.content_id, id))),
  ]);

  return {
    bookmarks: Number(bookmarkRow?.total ?? 0),
    playbackProgress: Number(progressRow?.total ?? 0),
    watchedState: Number(watchedRow?.total ?? 0),
    watchHistory: Number(historyRow?.total ?? 0),
  };
}

/**
 * Move every user reference from one content item to another.
 *
 * Playback progress and watched state are current movie-level state, so their
 * episode id is cleared. Watch history keeps the episode id as a historical
 * fact; the episode row itself is soft-deleted, never removed.
 */
export async function moveContentReferences(
  tx: Tx,
  from: { type: ContentReferenceType; id: string },
  to: { type: ContentReferenceType; id: string }
): Promise<void> {
  await tx
    .update(bookmarks)
    .set({ content_type: to.type, content_id: to.id })
    .where(and(eq(bookmarks.content_type, from.type), eq(bookmarks.content_id, from.id)));

  await tx
    .update(playback_progress)
    .set({ content_type: to.type, content_id: to.id, episode_id: null })
    .where(
      and(
        eq(playback_progress.content_type, from.type),
        eq(playback_progress.content_id, from.id)
      )
    );

  await tx
    .update(watched_state)
    .set({ content_type: to.type, content_id: to.id, episode_id: null })
    .where(and(eq(watched_state.content_type, from.type), eq(watched_state.content_id, from.id)));

  await tx
    .update(watch_history)
    .set({ content_type: to.type, content_id: to.id })
    .where(
      and(eq(watch_history.content_type, from.type), eq(watch_history.content_id, from.id))
    );
}
