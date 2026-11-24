'use server';

import { revalidatePath } from 'next/navigation';
import { redirect } from 'next/navigation';

import { auth } from '@/platform/auth/better-auth';
import { headers } from 'next/headers';

import { submitDramaRating, submitMovieRating, recalculateDramaRatingSummary } from '@/modules/reviews/service';
import { submitDramaReview, submitMovieReview, recalculateDramaReviewSummary } from '@/modules/reviews/review-service';
import { toggleReviewEnjoying } from '@/modules/reviews/reaction-service';
import { submitReviewReport, resolveReviewReport, getActiveReportsForReview, sortReviews, type ReportReason } from '@/modules/reviews/report-service';
import { getActiveSession } from '@/platform/auth';

// --- Rating Submissions ---

/**
 * Submit or update a user's rating for a drama.
 *
 * Requires authentication. Uses the session user ID as the rating author.
 */
export async function submitDramaRatingAction(dramaId: string, value: number) {
  const session = await getActiveSession();
  if (!session?.user?.id) {
    return { error: 'Authentication required.' };
  }

  const { rating, count } = await submitDramaRating(dramaId, value);

  revalidatePath(`/drama/${dramaId}`);
  revalidatePath('/');

  return { success: true, rating, count };
}

/**
 * Submit or update a user's rating for a movie.
 *
 * Requires authentication. Uses the session user ID as the rating author.
 */
export async function submitMovieRatingAction(movieId: string, value: number) {
  const session = await getActiveSession();
  if (!session?.user?.id) {
    return { error: 'Authentication required.' };
  }

  const { rating, count } = await submitMovieRating(movieId, value);

  revalidatePath(`/movie/${movieId}`);
  revalidatePath('/');

  return { success: true, rating, count };
}

// --- Review Submissions ---

/**
 * Submit or update a user's written review for a drama.
 *
 * Requires authentication. Uses the session user ID as the review author.
 * Preserves creation time; updates the last-edited timestamp.
 */
export async function submitDramaReviewAction(dramaId: string, title: string, content: string) {
  const session = await getActiveSession();
  if (!session?.user?.id) {
    return { error: 'Authentication required.' };
  }

  const review = await submitDramaReview(dramaId, title, content);

  revalidatePath(`/drama/${dramaId}`);
  revalidatePath('/');

  return { success: true, review };
}

/**
 * Submit or update a user's written review for a movie.
 *
 * Requires authentication. Uses the session user ID as the review author.
 * Preserves creation time; updates the last-edited timestamp.
 */
export async function submitMovieReviewAction(movieId: string, title: string, content: string) {
  const session = await getActiveSession();
  if (!session?.user?.id) {
    return { error: 'Authentication required.' };
  }

  const review = await submitMovieReview(movieId, title, content);

  revalidatePath(`/movie/${movieId}`);
  revalidatePath('/');

  return { success: true, review };
}

// --- Review Enjoyment Reactions ---

/**
 * Toggle an "Enjoying" reaction on a review.
 *
 * Requires authentication. One reaction per user per review.
 */
export async function toggleReviewEnjoyingAction(reviewId: string) {
  const session = await getActiveSession();
  if (!session?.user?.id) {
    return { error: 'Authentication required.' };
  }

  const { enjoying, count } = await toggleReviewEnjoying(reviewId, session.user.id);

  revalidatePath(`/review/${reviewId}`);
  revalidatePath('/');

  return { success: true, enjoying, count };
}

// --- Review Reporting ---

/**
 * Submit a report for a review.
 *
 * Requires authentication. One active report per user per review.
 * After a report is resolved, the user may report again.
 */
export async function submitReviewReportAction(
  reviewId: string,
  reason: ReportReason,
  description?: string
) {
  const session = await getActiveSession();
  if (!session?.user?.id) {
    return { error: 'Authentication required.' };
  }

  const report = await submitReviewReport(reviewId, reason, description, session.user.id);

  revalidatePath(`/review/${reviewId}`);
  revalidatePath('/');

  return { success: true, report };
}

/**
 * Resolve a review report (moderator action).
 *
 * Only callable by moderators or super admins.
 */
export async function resolveReviewReportAction(
  reportId: string,
  resolutionOutcome: string
) {
  const session = await getActiveSession();
  if (!session?.user?.id) {
    return { error: 'Authentication required.' };
  }

  // Check if the user is a super admin or has moderation permission
  // We'll check via the actor context
  const isSuperAdmin = session.user?.isSuperAdmin ?? false;
  const hasModerationPerm = session.user?.permissions?.includes('review.manage') ?? false;

  if (!isSuperAdmin && !hasModerationPerm) {
    return { error: 'Moderator permission required.' };
  }

  const report = await resolveReviewReport(reportId, resolutionOutcome, session.user.id);

  revalidatePath('/');
  revalidatePath(`/review/${report?.review_id}`);

  return { success: true, report };
}

/**
 * Get active reports for a review (for moderation).
 */
export async function getActiveReportsAction(reviewId: string) {
  const session = await getActiveSession();
  if (!session?.user?.id) {
    return { error: 'Authentication required.' };
  }

  const reports = await getActiveReportsForReview(reviewId);

  return { success: true, reports };
}

/**
 * Sort reviews by the specified sort option.
 */
export async function sortReviewsAction(
  sortBy: 'most-enjoying' | 'newest' | 'highest-rated',
  contentType: 'drama' | 'movie',
  contentId: string
) {
  const reviewsList = await sortReviews(sortBy, contentId, contentType);

  return { success: true, reviews: reviewsList };
}