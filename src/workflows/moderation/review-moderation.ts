'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/contracts/common';

import { db } from '@/db/client';
import { requirePermission, resolveActor } from '@/modules/authorization';
import { recordModerationAction } from '@/modules/moderation';
import { notifyReporter } from '@/modules/notifications';
import {
  listReviewReports,
  removeReview,
  resolutionOutcomeSchema,
  resolveReviewReport,
} from '@/modules/reviews';

import { toActionError } from '../action-errors';

/**
 * Moderation of review reports.
 *
 * Two operations are exposed:
 *
 * - Resolving a report records the outcome, writes the moderation audit row,
 *   and tells the reporter what was decided. All three happen in one
 *   transaction: a moderator never sees a resolved report without an audit
 *   trail, and the reporter is never left without an answer.
 * - Removing a review is permanent. The open reports about the review are
 *   resolved first, so their reporters are told what happened, and the report
 *   rows survive the removal as moderation history.
 *
 * The actor is resolved from the session and the permission is re-checked
 * inside the services, so neither the entrypoint nor the UI is the authority.
 */

/** Resolve a review report and notify the reporter. */
export async function resolveReviewReportAction(input: unknown): Promise<
  ActionResult<{ reportId: string }>
> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'review.manage');

    if (typeof input !== 'object' || input === null) {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid report.' } };
    }

    const payload = input as { reportId?: unknown; outcome?: unknown };

    if (typeof payload.reportId !== 'string' || payload.reportId.length === 0) {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid report id.' } };
    }

    const parsedOutcome = resolutionOutcomeSchema.safeParse(payload.outcome);

    if (!parsedOutcome.success) {
      return {
        ok: false,
        error: {
          code: 'validation_error',
          message: parsedOutcome.error.issues[0]?.message ?? 'Invalid outcome.',
        },
      };
    }

    const reportId = payload.reportId;

    const result = await db.transaction(async tx => {
      const report = await resolveReviewReport(
        reportId,
        parsedOutcome.data,
        actor.userId ?? '',
        tx
      );

      if (!report) {
        return null;
      }

      await recordModerationAction(
        actor,
        'report_resolved',
        'report',
        reportId,
        parsedOutcome.data,
        tx
      );

      await notifyReporter(
        {
          reporterUserId: report.reporterId,
          resolutionOutcome: parsedOutcome.data,
        },
        tx
      );

      return report;
    });

    if (!result) {
      return { ok: false, error: { code: 'not_found', message: 'The report no longer exists.' } };
    }

    revalidatePath('/admin/reviews', 'page');
    revalidatePath('/admin/reports', 'page');
    revalidatePath('/');
    revalidatePath('/drama/[dramaId]/[slug]', 'page');
    revalidatePath('/movie/[id]/[slug]', 'page');

    return { ok: true, data: { reportId: result.id } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/** Permanently remove a review. */
export async function removeReviewAction(input: unknown): Promise<
  ActionResult<{ reviewId: string }>
> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'review.manage');

    const reviewId =
      typeof input === 'object' && input !== null
        ? (input as { reviewId?: unknown }).reviewId
        : input;

    if (typeof reviewId !== 'string' || reviewId.length === 0) {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid review id.' } };
    }

    const outcome = 'The reported review was permanently removed by a moderator.';

    const result = await db.transaction(async tx => {
      const openReports = await listReviewReports({ status: 'active', limit: 500 }, tx);
      const reportsAboutReview = openReports.filter(
        report => report.reviewId === reviewId || report.reviewIdSnapshot === reviewId
      );

      const removed = await removeReview(actor, reviewId, tx);

      await recordModerationAction(
        actor,
        'review_removed',
        'review',
        reviewId,
        `Review ${reviewId} permanently removed by a moderator`,
        tx
      );

      for (const report of reportsAboutReview) {
        await resolveReviewReport(report.id, outcome, actor.userId ?? '', tx);

        await recordModerationAction(
          actor,
          'report_resolved',
          'report',
          report.id,
          outcome,
          tx
        );

        await notifyReporter(
          {
            reporterUserId: report.reporterId,
            resolutionOutcome: outcome,
          },
          tx
        );
      }

      return removed;
    });

    revalidatePath('/admin/reviews', 'page');
    revalidatePath('/');
    revalidatePath('/drama/[dramaId]/[slug]', 'page');
    revalidatePath('/movie/[id]/[slug]', 'page');

    return { ok: true, data: { reviewId: result.id } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
