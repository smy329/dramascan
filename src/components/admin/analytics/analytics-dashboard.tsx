import type { JSX, ReactNode } from 'react';
import Link from 'next/link';

import type {
  AnalyticsOverview,
  ContentPerformanceRow,
  DateRange,
  DateRangePreset,
  EngagementTrendPoint,
  ViewerActivityRow,
} from '@/modules/analytics';
import { DATE_RANGE_PRESET_LABELS, DATE_RANGE_PRESETS } from '@/modules/analytics';

import { AnalyticsRefreshButton } from './analytics-refresh-button';
import { OperationalRefresh } from './operational-refresh';

/**
 * The administrator analytics dashboard (Prompts 144, 145, 146).
 *
 * The dashboard shows four things: the overview of the selected range, the
 * content that earned the attention, the viewer's activity, and the daily
 * engagement trend. Everything is read from the stored daily aggregates, so a
 * page refresh cannot inflate a number and the page stays cheap.
 *
 * Historical numbers are refreshed by a button. Today's numbers are the
 * exception: `OperationalRefresh` re-aggregates the current Dhaka day once a
 * minute while the tab is visible, so the default range (which includes today)
 * is never stale (D-068). The "last updated" line says when the numbers were
 * last written, so the administrator always knows how fresh the data is.
 */

export type AnalyticsDashboardProps = Readonly<{
  /** The resolved range. */
  range: DateRange;
  /** The overview numbers. */
  overview: AnalyticsOverview;
  /** The content-performance rows. */
  performance: readonly ContentPerformanceRow[];
  /** The daily engagement trend. */
  trend: readonly EngagementTrendPoint[];
  /** The daily viewer activity. */
  activity: readonly ViewerActivityRow[];
  /** When the aggregates were last written. */
  lastUpdated: Date | null;
  /** Whether the viewer may refresh the aggregates. */
  canManage: boolean;
}>;

/** The presets that are offered as links. `custom` needs two explicit days. */
const LINKED_PRESETS: readonly DateRangePreset[] = DATE_RANGE_PRESETS.filter(
  preset => preset !== 'custom'
);

/** Format a number of seconds as a readable duration. */
function formatDuration(seconds: number): string {
  if (seconds <= 0) {
    return '0m';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);

  if (hours === 0) {
    return `${minutes}m`;
  }

  return `${hours}h ${minutes}m`;
}

/** Format a fraction as a percentage. */
function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Format an instant for the dashboard's display timezone. */
function formatInstant(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Dhaka',
  }).format(new Date(instant));
}

/** One overview metric. */
function Metric({
  label,
  value,
}: Readonly<{ label: string; value: string }>): JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

/** The shared table shell. */
function Panel({
  title,
  description,
  children,
}: Readonly<{ title: string; description: string; children: ReactNode }>): JSX.Element {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-medium text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 overflow-x-auto">{children}</div>
    </section>
  );
}

/** The empty state of a table. */
function NoRows(): JSX.Element {
  return <p className="text-sm text-muted-foreground">No data for this range yet.</p>;
}

/**
 * The custom-range control.
 *
 * The presets are links; a custom range needs two explicit days, so the
 * control is a form that submits the two days and the `custom` preset to the
 * same page. It is a plain GET form, so it works without any client-side
 * JavaScript and the selected range stays in the URL.
 */
function CustomRangeForm({ range }: Readonly<{ range: DateRange }>): JSX.Element {
  const custom = range.preset === 'custom';

  return (
    <form
      aria-label="Custom range"
      method="get"
      action="/admin/analytics"
      className="flex flex-wrap items-end gap-2"
    >
      <input type="hidden" name="range" value="custom" />

      <div className="flex flex-col gap-1">
        <label
          htmlFor="analytics-range-start"
          className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"
        >
          From
        </label>
        <input
          id="analytics-range-start"
          name="start"
          type="date"
          defaultValue={custom ? range.startDate : ''}
          max={custom ? range.endDate : undefined}
          className="min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="analytics-range-end"
          className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground"
        >
          To
        </label>
        <input
          id="analytics-range-end"
          name="end"
          type="date"
          defaultValue={custom ? range.endDate : ''}
          min={custom ? range.startDate : undefined}
          className="min-h-11 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      <button
        type="submit"
        className="inline-flex min-h-11 items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
      >
        Apply
      </button>
    </form>
  );
}

