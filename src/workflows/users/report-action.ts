'use server';

import { resolveActor } from '@/modules/authorization';
import { ValidationError } from '@/platform/errors';

import { db } from '@/db/client';
import { report_submissions } from '@/modules/users/schema';

import { parseReportInput } from '@/modules/users/report-types';
import { isValidReportReason } from '@/modules/users/report-types';
import { getReportableContentTarget } from '@/modules/content';

/** The state the report form keeps between submissions. */
export type ReportFormState = {
  ok: boolean;
  submissionId?: string;
  error?: string;
};

/**
 * Add a user report for a content item.
 *
 * The signature is the React 19 `useActionState` contract: the previous state
 * arrives first and the submitted payload second.
 */
export async function submitReport(
  _previousState: ReportFormState,
  input: unknown
): Promise<ReportFormState> {
  try {
    const actor = await resolveActor();

    if (!actor || actor.userId === null) {
      return { ok: false, error: 'Authentication required.' };
    }

    const parsed = await parseReportInput(input);

    const { reason, contentType, contentId: content_id, description } = parsed;

    if (!isValidReportReason(reason)) {
      return { ok: false, error: 'Invalid report reason.' };
    }

    // Validate that the content item exists and is publicly accessible.
    // The content module owns the public availability rule, so the check is
    // delegated instead of re-implemented here.
    const contentRef = await getReportableContentTarget(contentType, content_id);

    if (!contentRef) {
      return { ok: false, error: 'The content item is not available for reporting.' };
    }

    // Create the report submission
    const [submission] = await db
      .insert(report_submissions)
      .values({
        user_id: actor.userId,
        content_type: contentType,
        content_id: content_id,
        reason,
        description: description || null,
        status: 'pending' as const,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning({ id: report_submissions.id });

    if (!submission) {
      return { ok: false, error: 'The report could not be saved.' };
    }

    return { ok: true, submissionId: submission.id };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}
