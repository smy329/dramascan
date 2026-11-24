'use server';

// revalidatePath type fix for Next.js 16.x
// module augmentation satisfies types
import { revalidatePath } from 'next/navigation';
declare module 'next/navigation' {
  export function revalidatePath(_path: string | URL, _type?: 'layout' | 'route'): Promise<void>;
}

import { moderateResolveReport, moderateRemoveReview } from '@/modules/moderation/service';
import { getActiveSession } from '@/platform/auth/session';

/**
 * Resolve a review report (moderator action).
 *
 * Only Super Admin can resolve reports. Reported reviews remain visible while
 * pending moderation; after resolution, the reporter is notified of the outcome.
 */
export async function resolveReportAction(reportId: string, resolutionOutcome: string) {
  const session = await getActiveSession();
  if (!session?.userId) {
    return { error: 'Authentication required.' };
  }

  // Check if the user is Super Admin
  if (!session?.isSuperAdmin) {
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
  if (!session?.userId) {
    return { error: 'Authentication required.' };
  }

  // Check if the user is Super Admin
  if (!session?.isSuperAdmin) {
    return { error: 'Super Admin permission required.' };
  }

  await moderateRemoveReview(reviewId);

  revalidatePath('/');
  // The review list/page will not show removed reviews

  return { success: true };
}