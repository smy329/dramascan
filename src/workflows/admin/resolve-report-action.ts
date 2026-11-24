'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/contracts/common';

import { resolveActor } from '@/modules/authorization';
import { resolveContentReport, type ContentReportStatus } from '@/modules/users';

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

    revalidatePath('/admin/reports', 'page');

    return { ok: true, data: { reportId: report.id, status: report.status } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