export function AnalyticsDashboard({
  range,
  overview,
  performance,
  trend,
  activity,
  lastUpdated,
  canManage,
}: Readonly<AnalyticsDashboardProps>) {
  const preset = range.preset;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {range.startDate} to {range.endDate} · {range.dayCount} day
            {range.dayCount === 1 ? '' : 's'} · Asia/Dhaka
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="flex flex-wrap items-center gap-3">
            {canManage ? (
              <AnalyticsRefreshButton startDate={range.startDate} endDate={range.endDate} />
            ) : null}

            <OperationalRefresh />

            <p className="text-sm text-muted-foreground">
              <span>Last updated</span>{' '}
              <time dateTime={lastUpdated?.toISOString() ?? undefined}>
                {lastUpdated ? formatInstant(lastUpdated) : 'never'}
              </time>
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Today is refreshed automatically every minute while this tab is open.
          </p>
        </div>
      </header>

      <nav aria-label="Date range" className="flex flex-wrap items-center gap-2">
        {LINKED_PRESETS.map(option => {
          const label = DATE_RANGE_PRESET_LABELS[option];
          const active = option === preset;

          return (
            <Link
              key={option}
              href={`/admin/analytics?range=${option}`}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'inline-flex min-h-11 items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground'
                  : 'inline-flex min-h-11 items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground'
              }
            >
              {label}
            </Link>
          );
        })}

        <CustomRangeForm range={range} />
      </nav>

      <section aria-label="Overview" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total views" value={overview.totalViews.toLocaleString('en-GB')} />
        <Metric label="Unique viewers" value={overview.uniqueVisitors.toLocaleString('en-GB')} />
        <Metric
          label="Signed-in viewers"
          value={overview.authenticatedViewers.toLocaleString('en-GB')}
        />
        <Metric label="Guest viewers" value={overview.guestViewers.toLocaleString('en-GB')} />
        <Metric label="Watch time" value={formatDuration(overview.totalWatchDurationSeconds)} />
        <Metric
          label="Playback starts"
          value={overview.playbackStarts.toLocaleString('en-GB')}
        />
        <Metric
          label="Playback viewers"
          value={overview.playbackViewers.toLocaleString('en-GB')}
        />
        <Metric label="Completion rate" value={formatPercent(overview.completionRate)} />
        <Metric label="Playback events" value={overview.totalPlaybackEvents.toLocaleString('en-GB')} />
        <Metric label="Completions" value={overview.completionEvents.toLocaleString('en-GB')} />
        <Metric
          label="Average per playback viewer"
          value={formatDuration(overview.averageWatchDurationSeconds)}
        />
      </section>

      <p className="text-xs text-muted-foreground">
        Completion rate is completions divided by playback starts. Average watch time is divided by
        the viewers who actually played, not by every visitor. A viewer is counted as signed in
        when at least one of their events in the range happened while they were signed in.
      </p>

      <Panel
        title="Content performance"
        description="The titles that earned the views and the watch time in this range."
      >
        {performance.length === 0 ? (
          <NoRows />
        ) : (
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 pr-4">Title</th>
                <th scope="col" className="py-2 pr-4">Type</th>
                <th scope="col" className="py-2 pr-4">Views</th>
                <th scope="col" className="py-2 pr-4">Viewers</th>
                <th scope="col" className="py-2 pr-4">Watch duration</th>
                <th scope="col" className="py-2 pr-4">Starts</th>
                <th scope="col" className="py-2 pr-4">Completions</th>
                <th scope="col" className="py-2">Completion %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {performance.map(row => (
                <tr key={`${row.type}:${row.id}`}>
                  <td className="py-2 pr-4 font-medium text-foreground">{row.title}</td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {row.type === 'movie' ? 'Movie' : 'Drama'}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{row.views.toLocaleString('en-GB')}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {row.uniqueVisitors.toLocaleString('en-GB')}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {formatDuration(row.watchDurationSeconds)}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {row.playbackStarts.toLocaleString('en-GB')}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {row.completions.toLocaleString('en-GB')}
                  </td>
                  <td className="py-2 tabular-nums">{formatPercent(row.completionRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="Viewer activity"
        description="How many viewers there were each day, and how much they watched."
      >
        {activity.length === 0 ? (
          <NoRows />
        ) : (
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 pr-4">Day</th>
                <th scope="col" className="py-2 pr-4">Viewers</th>
                <th scope="col" className="py-2 pr-4">Signed-in</th>
                <th scope="col" className="py-2 pr-4">Guests</th>
                <th scope="col" className="py-2 pr-4">Views</th>
                <th scope="col" className="py-2 pr-4">Playback events</th>
                <th scope="col" className="py-2">Average per playback viewer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {activity.map(row => (
                <tr key={row.date}>
                  <td className="py-2 pr-4 font-medium text-foreground">{row.date}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {row.uniqueVisitors.toLocaleString('en-GB')}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {row.authenticatedViewers.toLocaleString('en-GB')}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {row.guestViewers.toLocaleString('en-GB')}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{row.totalViews.toLocaleString('en-GB')}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {row.playbackEvents.toLocaleString('en-GB')}
                  </td>
                  <td className="py-2 tabular-nums">
                    {formatDuration(row.averageWatchDurationSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="Engagement trend"
        description="The daily totals across the selected range."
      >
        {trend.length === 0 ? (
          <NoRows />
        ) : (
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 pr-4">Day</th>
                <th scope="col" className="py-2 pr-4">Viewers</th>
                <th scope="col" className="py-2 pr-4">Views</th>
                <th scope="col" className="py-2 pr-4">Watch duration</th>
                <th scope="col" className="py-2">Completions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {trend.map(point => (
                <tr key={point.date}>
                  <td className="py-2 pr-4 font-medium text-foreground">{point.date}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {point.uniqueVisitors.toLocaleString('en-GB')}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {point.totalViews.toLocaleString('en-GB')}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {formatDuration(point.watchDurationSeconds)}
                  </td>
                  <td className="py-2 tabular-nums">
                    {point.completionEvents.toLocaleString('en-GB')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
