import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';

import { review_reactions } from './schema';

/**
 * Toggle an "Enjoying" reaction on a review.
 *
 * - If the user has not yet reacted, a new reaction row is created.
 * - If the user has already reacted, the existing row is deleted (toggle off).
 * - The uniqueness constraint `uq_review_reactions_user_id_review_id` makes this
 *   idempotent: reacting twice is the same as not reacting.
 *
 * @param reviewId The review ID to react to.
 * @param actorUserId The authenticated user's ID.
 * @returns The current enjoyment count and whether the user is currently enjoying.
 */
export async function toggleReviewEnjoying(reviewId: string, actorUserId: string): Promise<{ enjoying: boolean; count: number }> {
  // Use a try/catch with raw SQL to handle the upsert toggle.
  // PostgreSQL unique index on (user_id, review_id) will throw a violation
  // if we try to insert a duplicate, at which point we delete the existing row.
  try {
    await db.insert(review_reactions).values({
      user_id: actorUserId,
      review_id: reviewId,
    }).execute();
  } catch {
    // Unique constraint violation: the user already reacted → remove it.
    await db.delete(review_reactions).where(
      and(
        eq(review_reactions.user_id, actorUserId),
        eq(review_reactions.review_id, reviewId)
      )
    ).execute();
  }

  // Count total reactions for this review
  const [{ count }] = await db
    .select({ count: sql`count(*)` })
    .from(review_reactions)
    .where(eq(review_reactions.review_id, reviewId));

  // Check if the user's reaction row exists after the toggle
  const [row] = await db
    .select({ id: review_reactions.id })
    .from(review_reactions)
    .where(
      and(
        eq(review_reactions.user_id, actorUserId),
        eq(review_reactions.review_id, reviewId)
      )
    )
    .limit(1);

  const enjoying = row.id !== undefined;
  return { enjoying, count: Number(count) };
}