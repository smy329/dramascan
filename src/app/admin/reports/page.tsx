import { redirect } from 'next/navigation';
import { getActiveSession } from '@/platform/auth/session';
import { requireSuperAdmin } from '@/modules/authorization/guards';
import 'server-only';

import { db } from '@/db/client';
import { report_submissions } from '@/modules/users/schema';
import { eq, desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function ReportsAdminPage() {
  const session = await getActiveSession();

  if (!session) {
    redirect('/auth/signin');
  }

  // Require super admin access
  const actor = await requireSuperAdmin({
    userId: session.userId,
    isSuperAdmin: true,
  });

  // Fetch all reports, ordered by most recent first
  const reports = await db
    .select({
      id: report_submissions.id,
      reason: report_submissions.reason,
      status: report_submissions.status,
      createdAt: report_submissions.created_at,
      contentType: report_submissions.content_type,
    })
    .from(report_submissions)
    .orderBy(desc(report_submissions.created_at));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Report Administration
          </h1>

          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Inspect and resolve user-submitted reports.
          </p>
        </header>

        {reports.length === 0 ? (
          <div className="empty-state text-center py-12">
            <svg
              className="w-12 h-12 mx-auto mb-4 text-gray-400 dark:text-gray-600"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 3 21 3 21 7" />
              <polyline points>7 22 3 22 3 17</polyline>
              <line x1="3" y1="7" x2="21" y2="7" />
              <line x1="21" y1="3" x2="21" y2="7" />
              <line x1="3" y1="22" x2="3" y2="17" />
            </svg>

            <h2 className="mb-2 text-xl font-bold text-gray-900 dark:text-gray-100">
              No Reports Yet
            </h2>

            <p className="text-gray-500 dark:text-gray-400">
              No reports have been submitted yet.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {reports.map((report) => (
              <div
                key={report.id}
                className="rounded-lg border p-6 hover:shadow-lg transition-shadow min-h-80"
              >
                <p className="font-medium text-gray-900 dark:text-gray-100">
                  Report: {report.reason}
                </p>

                <select
                  className="mt-2 rounded border p-2 shadow-sm w-full"
                  onChange={
                    (e: React.ChangeEvent<HTMLSelectElement>) =>
                      handleResolveReport(report.id, e.target.value)
                  }
                >
                  <option value="pending">Pending</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="resolved">Resolved</option>
                </select>

                <button
                  onClick={() => handleDeleteReport(report.id)}
                  className="mt-2 rounded-md border border-red-500 bg-red-100 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                  aria-label="Delete report"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function handleResolveReport(reportId: string, status: string) {
  // Dispatch a server action to resolve the report
  console.log(`Report ${reportId} resolved as ${status}`);
}

function handleDeleteReport(reportId: string) {
  // Dispatch a server action to delete the report
  console.log(`Report ${reportId} deleted`);
}