import 'server-only';

import { count, eq } from 'drizzle-orm';

import { db } from '@/db/client';

import { ratings, reviews } from './schema';

/**
 * Ratings and reviews follow a drama when it becomes a movie. The `reviews`
 * module owns these writes; the conversion passes its transaction so the
 * reassignment is atomic.
 *
 * `review_reactions` and `review_reports` reference `review_id` only, so they
 * follow their review automatically and are never rewritten here.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = Tx | typeof db;

export type ReviewContentReferenceCounts = {
  ratings: number;
  reviews: number;
};

/** Count the rating and review rows attached to a drama. */
export async function countContentReferences(
  tx: DbOrTx,
  dramaId: string
): Promise<ReviewContentReferenceCounts> {
  const [[ratingRow], [reviewRow]] = await Promise.all([
    tx.select({ total: count() }).from(ratings).where(eq(ratings.drama_id, dramaId)),
    tx.select({ total: count() }).from(reviews).where(eq(reviews.drama_id, dramaId)),
  ]);

  return {
    ratings: Number(ratingRow?.total ?? 0),
    reviews: Number(reviewRow?.total ?? 0),
  };
}

/**
 * Move every rating and review from the drama to the movie.
 *
 * The exactly-one CHECK constraint is satisfied in the same statement: the
 * movie target is set and the drama target cleared. Soft-deleted ratings move
 * too, preserving moderation/history state.
 */
export async function moveContentReferences(
  tx: Tx,
  dramaId: string,
  movieId: string
): Promise<void> {
  await tx
    .update(ratings)
    .set({ movie_id: movieId, drama_id: null })
    .where(eq(ratings.drama_id, dramaId));

  await tx
    .update(reviews)
    .set({ movie_id: movieId, drama_id: null })
    .where(eq(reviews.drama_id, dramaId));
}
