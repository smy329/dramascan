import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { bookmarks } from './schema';

/**
 * The bookmark audience (D-070).
 *
 * A new episode reaches the viewers who bookmarked the drama it belongs to.
 * The bookmarks are the users module's business, so the users module answers
 * the question and nobody else reads the table directly.
 *
 * The read is bounded: a drama with more bookmarks than the bound notifies the
 * first `limit` of them and no more.
 */

/** How many viewers one audience read returns by default. */
export const DEFAULT_BOOKMARK_AUDIENCE_LIMIT = 5000;

/** The largest audience one read may return. */
export const MAX_BOOKMARK_AUDIENCE_LIMIT = 10_000;

/**
 * The identifiers of the viewers who bookmarked a drama.
 *
 * @param dramaId the drama
 * @param limit the maximum number of viewers
 * @param executor the database executor
 * @returns the viewer identifiers
 */
export async function listBookmarkOwnerIds(
  dramaId: string,
  limit: number = DEFAULT_BOOKMARK_AUDIENCE_LIMIT,
  executor: DbExecutor = db
): Promise<string[]> {
  const bounded = Math.max(1, Math.min(Math.trunc(limit), MAX_BOOKMARK_AUDIENCE_LIMIT));

  const rows = await executor
    .select({ userId: bookmarks.user_id })
    .from(bookmarks)
    .where(eq(bookmarks.drama_id, dramaId))
    .limit(bounded);

  return rows.map(row => row.userId);
}
