import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { ReviewReportQueue } from '@/components/admin/moderation/review-report-queue';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { listReviewReports } from '@/modules/reviews';

import { requireAdminPageAccess } from '../_access';

/**
 * The review-report moderation queue.
 *
 * A report is filed by a viewer about a written review. The queue shows the
 * open reports with the reported text, lets a moderator resolve each one with
 * a recorded outcome, and — for an authorized moderator — remove the review
 * permanently.
 *
 * Reading the queue needs `review.read`; resolving a report and removing a
 * review need `review.manage`, and the workflows check that again.
 */

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/reviews';

export default async function AdminReviewsPage(): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  // Navigation is never the boundary: the page checks the canonical
  // permissions itself, and the workflows check them again.
  if (!hasPermission(actor, toPermissionKey('review', 'read'))) {
    notFound();
  }

  const canManage = hasPermission(actor, toPermissionKey('review', 'manage'));

  const reports = await listReviewReports({ status: 'active', limit: 100 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Review moderation
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reports about written reviews. A reported review stays visible while the case is
          pending. Removing a review is permanent and cannot be undone.
        </p>
      </div>

      <ReviewReportQueue
        canRemove={canManage}
        reports={reports.map(report => ({
          id: report.id,
          reviewId: report.reviewId,
          reviewIdSnapshot: report.reviewIdSnapshot,
          reason: report.reason,
          description: report.description,
          status: report.status,
          reviewTitle: report.reviewTitle,
          reviewContent: report.reviewContent,
          reviewRemoved: report.reviewRemoved,
          createdAt: report.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
