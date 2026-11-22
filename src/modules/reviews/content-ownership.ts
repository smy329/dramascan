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
  // The queries run one after the other: a transaction uses a single
  // PostgreSQL connection, and the driver does not accept two queries on the
  // same connection at the same time.
  const [ratingRow] = await tx
    .select({ total: count() })
    .from(ratings)
    .where(eq(ratings.drama_id, dramaId));
  const [reviewRow] = await tx
    .select({ total: count() })
    .from(reviews)
    .where(eq(reviews.drama_id, dramaId));

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

/**
 * Detach a rating and a review from a content item that is being permanently
 * deleted, and remove the author identity.
 *
 * The rows themselves are retained: the rating value and the review text stay
 * available for aggregate analytics. What is removed is the link to the
 * deleted content and the link to the user who wrote them.
 *
 * The statement sets the target columns and `user_id` to null and stamps
 * `anonymized_at` in the same update, so the exactly-one target CHECK is
 * satisfied by the new row state and never sees an intermediate violation.
 */
export async function anonymizeContentReferences(
  tx: Tx,
  type: 'drama' | 'movie',
  id: string
): Promise<ReviewContentReferenceCounts> {
  const now = new Date();

  const ratingRows = await tx
    .update(ratings)
    .set({ user_id: null, anonymized_at: now, drama_id: null, movie_id: null })
    .where(type === 'drama' ? eq(ratings.drama_id, id) : eq(ratings.movie_id, id))
    .returning({ id: ratings.id });

  const reviewRows = await tx
    .update(reviews)
    .set({ user_id: null, anonymized_at: now, drama_id: null, movie_id: null })
    .where(type === 'drama' ? eq(reviews.drama_id, id) : eq(reviews.movie_id, id))
    .returning({ id: reviews.id });

  return {
    ratings: ratingRows.length,
    reviews: reviewRows.length,
  };
}
