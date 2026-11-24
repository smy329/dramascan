import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { requireUser, type ActorContext } from '@/modules/authorization';
import { getBookmarkableContentTarget } from '@/modules/content';
import { NotFoundError } from '@/platform/errors';

import { bookmarks } from './schema';

/**
 * Drama- and movie-level bookmarks.
 *
 * A viewer keeps one personal list. A bookmark names exactly one content item,
 * and the same public availability rules that gate the detail page gate the
 * bookmark write: a bookmark for a draft, trashed, or otherwise unavailable
 * item would be a personal record that can never be opened, so it is refused.
 *
 * The target is validated by the content module. This service never reads the
 * content tables itself, so the bookmark list cannot drift away from what the
 * public pages actually expose.
 */

/** The content item a bookmark names. */
export type BookmarkTarget = {
  type: 'drama' | 'movie';
  id: string;
};

/** One row of a viewer's personal list. */
export type UserBookmark = {
  id: string;
  type: 'drama' | 'movie';
  contentId: string;
};

/**
 * The viewer's personal list, most recently added first.
 *
 * The rows carry only the target. Whether the target is still publicly
 * available is decided by the content module, so the list cannot drift away
 * from what the public pages actually expose.
 */
export async function listUserBookmarks(actor: ActorContext): Promise<UserBookmark[]> {
  if (actor.userId === null) {
    return [];
  }

  const rows = await db
    .select({
      id: bookmarks.id,
      contentType: bookmarks.content_type,
      contentId: bookmarks.content_id,
      dramaId: bookmarks.drama_id,
      movieId: bookmarks.movie_id,
    })
    .from(bookmarks)
    .where(eq(bookmarks.user_id, actor.userId))
    .orderBy(desc(bookmarks.id));

  return rows.map(row => ({
    id: row.id,
    type: row.dramaId ? 'drama' : 'movie',
    contentId: row.dramaId ?? row.movieId ?? row.contentId,
  }));
}

/** The partial unique index that protects one bookmark per user and target. */
function bookmarkTargetWhere(userId: string, target: BookmarkTarget) {
  return and(
    eq(bookmarks.user_id, userId),
    target.type === 'drama'
      ? eq(bookmarks.drama_id, target.id)
      : eq(bookmarks.movie_id, target.id)
  );
}

/**
 * Is the item on the viewer's list?
 *
 * An anonymous viewer has no list, so the answer is `false` rather than an
 * error: the detail page can render the bookmark control for guests without
 * a separate branch.
 */
export async function isBookmarked(
  actor: ActorContext,
  target: BookmarkTarget
): Promise<boolean> {
  if (actor.userId === null) {
    return false;
  }

  const [row] = await db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(bookmarkTargetWhere(actor.userId, target))
    .limit(1);

  return row !== undefined;
}

/**
 * Add or remove a bookmark.
 *
 * The target is re-validated against public availability on every call, so a
 * client cannot bookmark content it cannot open. The write is idempotent at the
 * database level: the partial unique index keeps one row per user and target.
 *
 * @returns `bookmarked` — the state after the call.
 */
export async function toggleBookmark(
  actor: ActorContext,
  target: BookmarkTarget
): Promise<{ bookmarked: boolean }> {
  const { userId } = requireUser(actor);

  if (userId === null) {
    throw new NotFoundError('Content not found.');
  }

  const validated = await getBookmarkableContentTarget(target.type, target.id);

  if (!validated) {
    throw new NotFoundError('Content not found.');
  }

  const [existing] = await db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(bookmarkTargetWhere(userId, target))
    .limit(1);

  if (existing) {
    await db.delete(bookmarks).where(eq(bookmarks.id, existing.id));

    return { bookmarked: false };
  }

  await db
    .insert(bookmarks)
    .values({
      user_id: userId,
      content_type: target.type,
      content_id: target.id,
      drama_id: target.type === 'drama' ? target.id : null,
      movie_id: target.type === 'movie' ? target.id : null,
    })
    .onConflictDoNothing();

  return { bookmarked: true };
}
