// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { AnalyticsDashboard } from '@/components/admin/analytics/analytics-dashboard';
import type {
  AnalyticsOverview,
  ContentPerformanceRow,
  DateRange,
  EngagementTrendPoint,
  ViewerActivityRow,
} from '@/modules/analytics';

/**
 * The administrator analytics dashboard controls (D-077).
 *
 * Two things the dashboard owes the administrator:
 *
 *   - **A custom range.** The presets are links; a custom range needs two
 *     explicit days, so the control is a form that submits the two days and
 *     the `custom` preset to the same page.
 *   - **The viewer split.** "Unique viewers" alone cannot say who watched:
 *     a signed-in viewer and a guest are different audiences, and the platform
 *     needs to know which one it reached.
 */

vi.mock('server-only', () => ({}));
// The dashboard is a Server Component that reads the analytics module's public
// API. The unit run only checks the markup, so the server marker and the
// database client are neutralised.
vi.mock('@/db/client', () => ({ db: {} }));

vi.mock('@/components/admin/analytics/analytics-refresh-button', () => ({
  AnalyticsRefreshButton: () => null,
}));

vi.mock('@/components/admin/analytics/operational-refresh', () => ({
  OperationalRefresh: () => null,
}));

afterEach(() => {
  cleanup();
});

const RANGE: DateRange = {
  startDate: '2026-11-01',
  endDate: '2026-11-07',
  startInstant: new Date('2026-10-31T18:00:00.000Z'),
  endInstant: new Date('2026-11-07T18:00:00.000Z'),
  dayCount: 7,
  preset: 'custom',
};

const OVERVIEW: AnalyticsOverview = {
  uniqueVisitors: 120,
  authenticatedViewers: 45,
  guestViewers: 75,
  totalViews: 400,
  totalWatchDurationSeconds: 7200,
  playbackStarts: 90,
  playbackViewers: 60,
  completionRate: 0.466,
  totalPlaybackEvents: 300,
  completionEvents: 42,
  averageWatchDurationSeconds: 120,
};

const PERFORMANCE: ContentPerformanceRow[] = [];
const TREND: EngagementTrendPoint[] = [];

const ACTIVITY: ViewerActivityRow[] = [
  {
    date: '2026-11-01',
    uniqueVisitors: 10,
    authenticatedViewers: 4,
    guestViewers: 6,
    totalViews: 30,
    playbackEvents: 20,
    playbackViewers: 8,
    averageWatchDurationSeconds: 120,
  },
];

function renderDashboard(): void {
  render(
    <AnalyticsDashboard
      range={RANGE}
      overview={OVERVIEW}
      performance={PERFORMANCE}
      trend={TREND}
      activity={ACTIVITY}
      lastUpdated={null}
      canManage={false}
    />
  );
}

describe('AnalyticsDashboard', () => {
  it('offers a custom date range', () => {
    renderDashboard();

    const form = screen.getByRole('form', { name: /custom range/i });

    expect(form).toBeDefined();
    expect(form.getAttribute('method')).toBe('get');
    expect(form.getAttribute('action')).toBe('/admin/analytics');

    const hidden = form.querySelector('input[name="range"]');

    expect(hidden?.getAttribute('value')).toBe('custom');
    expect(form.querySelector('input[name="start"]')).not.toBeNull();
    expect(form.querySelector('input[name="end"]')).not.toBeNull();
  });

  it('keeps the selected custom range in the form', () => {
    renderDashboard();

    const form = screen.getByRole('form', { name: /custom range/i });
    const start = form.querySelector('input[name="start"]') as HTMLInputElement;
    const end = form.querySelector('input[name="end"]') as HTMLInputElement;

    expect(start.value).toBe('2026-11-01');
    expect(end.value).toBe('2026-11-07');
  });

  it('shows how many of the viewers were signed in', () => {
    renderDashboard();

    expect(screen.getByText('Signed-in viewers')).toBeDefined();
    expect(screen.getByText('Guest viewers')).toBeDefined();
    expect(screen.getByText('45')).toBeDefined();
    expect(screen.getByText('75')).toBeDefined();
  });

  it('shows the split in the daily viewer activity', () => {
    renderDashboard();

    expect(screen.getByText('Signed-in')).toBeDefined();
    expect(screen.getByText('Guests')).toBeDefined();
  });
});
