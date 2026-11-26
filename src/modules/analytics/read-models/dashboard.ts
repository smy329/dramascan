import 'server-only';

import { and, desc, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db/client';

import { analytics_daily_aggregates, content_view_events, playback_analytics_events } from '../schema';
import type { DateRange } from '../date-filters';

/**
 * The administrator analytics dashboard read models (Prompts 144, 145, 146).
 *
 * The dashboard answers four questions:
 *
 *   - **Overview:** how much happened in the selected range?
 *   - **Content performance:** which titles earned the views and the watch time?
 *   - **Viewer activity:** how many distinct viewers were there, and how much
 *     of the watching was done by signed-in viewers versus guests?
 *   - **Engagement trends:** how did the daily totals move across the range?
 *
 * The totals come from the stored daily aggregates, so a page refresh cannot
 * inflate a number and the dashboard stays cheap. The distinct-viewer counts
 * are read from the raw events, because "one visitor who visited on three
 * days" is one visitor and the daily aggregates cannot say so.
 *
 * The dashboard's display timezone is `Asia/Dhaka`; the stored timestamps are
 * in UTC. The range is resolved to UTC instants before it reaches the query.
 *
 * The content rows are read with raw SQL, like `discovery.ts` does: a read
 * model may join across modules, but it may not import another module's
 * `schema.ts` — `src/db/schema.ts` is the only file that does that
 * (DATABASE.md §2.4).
 */

/** The dashboard's overview numbers. */
export type AnalyticsOverview = {
  /** The number of distinct viewers in the range. */
  uniqueVisitors: number;
  /** The distinct viewers that were signed in when the range began or ended. */
  authenticatedViewers: number;
  /** The distinct viewers that only ever browsed anonymously. */
  guestViewers: number;
  /** The total number of views in the range. */
  totalViews: number;
  /** The total number of playback events in the range. */
  totalPlaybackEvents: number;
  /** The number of playback starts in the range. */
  playbackStarts: number;
  /** The number of distinct viewers who actually played something. */
  playbackViewers: number;
  /** The number of completed viewings in the range. */
  completionEvents: number;
  /** The total watch time in seconds. */
  totalWatchDurationSeconds: number;
  /** The completion rate as a fraction between 0 and 1: completions / starts. */
  completionRate: number;
  /** The average watch time per viewer who played, in seconds. */
  averageWatchDurationSeconds: number;
};

/** One row of the content-performance table. */
export type ContentPerformanceRow = {
  type: 'drama' | 'movie';
  id: string;
  title: string;
  /** The number of views in the range. */
  views: number;
  /** The number of distinct viewers in the range. */
  uniqueVisitors: number;
  /** The total watch time in seconds. */
  watchDurationSeconds: number;
  /** The number of completed viewings. */
  completions: number;
  /** The number of playback starts. */
  playbackStarts: number;
  /** The completion rate as a fraction between 0 and 1: completions / starts. */
  completionRate: number;
};

/** One day of the engagement trend. */
export type EngagementTrendPoint = {
  /** The `YYYY-MM-DD` day, in `Asia/Dhaka`. */
  date: string;
  /** The number of distinct viewers that day. */
  uniqueVisitors: number;
  /** The number of views that day. */
  totalViews: number;
  /** The total watch time in seconds that day. */
  watchDurationSeconds: number;
  /** The number of completed viewings that day. */
  completionEvents: number;
};

/** One row of the viewer-activity table. */
export type ViewerActivityRow = {
  /** The `YYYY-MM-DD` day, in `Asia/Dhaka`. */
  date: string;
  /** The number of distinct viewers that day. */
  uniqueVisitors: number;
  /** The distinct viewers that were signed in that day. */
  authenticatedViewers: number;
  /** The distinct viewers that only ever browsed anonymously that day. */
  guestViewers: number;
  /** The number of views that day. */
  totalViews: number;
  /** The number of playback events that day. */
  playbackEvents: number;
  /** The number of distinct viewers who played something that day. */
  playbackViewers: number;
  /** The average watch time per viewer who played that day, in seconds. */
  averageWatchDurationSeconds: number;
};

/** The maximum number of rows a performance table may return. */
export const DASHBOARD_ROW_LIMIT = 50;

/**
 * The overview numbers for a range.
 *
 * @param range the resolved range
 * @returns the overview, or zeroes when there is no data
 */
export async function getAnalyticsOverview(range: DateRange): Promise<AnalyticsOverview> {
  const [row] = await db
    .select({
      totalViews: sql<number>`coalesce(sum(${analytics_daily_aggregates.total_views}), 0)`,
      totalPlaybackEvents: sql<number>`coalesce(sum(${analytics_daily_aggregates.total_playback_events}), 0)`,
      playbackStarts: sql<number>`coalesce(sum(${analytics_daily_aggregates.playback_starts}), 0)`,
      completionEvents: sql<number>`coalesce(sum(${analytics_daily_aggregates.completion_events}), 0)`,
      totalWatchDurationSeconds: sql<number>`coalesce(sum(${analytics_daily_aggregates.total_watch_duration_seconds}), 0)`,
    })
    .from(analytics_daily_aggregates)
    .where(
      and(
        isNull(analytics_daily_aggregates.deleted_at),
        isNull(analytics_daily_aggregates.content_type),
        gte(analytics_daily_aggregates.date, range.startDate),
        lt(analytics_daily_aggregates.date, addOneDay(range.endDate))
      )
    );

  const totalViews = Number(row?.totalViews ?? 0);
  const totalPlaybackEvents = Number(row?.totalPlaybackEvents ?? 0);
  const playbackStarts = Number(row?.playbackStarts ?? 0);
  const completionEvents = Number(row?.completionEvents ?? 0);
  const totalWatchDurationSeconds = Number(row?.totalWatchDurationSeconds ?? 0);
  const uniqueViewers = await countDistinctVisitors(range);
  // The playback viewers of a range are the distinct viewers of the range, not
  // the sum of the daily counts: a viewer who played on three days is one
  // viewer, and dividing the watch time by three would understate it (D-070).
  const playbackViewers = await countDistinctPlaybackViewers(range);

  return {
    uniqueVisitors: uniqueViewers.uniqueVisitors,
    authenticatedViewers: uniqueViewers.authenticatedViewers,
    guestViewers: uniqueViewers.guestViewers,
    totalViews,
    totalPlaybackEvents,
    playbackStarts,
    playbackViewers,
    completionEvents,
    totalWatchDurationSeconds,
    // A completion is a finished viewing of something that was started. Pauses
    // and seeks are playback events, not starts, so they must not lower the
    // rate.
    completionRate:
      playbackStarts === 0 ? 0 : Math.min(1, completionEvents / playbackStarts),
    // The watch time belongs to the viewers who played. Dividing it by every
    // visitor would count the people who only opened a details page.
    averageWatchDurationSeconds:
      playbackViewers === 0 ? 0 : Math.round(totalWatchDurationSeconds / playbackViewers),
  };
}

/**
 * The content-performance table for a range.
 *
 * The rows come from the content-level daily aggregates. The title is joined
 * from the content module, which owns the content rows.
 *
 * @param range the resolved range
 * @param limit the maximum number of rows
 * @returns the rows, most viewed first
 */
export async function listContentPerformance(
  range: DateRange,
  limit: number = DASHBOARD_ROW_LIMIT
): Promise<ContentPerformanceRow[]> {
  const bounded = Math.max(1, Math.min(limit, DASHBOARD_ROW_LIMIT));

  const rows = await db
    .select({
      type: analytics_daily_aggregates.content_type,
      id: analytics_daily_aggregates.content_id,
      views: sql<number>`coalesce(sum(${analytics_daily_aggregates.total_views}), 0)`,
      watchDurationSeconds: sql<number>`coalesce(sum(${analytics_daily_aggregates.total_watch_duration_seconds}), 0)`,
      completions: sql<number>`coalesce(sum(${analytics_daily_aggregates.completion_events}), 0)`,
      playbackStarts: sql<number>`coalesce(sum(${analytics_daily_aggregates.playback_starts}), 0)`,
    })
    .from(analytics_daily_aggregates)
    .where(
      and(
        isNull(analytics_daily_aggregates.deleted_at),
        inArray(analytics_daily_aggregates.content_type, ['drama', 'movie']),
        gte(analytics_daily_aggregates.date, range.startDate),
        lt(analytics_daily_aggregates.date, addOneDay(range.endDate))
      )
    )
    .groupBy(analytics_daily_aggregates.content_type, analytics_daily_aggregates.content_id)
    .orderBy(desc(sql`coalesce(sum(${analytics_daily_aggregates.total_views}), 0)`))
    .limit(bounded);

  if (rows.length === 0) {
    return [];
  }

  const dramaIds = rows
    .filter(row => row.type === 'drama')
    .map(row => row.id)
    .filter((id): id is string => id !== null);
  const movieIds = rows
    .filter(row => row.type === 'movie')
    .map(row => row.id)
    .filter((id): id is string => id !== null);

  const [dramaTitles, movieTitles, visitorsByContent] = await Promise.all([
    readContentTitles('dramas', dramaIds),
    readContentTitles('movies', movieIds),
    countDistinctVisitorsByContent(range),
  ]);

  const titles = new Map<string, string>();

  for (const title of dramaTitles) {
    titles.set(`drama:${title.id}`, title.title);
  }

  for (const title of movieTitles) {
    titles.set(`movie:${title.id}`, title.title);
  }

  return rows.map(row => {
    const views = Number(row.views ?? 0);
    const completions = Number(row.completions ?? 0);
    const playbackStarts = Number(row.playbackStarts ?? 0);
    const type = row.type === 'movie' ? 'movie' : 'drama';
    const id = row.id ?? '';

    return {
      type,
      id,
      title: id === '' ? 'Unknown content' : titles.get(`${type}:${id}`) ?? 'Unknown content',
      views,
      uniqueVisitors: visitorsByContent.get(`${type}:${id}`) ?? 0,
      watchDurationSeconds: Number(row.watchDurationSeconds ?? 0),
      completions,
      playbackStarts,
      completionRate:
        playbackStarts === 0 ? 0 : Math.min(1, completions / playbackStarts),
    };
  });
}

/**
 * The daily engagement trend for a range.
 *
 * The range is filled: a day without data is a zero, not a gap. A gap would
 * make the chart lie about the shape of the trend.
 *
 * @param range the resolved range
 * @returns one point per day, oldest first
 */
export async function listEngagementTrend(range: DateRange): Promise<EngagementTrendPoint[]> {
  const rows = await db
    .select({
      date: analytics_daily_aggregates.date,
      uniqueVisitors: analytics_daily_aggregates.unique_visitors,
      totalViews: analytics_daily_aggregates.total_views,
      watchDurationSeconds: analytics_daily_aggregates.total_watch_duration_seconds,
      completionEvents: analytics_daily_aggregates.completion_events,
    })
    .from(analytics_daily_aggregates)
    .where(
      and(
        isNull(analytics_daily_aggregates.deleted_at),
        isNull(analytics_daily_aggregates.content_type),
        gte(analytics_daily_aggregates.date, range.startDate),
        lt(analytics_daily_aggregates.date, addOneDay(range.endDate))
      )
    )
    .orderBy(analytics_daily_aggregates.date);

  const byDate = new Map<string, EngagementTrendPoint>();

  for (const row of rows) {
    byDate.set(row.date, {
      date: row.date,
      uniqueVisitors: Number(row.uniqueVisitors ?? 0),
      totalViews: Number(row.totalViews ?? 0),
      watchDurationSeconds: Number(row.watchDurationSeconds ?? 0),
      completionEvents: Number(row.completionEvents ?? 0),
    });
  }

  const points: EngagementTrendPoint[] = [];
  let cursor = range.startDate;

  for (let index = 0; index < range.dayCount; index += 1) {
    points.push(
      byDate.get(cursor) ?? {
        date: cursor,
        uniqueVisitors: 0,
        totalViews: 0,
        watchDurationSeconds: 0,
        completionEvents: 0,
      }
    );

    const next = new Date(`${cursor}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().substring(0, 10);
  }

  return points;
}

/**
 * The viewer-activity table for a range.
 *
 * @param range the resolved range
 * @returns one row per day, oldest first
 */
export async function listViewerActivity(range: DateRange): Promise<ViewerActivityRow[]> {
  const rows = await db
    .select({
      date: analytics_daily_aggregates.date,
      uniqueVisitors: analytics_daily_aggregates.unique_visitors,
      totalViews: analytics_daily_aggregates.total_views,
      playbackEvents: analytics_daily_aggregates.total_playback_events,
      playbackViewers: analytics_daily_aggregates.playback_viewers,
      watchDurationSeconds: analytics_daily_aggregates.total_watch_duration_seconds,
    })
    .from(analytics_daily_aggregates)
    .where(
      and(
        isNull(analytics_daily_aggregates.deleted_at),
        isNull(analytics_daily_aggregates.content_type),
        gte(analytics_daily_aggregates.date, range.startDate),
        lt(analytics_daily_aggregates.date, addOneDay(range.endDate))
      )
    )
    .orderBy(analytics_daily_aggregates.date);

  const visitorsByDay = await countDistinctVisitorsByDay(range);
  const byDate = new Map<string, ViewerActivityRow>();

  for (const row of rows) {
    const playbackViewers = Number(row.playbackViewers ?? 0);
    const watchDurationSeconds = Number(row.watchDurationSeconds ?? 0);
    const split = visitorsByDay.get(row.date);

    // The viewer counts of a day come from the raw events, so the signed-in
    // and guest buckets add up to the day's viewer count. The aggregate is the
    // fallback for a day whose events are no longer there.
    byDate.set(row.date, {
      date: row.date,
      uniqueVisitors: split?.uniqueVisitors ?? Number(row.uniqueVisitors ?? 0),
      authenticatedViewers: split?.authenticatedViewers ?? 0,
      guestViewers: split?.guestViewers ?? 0,
      totalViews: Number(row.totalViews ?? 0),
      playbackEvents: Number(row.playbackEvents ?? 0),
      playbackViewers,
      averageWatchDurationSeconds:
        playbackViewers === 0 ? 0 : Math.round(watchDurationSeconds / playbackViewers),
    });
  }

  const activity: ViewerActivityRow[] = [];
  let cursor = range.startDate;

  for (let index = 0; index < range.dayCount; index += 1) {
    activity.push(
      byDate.get(cursor) ?? {
        date: cursor,
        uniqueVisitors: 0,
        authenticatedViewers: 0,
        guestViewers: 0,
        totalViews: 0,
        playbackEvents: 0,
        playbackViewers: 0,
        averageWatchDurationSeconds: 0,
      }
    );

    const next = new Date(`${cursor}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    cursor = next.toISOString().substring(0, 10);
  }

  return activity;
}

/**
 * The instant the aggregates were last written, for the dashboard's
 * "last updated" line (Prompt 146).
 *
 * @returns the latest aggregate timestamp, or `null` when there is no data
 */
export async function getAnalyticsLastUpdated(): Promise<Date | null> {
  const [row] = await db
    .select({ updatedAt: sql<Date | null>`max(${analytics_daily_aggregates.updated_at})` })
    .from(analytics_daily_aggregates)
    .where(isNull(analytics_daily_aggregates.deleted_at));

  const value = row?.updatedAt;

  if (value === null || value === undefined) {
    return null;
  }

  return value instanceof Date ? value : new Date(value);
}

/**
 * The number of distinct viewers in a range, split by how they were classified.
 *
 * A viewer is the `guest_sessions` row the events were recorded under. The
 * count is taken over the union of the view events and the playback events,
 * so a viewer who only ever opened an episode is counted too.
 *
 * The two buckets do not overlap: a viewer who browsed anonymously and later
 * signed in is counted as an authenticated viewer, because the dashboard
 * answers "who is watching the platform", not "which requests were anonymous".
 *
 * @param range the resolved range
 * @returns the viewer counts of the range
 */
async function countDistinctVisitors(range: DateRange): Promise<{
  uniqueVisitors: number;
  authenticatedViewers: number;
  guestViewers: number;
}> {
  const rows = await runQuery(sql`
    with seen as (
      select ${content_view_events.guest_session_id} as visitor,
             ${content_view_events.viewer_type} as viewer_type
        from ${content_view_events}
       where ${content_view_events.deleted_at} is null
         and ${content_view_events.viewed_at} >= ${range.startInstant}
         and ${content_view_events.viewed_at} < ${range.endInstant}
         and ${content_view_events.guest_session_id} is not null
      union all
      select ${playback_analytics_events.guest_session_id} as visitor,
             ${playback_analytics_events.viewer_type} as viewer_type
        from ${playback_analytics_events}
       where ${playback_analytics_events.deleted_at} is null
         and ${playback_analytics_events.event_at} >= ${range.startInstant}
         and ${playback_analytics_events.event_at} < ${range.endInstant}
         and ${playback_analytics_events.guest_session_id} is not null
    ),
    visitors as (select distinct visitor from seen),
    authenticated as (
      select distinct visitor from seen where viewer_type = 'authenticated'
    )
    select (select count(*)::int from visitors) as unique_visitors,
           (select count(*)::int from authenticated) as authenticated_viewers,
           (
             select count(*)::int
               from visitors v
              where not exists (select 1 from authenticated a where a.visitor = v.visitor)
           ) as guest_viewers
  `);

  return {
    uniqueVisitors: Number(rows[0]?.unique_visitors ?? 0),
    authenticatedViewers: Number(rows[0]?.authenticated_viewers ?? 0),
    guestViewers: Number(rows[0]?.guest_viewers ?? 0),
  };
}

/**
 * The number of distinct viewers per day, split by how they were classified.
 *
 * The daily aggregate carries no classification, so the split is read from the
 * raw events of the range. The two buckets do not overlap: a viewer who
 * signed in during the day is counted as an authenticated viewer.
 *
 * @param range the resolved range
 * @returns the viewer counts keyed by the `YYYY-MM-DD` day
 */
async function countDistinctVisitorsByDay(range: DateRange): Promise<Map<string, {
  uniqueVisitors: number;
  authenticatedViewers: number;
  guestViewers: number;
}>> {
  const rows = await runQuery(sql`
    with seen as (
      select to_char(${content_view_events.viewed_at} at time zone 'UTC' + interval '6 hours', 'YYYY-MM-DD') as day,
             ${content_view_events.guest_session_id} as visitor,
             ${content_view_events.viewer_type} as viewer_type
        from ${content_view_events}
       where ${content_view_events.deleted_at} is null
         and ${content_view_events.viewed_at} >= ${range.startInstant}
         and ${content_view_events.viewed_at} < ${range.endInstant}
         and ${content_view_events.guest_session_id} is not null
      union all
      select to_char(${playback_analytics_events.event_at} at time zone 'UTC' + interval '6 hours', 'YYYY-MM-DD') as day,
             ${playback_analytics_events.guest_session_id} as visitor,
             ${playback_analytics_events.viewer_type} as viewer_type
        from ${playback_analytics_events}
       where ${playback_analytics_events.deleted_at} is null
         and ${playback_analytics_events.event_at} >= ${range.startInstant}
         and ${playback_analytics_events.event_at} < ${range.endInstant}
         and ${playback_analytics_events.guest_session_id} is not null
    ),
    visitors as (select distinct day, visitor from seen),
    authenticated as (
      select distinct day, visitor from seen where viewer_type = 'authenticated'
    )
    select visitors.day as day,
           count(*)::int as unique_visitors,
           count(authenticated.visitor)::int as authenticated_viewers,
           (
             count(*) filter (where authenticated.visitor is null)
           )::int as guest_viewers
      from visitors
      left join authenticated on authenticated.day = visitors.day
                                and authenticated.visitor = visitors.visitor
     group by visitors.day
  `);

  const counts = new Map<string, {
    uniqueVisitors: number;
    authenticatedViewers: number;
    guestViewers: number;
  }>();

  for (const row of rows) {
    const record = row as Record<string, unknown>;

    counts.set(String(record.day), {
      uniqueVisitors: Number(record.unique_visitors ?? 0),
      authenticatedViewers: Number(record.authenticated_viewers ?? 0),
      guestViewers: Number(record.guest_viewers ?? 0),
    });
  }

  return counts;
}

/**
 * The number of distinct viewers who played something in a range.
 *
 * The count is taken over the raw playback events, not over the daily
 * aggregates: the daily count is a viewer *per day*, and summing it over a
 * range would count a viewer who played on three days three times (D-070).
 */
async function countDistinctPlaybackViewers(range: DateRange): Promise<number> {
  const rows = await runQuery(sql`
    select count(distinct ${playback_analytics_events.guest_session_id})::int as playback_viewers
      from ${playback_analytics_events}
     where ${playback_analytics_events.deleted_at} is null
       and ${playback_analytics_events.event_at} >= ${range.startInstant}
       and ${playback_analytics_events.event_at} < ${range.endInstant}
       and ${playback_analytics_events.guest_session_id} is not null
  `);

  return Number(rows[0]?.playback_viewers ?? 0);
}

/**
 * The number of distinct viewers per content item in a range.
 *
 * @returns the viewer count keyed by `drama:<id>` or `movie:<id>`
 */
async function countDistinctVisitorsByContent(
  range: DateRange
): Promise<Map<string, number>> {
  const rows = await runQuery(sql`
    select content_type, target_id, count(distinct visitor)::int as unique_visitors
      from (
        select ${content_view_events.content_type} as content_type,
               ${content_view_events.content_id}::text as target_id,
               ${content_view_events.guest_session_id} as visitor
          from ${content_view_events}
         where ${content_view_events.deleted_at} is null
           and ${content_view_events.viewed_at} >= ${range.startInstant}
           and ${content_view_events.viewed_at} < ${range.endInstant}
           and ${content_view_events.guest_session_id} is not null
        union all
        select ${playback_analytics_events.content_type} as content_type,
               coalesce(${playback_analytics_events.drama_id}, ${playback_analytics_events.movie_id})::text as target_id,
               ${playback_analytics_events.guest_session_id} as visitor
          from ${playback_analytics_events}
         where ${playback_analytics_events.deleted_at} is null
           and ${playback_analytics_events.event_at} >= ${range.startInstant}
           and ${playback_analytics_events.event_at} < ${range.endInstant}
           and ${playback_analytics_events.guest_session_id} is not null
      ) seen
     group by content_type, target_id
  `);

  const counts = new Map<string, number>();

  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const contentType = String(record.content_type);
    const targetId = String(record.target_id);

    counts.set(`${contentType}:${targetId}`, Number(record.unique_visitors ?? 0));
  }

  return counts;
}

/**
 * The titles of the content items of one kind.
 *
 * The content rows belong to the content module, and a read model may read
 * them — but it may not import the module's `schema.ts`, because
 * `src/db/schema.ts` is the only file that does that (DATABASE.md §2.4).
 * The table is therefore named directly, exactly as `discovery.ts` names it.
 *
 * @param table the content table: `dramas` or `movies`
 * @param ids the ids to read
 * @returns the titles, keyed by the content id
 */
async function readContentTitles(
  table: 'dramas' | 'movies',
  ids: readonly string[]
): Promise<{ id: string; title: string }[]> {
  if (ids.length === 0) {
    return [];
  }

  const rows = await runQuery(sql`
    select id::text as id, title
      from ${sql.raw(table)}
     where id in (${sql.join(
       ids.map(id => sql`${id}`),
       sql`, `
     )})
  `);

  return rows.map(row => {
    const record = row as Record<string, unknown>;

    return { id: String(record.id), title: String(record.title) };
  });
}

/**
 * Run one raw query and return its rows as plain records.
 */
async function runQuery(statement: SQL): Promise<Record<string, unknown>[]> {
  const result = await db.execute(statement);

  if (typeof result === 'object' && result !== null && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;

    if (Array.isArray(rows)) {
      return rows as Record<string, unknown>[];
    }
  }

  return [];
}

/**
 * The exclusive upper bound of a range's last day.
 *
 * The aggregate rows store the day as a `text` column, so the comparison is a
 * string comparison; the bound is the day after the last one.
 */
function addOneDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);

  return date.toISOString().substring(0, 10);
}
