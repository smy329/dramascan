import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { AnalyticsDashboard } from '@/components/admin/analytics/analytics-dashboard';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import {
  buildDateRange,
  getAnalyticsLastUpdated,
  getAnalyticsOverview,
  isCalendarDay,
  isDateRangePreset,
  listContentPerformance,
  listEngagementTrend,
  listViewerActivity,
  resolveDateRange,
  type DateRange,
} from '@/modules/analytics';

import { requireAdminPageAccess } from '../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/analytics';

/**
 * The administrator analytics dashboard page (Prompts 144, 145, 146).
 *
 * The page resolves the selected range from the URL, reads the four dashboard
 * read models, and hands them to the dashboard component. The range is always
 * bounded: an unknown preset falls back to the default range, and a custom
 * range is validated before it reaches a query.
 */
export default async function AdminAnalyticsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  // The navigation is never the boundary: the page checks the canonical
  // permission itself.
  if (!hasPermission(actor, toPermissionKey('analytics', 'read'))) {
    notFound();
  }

  const raw = await searchParams;
  const range = resolveRange(raw);

  const [overview, performance, trend, activity, lastUpdated] = await Promise.all([
    getAnalyticsOverview(range),
    listContentPerformance(range),
    listEngagementTrend(range),
    listViewerActivity(range),
    getAnalyticsLastUpdated(),
  ]);

  return (
    <AnalyticsDashboard
      range={range}
      overview={overview}
      performance={performance}
      trend={trend}
      activity={activity}
      lastUpdated={lastUpdated}
      canManage={hasPermission(actor, toPermissionKey('analytics', 'manage'))}
    />
  );
}

/**
 * Resolve the selected range from the URL.
 *
 * The URL is untrusted input: an unknown preset falls back to the default
 * range, and a custom range that is not a pair of real calendar days falls
 * back as well. The result is always a bounded range.
 */
function resolveRange(raw: Record<string, string | string[] | undefined>): DateRange {
  const preset = typeof raw.range === 'string' ? raw.range : '';

  if (preset === 'custom') {
    const start = typeof raw.start === 'string' ? raw.start : '';
    const end = typeof raw.end === 'string' ? raw.end : '';

    if (isCalendarDay(start) && isCalendarDay(end)) {
      try {
        return buildDateRange(start, end, 'custom');
      } catch {
        // An inverted or oversized range falls back to the default range.
      }
    }
  }

  if (isDateRangePreset(preset) && preset !== 'custom') {
    return resolveDateRange(preset);
  }

  return resolveDateRange('last_7_days');
}
