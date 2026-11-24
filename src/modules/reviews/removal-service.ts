import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import type { DbExecutor } from '@/platform/db/executor';
import { NotFoundError } from '@/platform/errors';

import { review_reactions, reviews } from './schema';

/**
 * Permanent removal of a review.
 *
 * Removal is a moderator action and it is permanent: there is no trash, no
 * restore, and no soft-delete column on `reviews`. A viewer cannot delete
 * their own review.
 *
 * The reports filed against the review are moderation history. They are not
 * deleted with it: the foreign key is `ON DELETE SET NULL`, so the report row
 * survives with its immutable `review_id_snapshot`.
 */

/** The review that was removed. */
export type RemovedReview = {
  id: string;
  authorId: string | null;
  dramaId: string | null;
  movieId: string | null;
  title: string | null;
  content: string;
};

/**
 * Permanently remove a review.
 *
 * @param actor The moderator. The service checks `review.manage` itself.
 * @param reviewId The review to remove.
 * @returns The removed review, so the caller can record an audit entry.
 */
export async function removeReview(
  actor: ActorContext,
  reviewId: string,
  executor: DbExecutor = db
): Promise<RemovedReview> {
  requirePermission(actor, 'review.manage');

  const [row] = await executor
    .delete(reviews)
    .where(eq(reviews.id, reviewId))
    .returning({
      id: reviews.id,
      authorId: reviews.user_id,
      dramaId: reviews.drama_id,
      movieId: reviews.movie_id,
      title: reviews.title,
      content: reviews.content,
    });

  if (!row) {
    throw new NotFoundError('The review no longer exists.');
  }

  // The reaction rows cascade with the review, but a review that was removed
  // before the cascade was declared would leave them behind. The delete above
  // already cascaded; this statement is a safety net for databases where the
  // cascade has not been applied yet.
  await executor.delete(review_reactions).where(eq(review_reactions.review_id, reviewId));

  return row;
}
