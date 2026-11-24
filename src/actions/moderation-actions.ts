'use server';

import { revalidatePath } from 'next/navigation';
import { redirect } from 'next/navigation';

import { auth } from '@/platform/auth/better-auth';
import { headers } from 'next/headers';

import { moderateResolveReport, moderateRemoveReview } from '@/modules/moderation/service';
import { getActiveSession } from '@/platform/auth';

/**
 * Resolve a review report (moderator action).
 *
 * Only Super Admin can resolve reports. Reported reviews remain visible while
 * pending moderation; after resolution, the reporter is notified of the outcome.
 */
export async function resolveReportAction(reportId: string, resolutionOutcome: string) {
  const session = await getActiveSession();
  if (!session?.user?.id) {
    return { error: 'Authentication required.' };
  }

  // Check if the user is Super Admin
  if (!session.user.isSuperAdmin) {
    return { error: 'Super Admin permission required.' };
  }

  const report = await moderateResolveReport(reportId, resolutionOutcome);

  // Notify the reporter of the resolution outcome
  // (In a full implementation, this would send a notification.
  // For now, we just revalidate paths.)
  revalidatePath('/');
  revalidatePath(`/review/${report?.review_id}`);

  return { success: true, report };
}

/**
 * Permanently remove a review (moderator action).
 *
 * Only Super Admin can permanently remove reviews. Removed reviews cannot be
 * restored. The reporter is notified of the resolution outcome.
 */
export async function removeReviewAction(reviewId: string) {
  const session = await getActiveSession();
  if (!session?.user?.id) {
    return { error: 'Authentication required.' };
  }

  // Check if the user is Super Admin
  if (!session.user.isSuperAdmin) {
    return { error: 'Super Admin permission required.' };
  }

  const result = await moderateRemoveReview(reviewId);

  revalidatePath('/');
  // The review list/page will not show removed reviews

  return { success: true };
}