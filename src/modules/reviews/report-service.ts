import 'server-only';

import { eq, sql, ilike } from 'drizzle-orm';

import { db } from '@/db/client';

import { review_reports, reviews } from './schema';

/**
 * Valid report reasons for review reports.
 */
export type ReportReason =
  | 'spam_advertising'
  | 'harassment_bullying'
  | 'inappropriate_language'
  | 'misleading_false_information'
  | 'other';

/**
 * Submit a review report.
 *
 * - One active report per user per review is enforced by the unique index
   `uq_review_reports_user_id_review_id_active`.
 * - If the user already has an active report, the existing report is updated
   (reason, description) rather than creating a duplicate.
 * - A resolved report can be re-reported (the partial uniqueness only applies
   to `status = 'active'` rows).
 *
 * @param reviewId The review ID being reported.
 * @param reason The report reason code.
 * @param description Optional free-text description.
 * @returns The created or updated report.
 */
export async function submitReviewReport(
  reviewId: string,
  reason: ReportReason,
  description?: string,
  actorUserId?: string
) {
  const [row] = await db
    .insert(review_reports)
    .values({
      user_id: actorUserId,
      review_id: reviewId,
      reason,
      description,
      status: 'active',
    })
    .onConflictDoUpdate({
      target: 'uq_review_reports_user_id_review_id_active',
      set: {
        reason,
        description,
        status: 'active',
        resolved_at: null,
        resolved_by: null,
        resolution_outcome: null,
        reported_at: sql`now()`,
      },
    })
    .returning({
      id: review_reports.id,
      user_id: review_reports.user_id,
      review_id: review_reports.review_id,
      reason: review_reports.reason,
      description: review_reports.description,
      status: review_reports.status,
      resolved_at: review_reports.resolved_at,
      resolved_by: review_reports.resolved_by,
      resolution_outcome: review_reports.resolution_outcome,
      reported_at: review_reports.reported_at,
      created_at: review_reports.created_at,
    });

  return row;
}

/**
 * Resolve a review report (moderator action).
 *
 * Only callable by moderators or super admins. Sets the report to `resolved`
 * with the given outcome and resolver identity.
 *
 * @param reportId The report ID to resolve.
 * @param resolutionOutcome Description of the resolution.
 * @param resolverUserId The moderator/super admin user ID.
 */
export async function resolveReviewReport(
  reportId: string,
  resolutionOutcome: string,
  resolverUserId: string
) {
  const [row] = await db
    .update(review_reports)
    .set({
      status: 'resolved',
      resolved_at: sql`now()`,
      resolved_by: resolverUserId,
      resolution_outcome: resolutionOutcome,
    })
    .where(eq(review_reports.id, reportId))
    .returning({
      id: review_reports.id,
      user_id: review_reports.user_id,
      review_id: review_reports.review_id,
      reason: review_reports.reason,
      status: review_reports.status,
      resolved_at: review_reports.resolved_at,
      resolved_by: review_reports.resolved_by,
      resolution_outcome: review_reports.resolution_outcome,
    });

  return row;
}

/**
 * Get all active reports for a review (for moderation inspection).
 */
export async function getActiveReportsForReview(reviewId: string) {
  const rows = await db
    .select({
      id: review_reports.id,
      user_id: review_reports.user_id,
      reason: review_reports.reason,
      description: review_reports.description,
      reported_at: review_reports.reported_at,
      resolved_at: review_reports.resolved_at,
      resolved_by: review_reports.resolved_by,
      resolution_outcome: review_reports.resolution_outcome,
      created_at: review_reports.created_at,
    })
    .from(review_reports)
    .where(
      and(
        eq(review_reports.review_id, reviewId),
        eq(review_reports.status, 'active')
      )
    );

  return rows;
}

/**
 * Get resolved reports for a review (moderation history).
 */
export async function getResolvedReportsForReview(reviewId: string) {
  const rows = await db
    .select({
      id: review_reports.id,
      user_id: review_reports.user_id,
      reason: review_reports.reason,
      description: review_reports.description,
      reported_at: review_reports.reported_at,
      resolved_at: review_reports.resolved_at,
      resolved_by: review_reports.resolved_by,
      resolution_outcome: review_reports.resolution_outcome,
      created_at: review_reports.created_at,
    })
    .from(review_reports)
    .where(
      and(
        eq(review_reports.review_id, reviewId),
        eq(review_reports.status, 'resolved')
      )
    );

  return rows;
}

/**
 * Sort reviews by the specified sort option.
 *
 * @param sortBy One of 'most-enjoying', 'newest', 'highest-rated'.
 * @param dramaIdOrMovieId The content ID to filter reviews by.
 * @returns A list of reviews with enjoyment counts and rating info.
 */
export async function sortReviews(
  sortBy: 'most-enjoying' | 'newest' | 'highest-rated',
  dramaIdOrMovieId: string,
  contentType: 'drama' | 'movie'
) {
  const ratingTable = contentType === 'drama' ? ratings.drama_id : ratings.movie_id;
  const reviewTable = contentType === 'drama' ? reviews.drama_id : reviews.movie_id;

  switch (sortBy) {
    case 'most-enjoying': {
      // Join with review_reactions to count enjoying reactions
      const rows = await db
        .select({
          id: reviews.id,
          title: reviews.title,
          content: reviews.content,
          created_at: reviews.created_at,
          updated_at: reviews.updated_at,
          enjoyingCount: sql`count(${review_reactions.review_id})`,
        })
        .from(reviews)
        .leftJoin(review_reactions, eq(review_reactions.review_id, reviews.id))
        .where(
          and(
            isNull(reviews.deleted_at),
            contentType === 'drama' ? eq(reviews.drama_id, dramaIdOrMovieId) : eq(reviews.movie_id, dramaIdOrMovieId)
          )
        )
        .groupBy(reviews.id)
        .orderBy(sql`enjoyingCount desc, reviews.created_at desc`);
      return rows;
    }

    case 'newest': {
      const rows = await db
        .select({
          id: reviews.id,
          title: reviews.title,
          content: reviews.content,
          created_at: reviews.created_at,
          updated_at: reviews.updated_at,
        })
        .from(reviews)
        .where(
          and(
            isNull(reviews.deleted_at),
            contentType === 'drama' ? eq(reviews.drama_id, dramaIdOrMovieId) : eq(reviews.movie_id, dramaIdOrMovieId)
          )
        )
        .orderBy(reviews.created_at.desc);
      return rows;
    }

    case 'highest-rated': {
      // Join with ratings to calculate average rating
      const rows = await db
        .select({
          id: reviews.id,
          title: reviews.title,
          content: reviews.content,
          created_at: reviews.created_at,
          updated_at: reviews.updated_at,
          averageRating: sql`avg(${ratings.value})`,
          ratingCount: count(),
        })
        .from(reviews)
        .leftJoin(ratings, and(
          isNull(ratings.deleted_at),
          contentType === 'drama' ? eq(ratings.drama_id, dramaIdOrMovieId) : eq(ratings.movie_id, dramaIdOrMovieId)
        ))
        .groupBy(reviews.id)
        .orderBy(sql`avg(${ratings.value}) desc, reviews.created_at desc`);
      return rows;
    }

    default: {
      const rows = await db
        .select({
          id: reviews.id,
          title: reviews.title,
          content: reviews.content,
          created_at: reviews.created_at,
        })
        .from(reviews)
        .where(isNull(reviews.deleted_at))
        .orderBy(reviews.created_at.desc);
      return rows;
    }
  }
}