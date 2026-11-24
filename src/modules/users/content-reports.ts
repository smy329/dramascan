import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import type { DbExecutor } from '@/platform/db/executor';
import { NotFoundError } from '@/platform/errors';

import { report_submissions } from './schema';

/**
 * Content reports — a viewer's report about a drama or a movie.
 *
 * The rows live in the `users` module's schema because a content report is
 * filed by a viewer about something they watched; the moderation workflow
 * reads and resolves them through this API rather than touching the table.
 */

/** The lifecycle of a content report. */
export const CONTENT_REPORT_STATUSES = ['pending', 'reviewed', 'resolved'] as const;

export type ContentReportStatus = (typeof CONTENT_REPORT_STATUSES)[number];

/** One content report as the moderation queue shows it. */
export type ContentReport = {
  id: string;
  reporterId: string | null;
  contentType: 'drama' | 'movie';
  contentId: string;
  reason: string;
  description: string | null;
  status: ContentReportStatus;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * The content-report queue, newest first.
 *
 * The query is bounded: the queue never loads the whole table into memory.
 */
export async function listContentReports(
  options: { status?: ContentReportStatus; limit?: number } = {},
  executor: DbExecutor = db
): Promise<ContentReport[]> {
  const status = options.status;
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));

  const rows = await executor
    .select({
      id: report_submissions.id,
      reporterId: report_submissions.user_id,
      contentType: report_submissions.content_type,
      contentId: report_submissions.content_id,
      reason: report_submissions.reason,
      description: report_submissions.description,
      status: report_submissions.status,
      createdAt: report_submissions.created_at,
      updatedAt: report_submissions.updated_at,
    })
    .from(report_submissions)
    .where(status ? eq(report_submissions.status, status) : undefined)
    .orderBy(desc(report_submissions.created_at))
    .limit(limit);

  return rows.map(row => ({
    ...row,
    contentType: row.contentType === 'movie' ? 'movie' : 'drama',
    status: (CONTENT_REPORT_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as ContentReportStatus)
      : 'pending',
  }));
}

/**
 * Record the outcome of a content report.
 *
 * @param actor The moderator. The service checks `review.manage` itself.
 * @param reportId The report to resolve.
 * @param status The new status.
 * @param note An optional note. It is stored in the description column, which
 *   is the only free-text field the row has.
 */
export async function resolveContentReport(
  actor: ActorContext,
  reportId: string,
  status: ContentReportStatus,
  note: string | null,
  executor: DbExecutor = db
): Promise<ContentReport> {
  requirePermission(actor, 'review.manage');

  const [row] = await executor
    .update(report_submissions)
    .set({
      status,
      updated_at: new Date(),
      ...note && note.trim().length > 0 ? { description: note.trim() } : {},
    })
    .where(
      and(
        eq(report_submissions.id, reportId),
        eq(report_submissions.status, 'pending')
      )
    )
    .returning({
      id: report_submissions.id,
      reporterId: report_submissions.user_id,
      contentType: report_submissions.content_type,
      contentId: report_submissions.content_id,
      reason: report_submissions.reason,
      description: report_submissions.description,
      status: report_submissions.status,
      createdAt: report_submissions.created_at,
      updatedAt: report_submissions.updated_at,
    });

  if (!row) {
    throw new NotFoundError('The report was already resolved or no longer exists.');
  }

  return {
    ...row,
    contentType: row.contentType === 'movie' ? 'movie' : 'drama',
    status: (CONTENT_REPORT_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as ContentReportStatus)
      : 'pending',
  };
}
