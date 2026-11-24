/**
 * Reviews module public API (server-only).
 *
 * The single public surface for the reviews domain. Callers get the read
 * models they are allowed to use, not the module's schema or inner helpers.
 *
 * The moderator-only operations (`resolveReviewReport`, `listReviewReports`,
 * `removeReview`) are exported here because the moderation workflow is the
 * only intended caller; each of them re-checks the permission it needs, so an
 * accidental call from an unprotected entrypoint is refused rather than
 * obeyed.
 */

import 'server-only';

export { getRatingSummary } from './rating-summary';
export type { RatingSummary } from './rating-summary';

export {
  getUserRating,
  recalculateDramaRatingSummary,
  recalculateMovieRatingSummary,
  submitDramaRating,
  submitMovieRating,
} from './service';
export type { RatingWriteResult } from './service';

export {
  getUserReview,
  listReviews,
  recalculateDramaReviewSummary,
  recalculateMovieReviewSummary,
  submitDramaReview,
  submitMovieReview,
} from './review-service';
export type { PublicReview, ReviewCount, ReviewSort } from './review-service';

export { getReviewEnjoyingCount, toggleReviewEnjoying } from './reaction-service';
export type { ReviewReactionState } from './reaction-service';

export {
  getActiveReportsForReview,
  getResolvedReportsForReview,
  listReviewReports,
  resolveReviewReport,
  submitReviewReport,
} from './report-service';
export type { ReviewReport, ReviewReportWithReview } from './report-service';

export { removeReview } from './removal-service';
export type { RemovedReview } from './removal-service';

export {
  REVIEW_REPORT_REASONS,
  parseRatingValue,
  parseReportReason,
  ratingValueSchema,
  reviewContentSchema,
  reviewContentTypeSchema,
  reviewIdSchema,
  reviewReportReasonSchema,
  reviewSortSchema,
  reviewTitleSchema,
  reportDescriptionSchema,
  resolutionOutcomeSchema,
} from './validation';
export type { ReviewReportReason } from './validation';

export type { ReviewContentReferenceCounts } from './content-ownership';
