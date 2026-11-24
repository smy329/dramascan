import 'server-only';

import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { getUserDisplayNames } from '@/modules/auth';
import type { DbExecutor } from '@/platform/db/executor';

import { ratings, review_reactions, reviews } from './schema';
import { reviewSortSchema, type ReviewSort } from './validation';

/**
 * Written reviews for a drama or a standalone movie.
 *
 * - One review per user per content item. The partial unique indexes
 *   `uq_reviews_user_id_drama_id` and `uq_reviews_user_id_movie_id` enforce it
 *   in the database.
 * - `created_at` is preserved on an edit; `updated_at` records the last change.
 * - A reviewer cannot delete their own review: removal is a moderator action
 *   and it is permanent.
 * - The author is always the caller. The writer never accepts an author from
 *   the request, so a client cannot review on somebody else's behalf.
 *
 * Reviews have no soft-delete column. A row that is gone is gone, which is why
 * the removal path is a moderator-only operation and why the read models below
 * never filter on a `deleted_at` column that does not exist.
 */

/** A review as the public review list shows it. */
export type PublicReview = {
  id: string;
  authorId: string | null;
  /** The author's display name, or a neutral label when the author is gone. */
  authorName: string;
  title: string | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  /** How many viewers marked this review as enjoying. */
  enjoyingCount: number;
  /** The author's own active rating of the same content item, if any. */
  authorRating: number | null;
  /** Whether the signed-in viewer already reacted. */
  reactedByViewer: boolean;
};

/** The review count of one content item. */
export type ReviewCount = {
  count: number;
};

/**
 * Submit or update a user's review for a drama.
 *
 * @param userId The author. It is the authenticated viewer, never a request field.
 * @param dramaId The drama ID to review.
 * @param title The review title. May be `null`.
 * @param content The review body.
 * @returns The review that was created or updated.
 */
export async function submitDramaReview(
  userId: string,
  dramaId: string,
  title: string | null,
  content: string,
  executor: DbExecutor = db
) {
  const [row] = await executor
    .insert(reviews)
    .values({
      user_id: userId,
      drama_id: dramaId,
      title,
      content,
    })
    .onConflictDoUpdate({
      // The conflict target is a *partial* unique index. PostgreSQL only infers
      // a partial index when the statement repeats the index predicate, so the
      // `targetWhere` clause is required: without it the statement fails with
      // "no unique or exclusion constraint matching the ON CONFLICT
      // specification" instead of updating the existing review.
      target: [reviews.user_id, reviews.drama_id],
      targetWhere: sql`${reviews.drama_id} is not null`,
      set: {
        title,
        content,
        // `created_at` is deliberately absent: the creation time is preserved.
        updated_at: sql`now()`,
      },
    })
    .returning({
      id: reviews.id,
      userId: reviews.user_id,
      dramaId: reviews.drama_id,
      movieId: reviews.movie_id,
      title: reviews.title,
      content: reviews.content,
      createdAt: reviews.created_at,
      updatedAt: reviews.updated_at,
    });

  return row ?? null;
}

/**
 * Submit or update a user's review for a movie.
 *
 * Same logic as `submitDramaReview` but targeting a movie.
 */
export async function submitMovieReview(
  userId: string,
  movieId: string,
  title: string | null,
  content: string,
  executor: DbExecutor = db
) {
  const [row] = await executor
    .insert(reviews)
    .values({
      user_id: userId,
      movie_id: movieId,
      title,
      content,
    })
    .onConflictDoUpdate({
      target: [reviews.user_id, reviews.movie_id],
      targetWhere: sql`${reviews.movie_id} is not null`,
      set: {
        title,
        content,
        updated_at: sql`now()`,
      },
    })
    .returning({
      id: reviews.id,
      userId: reviews.user_id,
      dramaId: reviews.drama_id,
      movieId: reviews.movie_id,
      title: reviews.title,
      content: reviews.content,
      createdAt: reviews.created_at,
      updatedAt: reviews.updated_at,
    });

  return row ?? null;
}

/**
 * The viewer's own review of an item, or `null` when they have not written one.
 *
 * The details page uses this to pre-fill the review form.
 */
