'use server';

import { resolveActor } from '@/modules/authorization';
import { ValidationError } from '@/platform/errors';

import { db } from '@/db/client';
import { report_submissions } from '@/modules/users/schema';
import { eq } from 'drizzle-orm';

import { parseReportInput } from '@/modules/users/report-types';
import { isValidReportReason } from '@/modules/users/report-types';

/** Add a user report for a content item. */
export async function submitReport(
  input: unknown
): Promise<{ ok: boolean; submissionId?: string; error?: string }> {
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

    // Validate that the content item exists and is publicly accessible
    let contentRef;
    if (contentType === 'drama') {
      contentRef = await db
        .select({ isActive: content.dramas.isActive })
        .from(content.dramas)
        .where(eq(content.dramas.id, content_id))
        .limit(1);
    } else if (contentType === 'movie') {
      contentRef = await db
        .select({ isActive: content.movies.isActive })
        .from(content.movies)
        .where(eq(content.movies.id, content_id))
        .limit(1);
    }

    if (!contentRef.length || !contentRef[0].isActive) {
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

    return { ok: true, submissionId: submission.id };
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}