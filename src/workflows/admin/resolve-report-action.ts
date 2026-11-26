'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/contracts/common';

import { resolveActor } from '@/modules/authorization';
import { notifyReporter } from '@/modules/notifications';
import { resolveContentReport, type ContentReportStatus } from '@/modules/users';
import { createRequestLogger } from '@/platform/logging';

import { toActionError } from '../action-errors';

/**
 * Resolve a viewer-submitted content report.
 *
 * The actor is resolved from the session and the permission is re-checked
 * inside the users-module service, so the entrypoint is not the authority.
 */
export async function resolveReportAction(input: unknown): Promise<
  ActionResult<{ reportId: string; status: ContentReportStatus }>
> {
  try {
    const actor = await resolveActor();

    if (typeof input !== 'object' || input === null) {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid report.' } };
    }

    const payload = input as { reportId?: unknown; status?: unknown; note?: unknown };

    if (typeof payload.reportId !== 'string' || payload.reportId.length === 0) {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid report id.' } };
    }

    const status = payload.status;

    if (status !== 'reviewed' && status !== 'resolved') {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid report status.' } };
    }

    const note = typeof payload.note === 'string' ? payload.note : null;

    const report = await resolveContentReport(actor, payload.reportId, status, note);

    // The reporter is owed the outcome: the platform promised that a
    // moderation outcome reaches the reporter, and the outcome is a mandatory
    // event. The report id is the content id, so a repeated resolution cannot
    // produce a second notification for the same report (D-075).
    //
    // The report has already been resolved when the notification is written,
    // so a failed write must not fail the moderator's action: the report
    // really was resolved, and reporting the action as failed would be a lie.
    // The failure is logged instead, and the platform does not claim a
    // delivery it did not make (D-064).
    if (report.reporterId) {
      try {
        await notifyReporter({
          reporterUserId: report.reporterId,
          resolutionOutcome:
            note?.trim() || `Your report was marked as ${report.status}.`,
          eventType: 'content_report_resolved',
          contentId: report.id,
          contentType: 'content_report',
        });
      } catch (error) {
        const { logger } = createRequestLogger({ module: 'notifications' });
        logger.warn(
          { err: error, event: 'content_report_notification_failed' },
          'The report was resolved but the reporter was not notified'
        );
      }
    }

    revalidatePath('/admin/reports', 'page');

    return { ok: true, data: { reportId: report.id, status: report.status } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
