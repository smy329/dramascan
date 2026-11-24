import 'server-only';

import { and, count, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { review_reactions } from './schema';

/**
 * The "Enjoying" reaction on a review.
 *
 * - One reaction per viewer per review. The unique index
 *   `uq_review_reactions_user_id_review_id` makes the reaction idempotent:
 *   reacting twice is the same as not reacting.
 * - The toggle is implemented as "delete, then insert if nothing was deleted".
 *   The earlier implementation caught every insert error and treated it as a
 *   duplicate, which silently turned a foreign-key violation, a dropped
 *   connection, or a permission failure into a successful toggle-off. The
 *   delete-first form has no such failure mode: only the delete and the
 *   insert can fail, and both fail loudly.
 */

/** The reaction state after a toggle. */
export type ReviewReactionState = {
  /** Whether the viewer is currently enjoying the review. */
  enjoying: boolean;
  /** How many viewers enjoy the review. */
  count: number;
};

/**
 * Toggle the viewer's "Enjoying" reaction on a review.
 *
 * @param reviewId The review to react to.
 * @param viewerUserId The authenticated viewer.
 * @returns The reaction state and the new enjoyment count.
 */
export async function toggleReviewEnjoying(
  reviewId: string,
  viewerUserId: string,
  executor: DbExecutor = db
): Promise<ReviewReactionState> {
  const deleted = await executor
    .delete(review_reactions)
    .where(
      and(
        eq(review_reactions.user_id, viewerUserId),
        eq(review_reactions.review_id, reviewId)
      )
    )
    .returning({ id: review_reactions.id });

  const enjoying = deleted.length === 0;

  if (enjoying) {
    // `onConflictDoNothing` keeps a concurrent double-tap from failing the
    // request: the reaction still exists exactly once.
    await executor
      .insert(review_reactions)
      .values({ user_id: viewerUserId, review_id: reviewId })
      .onConflictDoNothing();
  }

  const [countRow] = await executor
    .select({ total: count() })
    .from(review_reactions)
    .where(eq(review_reactions.review_id, reviewId));

  return {
    enjoying,
    count: Number(countRow?.total ?? 0),
  };
}

/**
 * The number of "Enjoying" reactions on a review.
 */
export async function getReviewEnjoyingCount(
  reviewId: string,
  executor: DbExecutor = db
): Promise<number> {
  const [row] = await executor
    .select({ total: count() })
    .from(review_reactions)
    .where(eq(review_reactions.review_id, reviewId));

  return Number(row?.total ?? 0);
}
