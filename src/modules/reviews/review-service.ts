import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';

import { reviews } from './schema';

/**
 * Submit or update a user's review for a drama.
 *
 * - If the user has an active (non-deleted) review for the drama, it is updated.
 * - If the user has no active review, a new one is created.
 * - The database unique index `uq_reviews_user_id_drama_id` enforces
 *   one active review per user per drama.
 * - `created_at` is preserved on updates (set via defaultNow, never overridden).
 * - `updated_at` is updated to `now()` on every write.
 *
 * @param dramaId The drama ID to review.
 * @param title The review title.
 * @param content The review content.
 * @returns The review that was created or updated.
 */
export async function submitDramaReview(
  dramaId: string,
  title: string,
  content: string
) {
  const [row] = await db
    .insert(reviews)
    .values({
      user_id: '', // will be replaced by the caller via session context
      drama_id: dramaId,
      title,
      content,
      // created_at uses defaultNow; updated_at uses defaultNow
    })
    .onConflictDoUpdate({
      target: [reviews.user_id, reviews.drama_id],
      set: {
        title,
        content,
        updated_at: sql`now()`,
      },
    })
    .returning({
      id: reviews.id,
      user_id: reviews.user_id,
      drama_id: reviews.drama_id,
      title: reviews.title,
      content: reviews.content,
      created_at: reviews.created_at,
      updated_at: reviews.updated_at,
    });

  return row;
}

/**
 * Submit or update a user's review for a movie.
 *
 * Same logic as `submitDramaReview` but targeting a movie.
 */
export async function submitMovieReview(
  movieId: string,
  title: string,
  content: string
) {
  const [row] = await db
    .insert(reviews)
    .values({
      user_id: '',
      movie_id: movieId,
      title,
      content,
    })
    .onConflictDoUpdate({
      target: [reviews.user_id, reviews.movie_id],
      set: {
        title,
        content,
        updated_at: sql`now()`,
      },
    })
    .returning({
      id: reviews.id,
      user_id: reviews.user_id,
      movie_id: reviews.movie_id,
      title: reviews.title,
      content: reviews.content,
      created_at: reviews.created_at,
      updated_at: reviews.updated_at,
    });

  return row;
}

/**
 * Recalculate and return the review count summary for a drama.
 * Reviews have no soft delete: all rows are permanent.
 */
export async function recalculateDramaReviewSummary(dramaId: string): Promise<{ count: number } | null> {
  const [row] = await db
    .select({ count: sql`count(*)` })
    .from(reviews)
    .where(eq(reviews.drama_id, dramaId));

  const total = Number(row?.count ?? 0);

  if (total === 0) {
    return null;
  }

  return { count: total };
}

/**
 * Recalculate and return the review count summary for a movie.
 * Reviews have no soft delete: all rows are permanent.
 */
export async function recalculateMovieReviewSummary(movieId: string): Promise<{ count: number } | null> {
  const [row] = await db
    .select({ count: sql`count(*)` })
    .from(reviews)
    .where(eq(reviews.movie_id, movieId));

  const total = Number(row?.count ?? 0);

  if (total === 0) {
    return null;
  }

  return { count: total };
}