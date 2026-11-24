import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { review_reports, reviews } from './schema';
import { reviewReportReasonSchema, type ReviewReportReason } from './validation';

/**
 * Reports about a review.
 *
 * - One *active* report per viewer per review. The partial unique index
 *   `uq_review_reports_user_id_review_id_active` enforces it.
 * - A viewer may report again after the earlier report was resolved, because
 *   the uniqueness only applies to `status = 'active'` rows.
 * - Several viewers may report the same review; each report is its own row.
 * - A reported review stays visible while the case is pending. A report opens
 *   a moderation case, it does not hide the review.
 *
 * The reporter is always the caller. The writer never accepts a reporter from
 * the request, so a client cannot file a report on somebody else's behalf.
 */

/** A report as the moderation queue shows it. */
export type ReviewReport = {
  id: string;
  reporterId: string;
  reviewId: string | null;
  /** The id of the review that was reported, even after the review is gone. */
  reviewIdSnapshot: string | null;
  reason: ReviewReportReason;
  description: string | null;
  status: 'active' | 'resolved';
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionOutcome: string | null;
  reportedAt: Date | null;
  createdAt: Date;
};

/** A report together with the review it refers to, for the moderation queue. */
export type ReviewReportWithReview = ReviewReport & {
  reviewTitle: string | null;
  reviewContent: string | null;
  reviewAuthorId: string | null;
  reviewRemoved: boolean;
};

/**
 * Submit a report about a review.
 *
 * @param reporterUserId The reporter. It is the authenticated viewer.
 * @param reviewId The review being reported.
 * @param reason The report reason code.
 * @param description Optional free-text description.
 * @returns The created or updated report.
 */
export async function submitReviewReport(
  reporterUserId: string,
  reviewId: string,
  reason: ReviewReportReason,
  description?: string | null,
  executor: DbExecutor = db
): Promise<ReviewReport | null> {
  const parsedReason = reviewReportReasonSchema.safeParse(reason);

  if (!parsedReason.success) {
    throw new Error('Choose a valid report reason.');
  }

  const [row] = await executor
    .insert(review_reports)
    .values({
      user_id: reporterUserId,
      review_id: reviewId,
      review_id_snapshot: reviewId,
      reason: parsedReason.data,
      description: description ?? null,
      status: 'active',
    })
    .onConflictDoUpdate({
      // The conflict target is a *partial* unique index. PostgreSQL only infers
      // a partial index when the statement repeats the index predicate, so the
      // `targetWhere` clause is required.
      target: [review_reports.user_id, review_reports.review_id],
      targetWhere: sql`${review_reports.status} = 'active' and ${review_reports.review_id} is not null`,
      set: {
        reason: parsedReason.data,
        description: description ?? null,
        status: 'active',
        resolved_at: null,
        resolved_by: null,
        resolution_outcome: null,
        reported_at: sql`now()`,
      },
    })
    .returning({
      id: review_reports.id,
      reporterId: review_reports.user_id,
      reviewId: review_reports.review_id,
      reviewIdSnapshot: review_reports.review_id_snapshot,
      reason: review_reports.reason,
      description: review_reports.description,
      status: review_reports.status,
      resolvedAt: review_reports.resolved_at,
      resolvedBy: review_reports.resolved_by,
      resolutionOutcome: review_reports.resolution_outcome,
      reportedAt: review_reports.reported_at,
      createdAt: review_reports.created_at,
    });

  return row
    ? {
        ...row,
        reason: row.reason as ReviewReportReason,
        status: row.status as 'active' | 'resolved',
      }
    : null;
}

/**
 * Resolve a review report (moderator action).
 *
 * A resolved report carries the complete resolution record: the moment, the
 * moderator who resolved it, and the outcome. The database lifecycle CHECK
 * rejects a half-recorded resolution.
 *
 * @param reportId The report to resolve.
 * @param resolutionOutcome What was decided.
 * @param resolverUserId The moderator who resolved it.
 */
