import 'server-only';

import { eq, sql, gte, lte } from 'drizzle-orm';

import { db } from '@/db/client';

import { ratings } from './schema';

/**
 * Submit or update a user's rating for a drama.
 *
 * - If the user has an active (non-deleted) rating for the drama, it is updated.
 * - If the user has no active rating, a new one is created.
 * - The database unique index `uq_ratings_user_id_drama_id_active` enforces
 *   one active rating per user per drama.
 *
 * @param dramaId The drama ID to rate.
 * @param value The rating value between 1 and 5.
 * @returns The rating summary after the operation.
 */
export async function submitDramaRating(dramaId: string, value: number): Promise<{ rating: number; count: number }> {
  // Validate range at the application level before the DB constraint catches it.
  if (value < 1 || value > 5) {
    throw new Error('Rating value must be between 1 and 5.');
  }

  // Try to upsert: update existing active rating, or insert a new one.
  // We use a single query with a conditional insert/update pattern.
  const result = await db
    .insert(ratings)
    .values({
      user_id: '', // will be replaced by the caller via session
      drama_id: dramaId,
      value,
      // created_at and updated_at use defaultNow()
    })
    .onConflictDoUpdate({
      // Conflict on the active unique index (user_id + drama_id where deleted_at IS NULL)
      target: 'uq_ratings_user_id_drama_id_active',
      set: {
        value,
        updated_at: sql`now()`,
      },
    })
    .returning({
      value: ratings.value,
    });

  const insertedValue = result[0]?.value ?? value;

  // Compute the new average and count.
  const [summary] = await db
    .select({
      average: sql`avg(${ratings.value})`,
      count: count(),
    })
    .from(ratings)
    .where(
      and(
        isNull(ratings.deleted_at),
        eq(ratings.drama_id, dramaId)
      )
    );

  const total = Number(summary?.count ?? 0);
  const average = total > 0 ? Number(summary?.average ?? 0) : 0;

  return { rating: average, count: total };
}

/**
 * Submit or update a user's rating for a movie.
 *
 * Same logic as `submitDramaRating` but targeting a movie.
 */
export async function submitMovieRating(movieId: string, value: number): Promise<{ rating: number; count: number }> {
  if (value < 1 || value > 5) {
    throw new Error('Rating value must be between 1 and 5.');
  }

  const result = await db
    .insert(ratings)
    .values({
      user_id: '',
      movie_id: movieId,
      value,
    })
    .onConflictDoUpdate({
      target: 'uq_ratings_user_id_movie_id_active',
      set: {
        value,
        updated_at: sql`now()`,
      },
    })
    .returning({
      value: ratings.value,
    });

  const insertedValue = result[0]?.value ?? value;

  const [summary] = await db
    .select({
      average: sql`avg(${ratings.value})`,
      count: count(),
    })
    .from(ratings)
    .where(
      and(
        isNull(ratings.deleted_at),
        eq(ratings.movie_id, movieId)
      )
    );

  const total = Number(summary?.count ?? 0);
  const average = total > 0 ? Number(summary?.average ?? 0) : 0;

  return { rating: average, count: total };
}

/**
 * Recalculate and return the rating summary for a drama.
 */
export async function recalculateDramaRatingSummary(dramaId: string): Promise<{ average: number; count: number } | null> {
  const [row] = await db
    .select({
      average: sql`avg(${ratings.value})`,
      count: count(),
    })
    .from(ratings)
    .where(
      and(
        isNull(ratings.deleted_at),
        eq(ratings.drama_id, dramaId)
      )
    );

  const total = Number(row?.count ?? 0);

  if (total === 0) {
    return null;
  }

  return {
    average: Number(row?.average ?? 0),
    count: total,
  };
}

/**
 * Recalculate and return the rating summary for a movie.
 */
export async function recalculateMovieRatingSummary(movieId: string): Promise<{ average: number; count: number } | null> {
  const [row] = await db
    .select({
      average: sql`avg(${ratings.value})`,
      count: count(),
    })
    .from(ratings)
    .where(
      and(
        isNull(ratings.deleted_at),
        eq(ratings.movie_id, movieId)
      )
    );

  const total = Number(row?.count ?? 0);

  if (total === 0) {
    return null;
  }

  return {
    average: Number(row?.average ?? 0),
    count: total,
  };
}