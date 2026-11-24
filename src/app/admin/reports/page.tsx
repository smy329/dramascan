import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { ContentReportQueue } from '@/components/admin/moderation/content-report-queue';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { listContentReports } from '@/modules/users';

import { requireAdminPageAccess } from '../_access';

/**
 * The content-report moderation queue.
 *
 * A report is filed by a viewer about a drama or a movie. The queue shows the
 * open reports and lets an authorized moderator resolve each one with a
 * recorded outcome. The rows are never deleted: they are moderation history.
 */

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/reports';

export default async function AdminReportsPage(): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  // Navigation is never the boundary: the page checks the canonical
  // permission itself, and the workflow checks it again.
  if (!hasPermission(actor, toPermissionKey('review', 'manage'))) {
    notFound();
  }

  const reports = await listContentReports({ status: 'pending', limit: 100 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Content reports
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reports filed by viewers about a drama or a movie. Resolving a report records the
          outcome and keeps the report as moderation history.
        </p>
      </div>

      <ContentReportQueue
        reports={reports.map(report => ({
          id: report.id,
          contentType: report.contentType,
          contentId: report.contentId,
          reason: report.reason,
          description: report.description,
          status: report.status,
          createdAt: report.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