export async function resolveReviewReport(
  reportId: string,
  resolutionOutcome: string,
  resolverUserId: string,
  executor: DbExecutor = db
): Promise<ReviewReport | null> {
  const [row] = await executor
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
      reporterId: review_reports.user_id,
      reviewId: review_reports.review_id,
      reviewIdSnapshot: review_reports.review_id_snapshot,
      reason: review_reports.reason,
      description: review_reports.description,
      status: review_reports.status,
      resolvedAt: review_reports.resolved_at,
      resolvedBy: review_reports.resolved_by,
      resolutionOutcome: review_reports.resolution_outcome,
      reportedAt: review_reports.reported_at,
      createdAt: review_reports.created_at,
    });

  return row
    ? {
        ...row,
        reason: row.reason as ReviewReportReason,
        status: row.status as 'active' | 'resolved',
      }
    : null;
}

/**
 * The open reports about a review.
 *
 * This is a moderation read: the caller must hold `review.read`.
 */
export async function getActiveReportsForReview(
  reviewId: string,
  executor: DbExecutor = db
): Promise<ReviewReport[]> {
  const rows = await executor
    .select({
      id: review_reports.id,
      reporterId: review_reports.user_id,
      reviewId: review_reports.review_id,
      reviewIdSnapshot: review_reports.review_id_snapshot,
      reason: review_reports.reason,
      description: review_reports.description,
      status: review_reports.status,
      resolvedAt: review_reports.resolved_at,
      resolvedBy: review_reports.resolved_by,
      resolutionOutcome: review_reports.resolution_outcome,
      reportedAt: review_reports.reported_at,
      createdAt: review_reports.created_at,
    })
    .from(review_reports)
    .where(
      and(
        eq(review_reports.review_id, reviewId),
        eq(review_reports.status, 'active')
      )
    )
    .orderBy(desc(review_reports.reported_at));

  return rows.map(row => ({
    ...row,
    reason: row.reason as ReviewReportReason,
    status: row.status as 'active' | 'resolved',
  }));
}

/**
 * The resolved reports about a review (moderation history).
 */
export async function getResolvedReportsForReview(
  reviewId: string,
  executor: DbExecutor = db
): Promise<ReviewReport[]> {
  const rows = await executor
    .select({
      id: review_reports.id,
      reporterId: review_reports.user_id,
      reviewId: review_reports.review_id,
      reviewIdSnapshot: review_reports.review_id_snapshot,
      reason: review_reports.reason,
      description: review_reports.description,
      status: review_reports.status,
      resolvedAt: review_reports.resolved_at,
      resolvedBy: review_reports.resolved_by,
      resolutionOutcome: review_reports.resolution_outcome,
      reportedAt: review_reports.reported_at,
      createdAt: review_reports.created_at,
    })
    .from(review_reports)
    .where(
      and(
        eq(review_reports.review_id, reviewId),
        eq(review_reports.status, 'resolved')
      )
    )
    .orderBy(desc(review_reports.resolved_at));

  return rows.map(row => ({
    ...row,
    reason: row.reason as ReviewReportReason,
    status: row.status as 'active' | 'resolved',
  }));
}

/**
 * The moderation queue of review reports.
 *
 * The queue is bounded: it never loads the whole table into memory. The review
 * is joined so a moderator can read the reported text without a second query.
 * A report whose review has been permanently removed keeps its snapshot id and
 * is marked as removed.
 */
export async function listReviewReports(
  options: { status?: 'active' | 'resolved' | 'all'; limit?: number } = {},
  executor: DbExecutor = db
): Promise<ReviewReportWithReview[]> {
  const status = options.status ?? 'active';
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));

  const statusFilter =
    status === 'all' ? undefined : eq(review_reports.status, status);

  const rows = await executor
    .select({
      id: review_reports.id,
      reporterId: review_reports.user_id,
      reviewId: review_reports.review_id,
      reviewIdSnapshot: review_reports.review_id_snapshot,
      reason: review_reports.reason,
      description: review_reports.description,
      status: review_reports.status,
      resolvedAt: review_reports.resolved_at,
      resolvedBy: review_reports.resolved_by,
      resolutionOutcome: review_reports.resolution_outcome,
      reportedAt: review_reports.reported_at,
      createdAt: review_reports.created_at,
      reviewTitle: reviews.title,
      reviewContent: reviews.content,
      reviewAuthorId: reviews.user_id,
    })
    .from(review_reports)
    .leftJoin(reviews, eq(reviews.id, review_reports.review_id))
    .where(statusFilter)
    .orderBy(desc(review_reports.created_at))
    .limit(limit);

  return rows.map(row => ({
    ...row,
    reason: row.reason as ReviewReportReason,
    status: row.status as 'active' | 'resolved',
    reviewRemoved: row.reviewId === null,
  }));
}
