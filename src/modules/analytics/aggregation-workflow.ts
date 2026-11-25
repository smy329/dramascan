import 'server-only';

import { and, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import {
  analytics_daily_aggregates,
  content_view_events,
  playback_analytics_events,
} from '@/modules/analytics/schema';
import { addDays, dhakaDateString, startOfDhakaDay } from '@/modules/analytics/date-filters';

/**
 * The analytics aggregation (Prompt 143).
 *
 * The daily aggregate table is the dashboard's read model. It answers "what
 * happened on this day", which the raw event tables cannot answer cheaply.
 *
 * Aggregation runs **on demand**: a short-lived command or an administrator's
 * refresh button calls it, it writes its result, and it exits. There is no
 * queue, no worker, no Redis, and no recurring schedule — the platform has
 * none of those and must not acquire them.
 *
 * Two decisions shape the numbers:
 *
 *   - **The day is the Dhaka day.** The stored timestamps are UTC; the day a
 *     row belongs to is the `Asia/Dhaka` calendar day it falls on.
 *   - **A visitor is one visitor.** The distinct-visitor count of a day is the
 *     number of distinct visitors, not the sum of the per-content distinct
 *     counts: a visitor who opened two titles is still one visitor.
 */

/** The scope one aggregation run covers. */
export type AggregationScope =
  | { kind: 'site' }
  | { kind: 'type'; type: 'drama' | 'movie' }
  | { kind: 'content'; type: 'drama' | 'movie'; contentId: string };

/** One aggregate row before it is written. */
export type AggregateRow = {
  date: string;
  contentType: 'drama' | 'movie' | null;
  contentId: string | null;
  uniqueVisitors: number;
  totalViews: number;
  totalPlaybackEvents: number;
  /** Playback starts: the bounded `play` event. */
  playbackStarts: number;
  /** Distinct visitors that actually played something. */
  playbackViewers: number;
  completionEvents: number;
  totalWatchDurationSeconds: number;
};

/**
 * Aggregate the analytics of one Dhaka day.
 *
 * The scope decides which aggregate rows are written:
 *
 *   - `site` writes the one site-wide row of the day.
 *   - `type` writes one row per drama or per movie that had activity.
 *   - `content` writes the one row of one title.
 *
 * Re-running the same day replaces the rows of that scope, so the operation
 * is idempotent: refreshing never doubles a number.
 *
 * @param date the `YYYY-MM-DD` Dhaka day
 * @param type `null` for the site-wide row, otherwise the content type
 * @param contentId the title, when a single title is aggregated
 */
export async function aggregateDailyAnalytics(
  date: string,
  type: 'drama' | 'movie' | null,
  contentId: string | null
): Promise<void> {
  const scope: AggregationScope =
    type === null
      ? { kind: 'site' }
      : contentId === null
        ? { kind: 'type', type }
        : { kind: 'content', type, contentId };

  const start = startOfDhakaDay(date);
  const end = startOfDhakaDay(addDays(date, 1));

  await aggregateScope(scope, date, date, start, end);
}

/**
 * Aggregate the analytics of one scope over a range of Dhaka days.
 *
 * The whole range is computed in **one pass per scope**: the queries group by
 * the Dhaka day, so a range produces one row per day without a read per day.
 * The rows of the range are then replaced in one transaction, so a refresh
 * never doubles a number and never leaves a half-written range behind.
 *
 * Two refreshes of the same scope may run at the same time — the dashboard
 * refreshes the current day every minute, and an administrator may press the
 * button as well. The transaction therefore takes a scope-scoped advisory
 * lock, so the two refreshes queue instead of interleaving, and the insert
 * ignores a conflict, so the database refuses a duplicate row even if the
 * lock was not enough (D-070).
 */
async function aggregateScope(
  scope: AggregationScope,
  startDate: string,
  endDate: string,
  start: Date,
  end: Date
): Promise<void> {
  const rows = await computeAggregateRows(scope, start, end, db);

  await db.transaction(async tx => {
    await lockScope(tx, scope);
    await deleteScopedRange(scope, startDate, endDate, tx);
    await insertAggregateRows(rows, tx);
  });
}

/**
 * Serialize the refreshes of one scope.
 *
 * The lock is transaction-scoped: it is taken when the transaction starts and
 * released when it commits, so a crashed refresh never leaves a lock behind.
 * The key is derived from the scope, so the refresh of one title never waits
 * for the refresh of another.
 *
 * @param executor the transaction
 * @param scope the scope the run covers
 */
async function lockScope(executor: DbExecutor, scope: AggregationScope): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${scopeLockKey(scope)}))`);
}

/** The lock key of one scope. */
function scopeLockKey(scope: AggregationScope): string {
  if (scope.kind === 'site') {
    return 'analytics:site';
  }

  if (scope.kind === 'type') {
    return `analytics:type:${scope.type}`;
  }

  return `analytics:content:${scope.type}:${scope.contentId}`;
}

/**
 * Aggregate the analytics of the current Dhaka day.
 *
 * This is the operational refresh: the dashboard calls it for the "today"
 * preset, so the current day is always current.
 */
export async function aggregateToday(): Promise<void> {
  const date = dhakaDateString(new Date());

  await aggregateDailyAnalytics(date, 'drama', null);
  await aggregateDailyAnalytics(date, 'movie', null);
  await aggregateDailyAnalytics(date, null, null);
}

/**
 * Aggregate a range of Dhaka days, historically.
 *
 * Historical numbers only change when somebody asks for them, so this is a
 * deliberate, bounded operation. The range is computed in **one pass per
 * scope**, not one pass per day: the queries group by the Dhaka day, so a
 * 366-day range costs the same number of reads as a single day.
 *
 * @param startDate the first `YYYY-MM-DD` day, inclusive
 * @param endDate the last `YYYY-MM-DD` day, inclusive
 */
export async function aggregateDateRange(startDate: string, endDate: string): Promise<void> {
  const start = startOfDhakaDay(startDate);
  const end = startOfDhakaDay(addDays(endDate, 1));

  await aggregateScope({ kind: 'type', type: 'drama' }, startDate, endDate, start, end);
  await aggregateScope({ kind: 'type', type: 'movie' }, startDate, endDate, start, end);
  await aggregateScope({ kind: 'site' }, startDate, endDate, start, end);
}

/**
 * Run one raw aggregate query and return its rows as plain records.
 *
 * The driver reports the rows of a raw statement in its own shape, so the
 * helper normalises them once instead of at every read.
 */
async function runQuery(
  executor: DbExecutor,
  statement: SQL
): Promise<Record<string, unknown>[]> {
  const result = await executor.execute(statement);

  if (typeof result === 'object' && result !== null && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;

    if (Array.isArray(rows)) {
      return rows as Record<string, unknown>[];
    }
  }

  return [];
}

/**
 * Compute the aggregate rows of a scope for a UTC window.
 *
 * The window is one day for a daily run and a range for a historical run; the
 * day a row belongs to is derived from the event's own timestamp, so a range
 * produces one row per day.
 */
async function computeAggregateRows(
  scope: AggregationScope,
  start: Date,
  end: Date,
  executor: DbExecutor
): Promise<AggregateRow[]> {
  const viewFilter = buildViewFilter(scope);
  const playbackFilter = buildPlaybackFilter(scope);

  const [
    viewRows,
    playbackRows,
    visitorRows,
    watchRows,
    playbackViewerRows,
    siteVisitorRows,
    sitePlaybackViewerRows,
  ] = await Promise.all([
    runQuery(
      executor,
      sql`
      select to_char(${content_view_events.viewed_at} at time zone 'UTC' + interval '6 hours', 'YYYY-MM-DD') as day,
             ${content_view_events.content_type} as content_type,
             ${content_view_events.content_id}::text as target_id,
             count(*)::int as total_views
        from ${content_view_events}
       where ${content_view_events.deleted_at} is null
         and ${content_view_events.viewed_at} >= ${start}
         and ${content_view_events.viewed_at} < ${end}
         ${viewFilter}
       group by 1, 2, 3
    `
    ),
    runQuery(
      executor,
      sql`
      select to_char(${playback_analytics_events.event_at} at time zone 'UTC' + interval '6 hours', 'YYYY-MM-DD') as day,
             ${playback_analytics_events.content_type} as content_type,
             coalesce(${playback_analytics_events.drama_id}, ${playback_analytics_events.movie_id})::text as target_id,
             count(*)::int as total_playback_events,
             count(*) filter (where ${playback_analytics_events.event_type} = 'play')::int as playback_starts,
             count(*) filter (where ${playback_analytics_events.completion_threshold_met})::int as completion_events
        from ${playback_analytics_events}
       where ${playback_analytics_events.deleted_at} is null
         and ${playback_analytics_events.event_at} >= ${start}
         and ${playback_analytics_events.event_at} < ${end}
         ${playbackFilter}
       group by 1, 2, 3
    `
    ),
    runQuery(
      executor,
      sql`
      select to_char(${content_view_events.viewed_at} at time zone 'UTC' + interval '6 hours', 'YYYY-MM-DD') as day,
             ${content_view_events.content_type} as content_type,
             ${content_view_events.content_id}::text as target_id,
             count(distinct ${content_view_events.guest_session_id})::int as unique_visitors
        from ${content_view_events}
       where ${content_view_events.deleted_at} is null
         and ${content_view_events.viewed_at} >= ${start}
         and ${content_view_events.viewed_at} < ${end}
         and ${content_view_events.guest_session_id} is not null
         ${viewFilter}
       group by 1, 2, 3
    `
    ),
    runQuery(
      executor,
      sql`
      select to_char(${playback_analytics_events.event_at} at time zone 'UTC' + interval '6 hours', 'YYYY-MM-DD') as day,
             ${playback_analytics_events.content_type} as content_type,
             coalesce(${playback_analytics_events.drama_id}, ${playback_analytics_events.movie_id})::text as target_id,
             coalesce(sum(${playback_analytics_events.watch_duration_seconds}), 0)::int as total_watch_duration_seconds
        from ${playback_analytics_events}
       where ${playback_analytics_events.deleted_at} is null
         and ${playback_analytics_events.event_at} >= ${start}
         and ${playback_analytics_events.event_at} < ${end}
         ${playbackFilter}
       group by 1, 2, 3
    `
    ),
    runQuery(
      executor,
      sql`
      select to_char(${playback_analytics_events.event_at} at time zone 'UTC' + interval '6 hours', 'YYYY-MM-DD') as day,
             ${playback_analytics_events.content_type} as content_type,
             coalesce(${playback_analytics_events.drama_id}, ${playback_analytics_events.movie_id})::text as target_id,
             count(distinct ${playback_analytics_events.guest_session_id})::int as playback_viewers
        from ${playback_analytics_events}
       where ${playback_analytics_events.deleted_at} is null
         and ${playback_analytics_events.event_at} >= ${start}
         and ${playback_analytics_events.event_at} < ${end}
         and ${playback_analytics_events.guest_session_id} is not null
         ${playbackFilter}
       group by 1, 2, 3
    `
    ),
    scope.kind === 'site'
      ? runQuery(
          executor,
          sql`
          select to_char(seen.day_at at time zone 'UTC' + interval '6 hours', 'YYYY-MM-DD') as day,
                 count(distinct seen.visitor)::int as unique_visitors
            from (
              select ${content_view_events.viewed_at} as day_at, ${content_view_events.guest_session_id} as visitor
                from ${content_view_events}
               where ${content_view_events.deleted_at} is null
                 and ${content_view_events.viewed_at} >= ${start}
                 and ${content_view_events.viewed_at} < ${end}
                 and ${content_view_events.guest_session_id} is not null
              union all
              select ${playback_analytics_events.event_at} as day_at, ${playback_analytics_events.guest_session_id} as visitor
                from ${playback_analytics_events}
               where ${playback_analytics_events.deleted_at} is null
                 and ${playback_analytics_events.event_at} >= ${start}
                 and ${playback_analytics_events.event_at} < ${end}
                 and ${playback_analytics_events.guest_session_id} is not null
            ) seen
           group by 1
        `
        )
      : Promise.resolve([] as Record<string, unknown>[]),
    scope.kind === 'site'
      ? runQuery(
          executor,
          sql`
          select to_char(${playback_analytics_events.event_at} at time zone 'UTC' + interval '6 hours', 'YYYY-MM-DD') as day,
                 count(distinct ${playback_analytics_events.guest_session_id})::int as playback_viewers
            from ${playback_analytics_events}
           where ${playback_analytics_events.deleted_at} is null
             and ${playback_analytics_events.event_at} >= ${start}
             and ${playback_analytics_events.event_at} < ${end}
             and ${playback_analytics_events.guest_session_id} is not null
           group by 1
        `
        )
      : Promise.resolve([] as Record<string, unknown>[]),
  ]);

  const rows = new Map<string, AggregateRow>();

  const rowFor = (day: string, contentType: string, targetId: string): AggregateRow => {
    const key = `${day}|${contentType}|${targetId}`;
    const existing = rows.get(key);

    if (existing) {
      return existing;
    }

    const created: AggregateRow = {
      date: day,
      contentType: contentType === 'movie' ? 'movie' : 'drama',
      contentId: targetId,
      uniqueVisitors: 0,
      totalViews: 0,
      totalPlaybackEvents: 0,
      playbackStarts: 0,
      playbackViewers: 0,
      completionEvents: 0,
      totalWatchDurationSeconds: 0,
    };

    rows.set(key, created);

    return created;
  };

  for (const row of viewRows) {
    const record = row as Record<string, unknown>;
    const day = String(record.day);
    const contentType = String(record.content_type);
    const targetId = String(record.target_id);

    rowFor(day, contentType, targetId).totalViews += Number(record.total_views ?? 0);
  }

  for (const row of playbackRows) {
    const record = row as Record<string, unknown>;
    const day = String(record.day);
    const contentType = String(record.content_type);
    const targetId = String(record.target_id);
    const target = rowFor(day, contentType, targetId);

    target.totalPlaybackEvents += Number(record.total_playback_events ?? 0);
    target.playbackStarts += Number(record.playback_starts ?? 0);
    target.completionEvents += Number(record.completion_events ?? 0);
  }

  for (const row of playbackViewerRows) {
    const record = row as Record<string, unknown>;
    const day = String(record.day);
    const contentType = String(record.content_type);
    const targetId = String(record.target_id);

    rowFor(day, contentType, targetId).playbackViewers += Number(
      record.playback_viewers ?? 0
    );
  }

  for (const row of visitorRows) {
    const record = row as Record<string, unknown>;
    const day = String(record.day);
    const contentType = String(record.content_type);
    const targetId = String(record.target_id);

    rowFor(day, contentType, targetId).uniqueVisitors += Number(record.unique_visitors ?? 0);
  }

  for (const row of watchRows) {
    const record = row as Record<string, unknown>;
    const day = String(record.day);
    const contentType = String(record.content_type);
    const targetId = String(record.target_id);

    rowFor(day, contentType, targetId).totalWatchDurationSeconds += Number(
      record.total_watch_duration_seconds ?? 0
    );
  }

  if (scope.kind === 'site') {
    return buildSiteRows(rows, siteVisitorRows, sitePlaybackViewerRows);
  }

  return [...rows.values()];
}

/**
 * Fold the per-title rows of a scope into the one site-wide row per day.
 *
 * The visitor count cannot be folded: a visitor who opened two titles is one
 * visitor, not two. The site-wide distinct visitor count is therefore read
 * from its own query.
 */
async function buildSiteRows(
  rows: Map<string, AggregateRow>,
  siteVisitors: readonly Record<string, unknown>[],
  sitePlaybackViewers: readonly Record<string, unknown>[]
): Promise<AggregateRow[]> {
  const byDay = new Map<string, AggregateRow>();

  for (const row of rows.values()) {
    const existing = byDay.get(row.date);

    if (!existing) {
      byDay.set(row.date, {
        ...row,
        contentType: null,
        contentId: null,
        // Both visitor counts are distinct counts across the whole site, so
        // they cannot be folded from the per-title rows; the site queries
        // below fill them.
        uniqueVisitors: 0,
        playbackViewers: 0,
      });
      continue;
    }

    existing.totalViews += row.totalViews;
    existing.totalPlaybackEvents += row.totalPlaybackEvents;
    existing.playbackStarts += row.playbackStarts;
    existing.completionEvents += row.completionEvents;
    existing.totalWatchDurationSeconds += row.totalWatchDurationSeconds;
  }

  for (const row of siteVisitors) {
    const record = row as Record<string, unknown>;
    const day = String(record.day);
    const existing = byDay.get(day);

    if (existing) {
      existing.uniqueVisitors = Number(record.unique_visitors ?? 0);
      continue;
    }

    byDay.set(day, {
      date: day,
      contentType: null,
      contentId: null,
      uniqueVisitors: Number(record.unique_visitors ?? 0),
      totalViews: 0,
      totalPlaybackEvents: 0,
      playbackStarts: 0,
      playbackViewers: 0,
      completionEvents: 0,
      totalWatchDurationSeconds: 0,
    });
  }

  for (const row of sitePlaybackViewers) {
    const record = row as Record<string, unknown>;
    const day = String(record.day);
    const existing = byDay.get(day);

    if (existing) {
      existing.playbackViewers = Number(record.playback_viewers ?? 0);
      continue;
    }

    byDay.set(day, {
      date: day,
      contentType: null,
      contentId: null,
      uniqueVisitors: 0,
      totalViews: 0,
      totalPlaybackEvents: 0,
      playbackStarts: 0,
      playbackViewers: Number(record.playback_viewers ?? 0),
      completionEvents: 0,
      totalWatchDurationSeconds: 0,
    });
  }

  return [...byDay.values()];
}

/** The filter that restricts a run to the titles of its scope. */
function buildViewFilter(scope: AggregationScope): SQL {
  if (scope.kind === 'content') {
    return scope.type === 'drama'
      ? sql`and ${content_view_events.drama_id} = ${scope.contentId}`
      : sql`and ${content_view_events.movie_id} = ${scope.contentId}`;
  }

  if (scope.kind === 'type') {
    return sql`and ${content_view_events.content_type} = ${scope.type}`;
  }

  return sql``;
}

/** The filter that restricts a run to the titles of its scope. */
function buildPlaybackFilter(scope: AggregationScope): SQL {
  if (scope.kind === 'content') {
    return scope.type === 'drama'
      ? sql`and ${playback_analytics_events.drama_id} = ${scope.contentId}`
      : sql`and ${playback_analytics_events.movie_id} = ${scope.contentId}`;
  }

  if (scope.kind === 'type') {
    return sql`and ${playback_analytics_events.content_type} = ${scope.type}`;
  }

  return sql``;
}

/** Remove the rows a run is about to replace. */
async function deleteScopedRange(
  scope: AggregationScope,
  startDate: string,
  endDate: string,
  executor: DbExecutor
): Promise<void> {
  // The `date` column is a `YYYY-MM-DD` string, so the comparison is a
  // lexicographic one and it orders the days exactly.
  const dateFilter = and(
    gte(analytics_daily_aggregates.date, startDate),
    lte(analytics_daily_aggregates.date, endDate)
  );

  if (scope.kind === 'site') {
    await executor
      .delete(analytics_daily_aggregates)
      .where(
        and(
          dateFilter,
          isNull(analytics_daily_aggregates.content_type)
        )
      );

    return;
  }

  if (scope.kind === 'type') {
    await executor
      .delete(analytics_daily_aggregates)
      .where(
        and(
          dateFilter,
          eq(analytics_daily_aggregates.content_type, scope.type)
        )
      );

    return;
  }

  await executor
    .delete(analytics_daily_aggregates)
    .where(
      and(
        dateFilter,
        eq(analytics_daily_aggregates.content_type, scope.type),
        eq(analytics_daily_aggregates.content_id, scope.contentId)
      )
    );
}

/** Write the aggregate rows of a run. */
async function insertAggregateRows(
  rows: readonly AggregateRow[],
  executor: DbExecutor
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  // The partial unique indexes are the authority: a row that already exists
  // for the same logical key is left alone instead of being written twice.
  await executor
    .insert(analytics_daily_aggregates)
    .values(
      rows.map(row => ({
        date: row.date,
        content_type: row.contentType,
        content_id: row.contentId,
        drama_id: row.contentType === 'drama' ? row.contentId : null,
        movie_id: row.contentType === 'movie' ? row.contentId : null,
        unique_visitors: row.uniqueVisitors,
        total_views: row.totalViews,
        total_playback_events: row.totalPlaybackEvents,
        playback_starts: row.playbackStarts,
        playback_viewers: row.playbackViewers,
        completion_events: row.completionEvents,
        total_watch_duration_seconds: row.totalWatchDurationSeconds,
        created_at: sql`now()`,
        updated_at: sql`now()`,
      }))
    )
    .onConflictDoNothing();
}
