'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/contracts/common';
import { hasPermission, requireUser, resolveActor, toPermissionKey } from '@/modules/authorization';
import {
  aggregateDailyAnalytics,
  aggregateDateRange,
  buildDateRange,
  isCalendarDay,
} from '@/modules/analytics';
import { toActionError } from '@/workflows/action-errors';

/**
 * The analytics refresh action (Prompts 143, 146).
 *
 * The dashboard's historical numbers are aggregated on demand. The action is
 * the administrator's refresh button: it aggregates the selected range and
 * exits. There is no queue, no worker, and no recurring schedule.
 */

const refreshInputSchema = z
  .object({
    startDate: z.string(),
    endDate: z.string(),
  })
  .refine(value => isCalendarDay(value.startDate) && isCalendarDay(value.endDate), {
    message: 'The range must use calendar days.',
  });

/**
 * Aggregate the analytics of a range.
 *
 * @param input the first and last day of the range
 * @returns the range that was aggregated
 */
export async function refreshAnalyticsAction(
  input: unknown
): Promise<ActionResult<{ startDate: string; endDate: string; days: number }>> {
  try {
    const actor = await resolveActor();
    requireUser(actor);

    if (!hasPermission(actor, toPermissionKey('analytics', 'manage'))) {
      return {
        ok: false,
        error: { code: 'forbidden', message: 'You may not refresh the analytics.' },
      };
    }

    const parsed = refreshInputSchema.safeParse(input);

    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'validation_error',
          message: 'The analytics range is not valid.',
          fieldErrors: {
            body: parsed.error.issues.map(issue => issue.message),
          },
        },
      };
    }

    // The range is bounded by the shared date rules, so an unrestricted
    // analytics query can never be triggered from the URL.
    const range = buildDateRange(parsed.data.startDate, parsed.data.endDate);

    await aggregateDateRange(range.startDate, range.endDate);

    return {
      ok: true,
      data: { startDate: range.startDate, endDate: range.endDate, days: range.dayCount },
    };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/**
 * Aggregate the current Dhaka day.
 *
 * @returns the day that was aggregated
 */
export async function refreshTodayAnalyticsAction(): Promise<
  ActionResult<{ date: string }>
> {
  try {
    const actor = await resolveActor();
    requireUser(actor);

    if (!hasPermission(actor, toPermissionKey('analytics', 'manage'))) {
      return {
        ok: false,
        error: { code: 'forbidden', message: 'You may not refresh the analytics.' },
      };
    }

    const { dhakaDateString } = await import('@/modules/analytics');
    const date = dhakaDateString(new Date());

    await aggregateDailyAnalytics(date, 'drama', null);
    await aggregateDailyAnalytics(date, 'movie', null);
    await aggregateDailyAnalytics(date, null, null);

    return { ok: true, data: { date } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