export async function getUserReview(
  userId: string | null,
  type: 'drama' | 'movie',
  id: string,
  executor: DbExecutor = db
): Promise<PublicReview | null> {
  if (userId === null) {
    return null;
  }

  const [row] = await executor
    .select({
      id: reviews.id,
      authorId: reviews.user_id,
      title: reviews.title,
      content: reviews.content,
      createdAt: reviews.created_at,
      updatedAt: reviews.updated_at,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.user_id, userId),
        type === 'drama' ? eq(reviews.drama_id, id) : eq(reviews.movie_id, id)
      )
    )
    .limit(1);

  if (!row) {
    return null;
  }

  const displayNames = await getUserDisplayNames(row.authorId ? [row.authorId] : []);

  return {
    ...row,
    authorName: displayNames.get(row.authorId ?? '') ?? 'Anonymous viewer',
    enjoyingCount: 0,
    authorRating: null,
    reactedByViewer: false,
  };
}

/**
 * The public review list of a content item.
 *
 * Three sort orders are approved (requirements §7.5):
 *
 * - `most-enjoying` orders by the number of "Enjoying" reactions.
 * - `newest` orders by the creation time.
 * - `highest-rated` orders by the rating the *author* gave the same content
 *   item. A review and a rating belong to the same person, so this is the only
 *   rating a review can honestly be sorted by; the content-wide average would
 *   be identical for every review of the item and would not sort anything.
 *
 * Reviews of a reported review stay in the list: a report opens a moderation
 * case, it does not hide the review.
 */
export async function listReviews(
  type: 'drama' | 'movie',
  contentId: string,
  options: {
    sort?: ReviewSort;
    limit?: number;
    viewerId?: string | null;
  } = {},
  executor: DbExecutor = db
): Promise<PublicReview[]> {
  const sort = options.sort ?? 'newest';
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const targetFilter =
    type === 'drama' ? eq(reviews.drama_id, contentId) : eq(reviews.movie_id, contentId);

  const base = executor
    .select({
      id: reviews.id,
      authorId: reviews.user_id,
      title: reviews.title,
      content: reviews.content,
      createdAt: reviews.created_at,
      updatedAt: reviews.updated_at,
      enjoyingCount: count(review_reactions.id),
      authorRating: sql<number | null>`max(${ratings.value})`,
      reactedByViewer: sql<boolean>`bool_or(${review_reactions.user_id} = ${options.viewerId ?? null})`,
    })
    .from(reviews)
    .leftJoin(
      review_reactions,
      eq(review_reactions.review_id, reviews.id)
    )
    .leftJoin(
      ratings,
      and(
        isNull(ratings.deleted_at),
        eq(ratings.user_id, reviews.user_id),
        type === 'drama' ? eq(ratings.drama_id, contentId) : eq(ratings.movie_id, contentId)
      )
    )
    .where(targetFilter)
    .groupBy(reviews.id);

  const orderedRows =
    sort === 'most-enjoying'
      ? await base.orderBy(desc(count(review_reactions.id)), desc(reviews.created_at)).limit(limit)
      : sort === 'highest-rated'
        ? await base.orderBy(desc(sql`max(${ratings.value})`), desc(reviews.created_at)).limit(limit)
        : await base.orderBy(desc(reviews.created_at)).limit(limit);

  const rows = orderedRows;

  const displayNames = await getUserDisplayNames(
    rows.map(row => row.authorId).filter((id): id is string => id !== null)
  );

  return rows.map(row => ({
    id: row.id,
    authorId: row.authorId,
    authorName:
      (row.authorId ? displayNames.get(row.authorId) : null) ?? 'Anonymous viewer',
    title: row.title,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    enjoyingCount: Number(row.enjoyingCount ?? 0),
    authorRating: row.authorRating === null ? null : Number(row.authorRating),
    reactedByViewer: row.reactedByViewer === true,
  }));
}

/**
 * The number of reviews of a drama.
 *
 * Reviews have no soft delete: every row is permanent.
 */
export async function recalculateDramaReviewSummary(
  dramaId: string,
  executor: DbExecutor = db
): Promise<ReviewCount | null> {
  const [row] = await executor
    .select({ total: count() })
    .from(reviews)
    .where(eq(reviews.drama_id, dramaId));

  const total = Number(row?.total ?? 0);

  return total === 0 ? null : { count: total };
}

/**
 * The number of reviews of a movie.
 *
 * Reviews have no soft delete: every row is permanent.
 */
export async function recalculateMovieReviewSummary(
  movieId: string,
  executor: DbExecutor = db
): Promise<ReviewCount | null> {
  const [row] = await executor
    .select({ total: count() })
    .from(reviews)
    .where(eq(reviews.movie_id, movieId));

  const total = Number(row?.total ?? 0);

  return total === 0 ? null : { count: total };
}

/** The approved review sort orders, re-exported for the UI controls. */
export { reviewSortSchema };
export type { ReviewSort };
