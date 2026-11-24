/**
 * Reviews module public API (server-only).
 *
 * The single public surface for the reviews domain. Callers get the read
 * models they are allowed to use, not the module's schema or inner helpers.
 */

import 'server-only';

export { getRatingSummary } from './rating-summary';
export type { RatingSummary } from './rating-summary';

export {
  submitDramaRating,
  submitMovieRating,
  recalculateDramaRatingSummary,
  recalculateMovieRatingSummary,
} from './service';
export type { ReviewContentReferenceCounts } from './content-ownership';

export {
  submitDramaReview,
  submitMovieReview,
  recalculateDramaReviewSummary,
  recalculateMovieReviewSummary,
} from './review-service';

export {
  toggleReviewEnjoying,
} from './reaction-service';

export {
  submitReviewReport,
  resolveReviewReport,
  getActiveReportsForReview,
  getResolvedReportsForReview,
  sortReviews,
  type ReportReason,
} from './report-service';
