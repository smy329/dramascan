import 'server-only';

import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { ratings } from './schema';
import { getRatingSummary } from './rating-summary';

/**
 * Rating submission.
 *
 * - If the user has an active (non-deleted) rating for the item, it is updated.
 * - If the user has no active rating, a new one is created.
 * - The database unique index `uq_ratings_user_id_drama_id_active` enforces
 *   one active rating per user per drama; the same holds for movies.
 *
 * The author is always the caller. The writer never accepts an author from the
 * request, so a client cannot rate on somebody else's behalf.
 */

/** The aggregate after a rating was written. */
export type RatingWriteResult = {
  /** The mean score of the item after the write. */
  rating: number;
  /** How many active ratings the mean is based on. */
  count: number;
};

/** Validate the five-point scale before the database constraint catches it. */
function assertRatingValue(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error('Rating value must be an integer between 1 and 5.');
  }
}

/**
 * Submit or update a user's rating for a drama.
 *
 * @param userId The author. It is the authenticated viewer, never a request field.
 * @param dramaId The drama ID to rate.
 * @param value The rating value between 1 and 5.
 * @returns The rating summary after the operation.
 */
export async function submitDramaRating(
  userId: string,
  dramaId: string,
  value: number,
  executor: DbExecutor = db
): Promise<RatingWriteResult> {
  assertRatingValue(value);

  await executor
    .insert(ratings)
    .values({
      user_id: userId,
      drama_id: dramaId,
      value,
    })
    .onConflictDoUpdate({
      // The conflict target is a *partial* unique index. PostgreSQL only infers
      // a partial index when the statement repeats the whole index predicate,
      // and the index is `WHERE deleted_at IS NULL AND drama_id IS NOT NULL`.
      // Repeating only the soft-delete condition is not enough: PostgreSQL
      // requires the statement's predicate to imply the index's predicate, and
      // it does not, so the statement fails with "no unique or exclusion
      // constraint matching the ON CONFLICT specification".
      target: [ratings.user_id, ratings.drama_id],
      targetWhere: and(isNull(ratings.deleted_at), isNotNull(ratings.drama_id)),
      set: {
        value,
        updated_at: sql`now()`,
      },
    });

  const summary = await getRatingSummary('drama', dramaId, executor);

  return { rating: summary?.average ?? 0, count: summary?.count ?? 0 };
}

/**
 * Submit or update a user's rating for a movie.
 *
 * Same logic as `submitDramaRating` but targeting a movie.
 */
export async function submitMovieRating(
  userId: string,
  movieId: string,
  value: number,
  executor: DbExecutor = db
): Promise<RatingWriteResult> {
  assertRatingValue(value);

  await executor
    .insert(ratings)
    .values({
      user_id: userId,
      movie_id: movieId,
      value,
    })
    .onConflictDoUpdate({
      // The movie index is `WHERE deleted_at IS NULL AND movie_id IS NOT NULL`;
      // the whole predicate has to be repeated for PostgreSQL to infer it.
      target: [ratings.user_id, ratings.movie_id],
      targetWhere: and(isNull(ratings.deleted_at), isNotNull(ratings.movie_id)),
      set: {
        value,
        updated_at: sql`now()`,
      },
    });

  const summary = await getRatingSummary('movie', movieId, executor);

  return { rating: summary?.average ?? 0, count: summary?.count ?? 0 };
}

/**
 * Recalculate and return the rating summary for a drama.
 *
 * The aggregate is derived from the stored ratings; it is never a cached
 * number that could drift away from them.
 */
export async function recalculateDramaRatingSummary(
  dramaId: string,
  executor: DbExecutor = db
): Promise<{ average: number; count: number } | null> {
  return getRatingSummary('drama', dramaId, executor);
}

/**
 * Recalculate and return the rating summary for a movie.
 */
export async function recalculateMovieRatingSummary(
  movieId: string,
  executor: DbExecutor = db
): Promise<{ average: number; count: number } | null> {
  return getRatingSummary('movie', movieId, executor);
}

/**
 * The viewer's own active rating of an item, or `null` when they have not
 * rated it.
 *
 * The details page uses this to pre-select the star buttons.
 */
export async function getUserRating(
  userId: string | null,
  type: 'drama' | 'movie',
  id: string,
  executor: DbExecutor = db
): Promise<number | null> {
  if (userId === null) {
    return null;
  }

  const [row] = await executor
    .select({ value: ratings.value })
    .from(ratings)
    .where(
      and(
        eq(ratings.user_id, userId),
        isNull(ratings.deleted_at),
        type === 'drama' ? eq(ratings.drama_id, id) : eq(ratings.movie_id, id)
      )
    )
    .limit(1);

  return row?.value ?? null;
}
