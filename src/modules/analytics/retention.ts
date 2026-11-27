import 'server-only';

import { sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { dhakaDateString } from './date-filters';
import {
  analytics_daily_aggregates,
  content_view_events,
  guest_sessions,
  playback_analytics_events,
  playback_viewing_sessions,
  search_events,
} from './schema';

import {
  ANALYTICS_EVENT_RETENTION_DAYS,
  ANALYTICS_RETENTION_BATCH_SIZE,
  ANALYTICS_RETENTION_MAX_BATCH_SIZE,
  DAY_IN_MILLISECONDS,
  GUEST_SESSION_RETENTION_DAYS,
} from './retention-constants';

/**
 * The analytics retention policy (Prompt 139, requirements §10.1).
 *
 * Analytics data is kept for a limited time, and then removed. The policy has
 * three rules:
 *
 *   1. **The raw events are kept for 400 days.** The dashboard may show a
 *      range of at most 366 days (`MAX_RANGE_DAYS`), so 400 days of raw events
 *      are enough to recompute every number the dashboard can display. A
 *      shorter window would leave the dashboard unable to rebuild a range it is
 *      allowed to ask for.
 *   2. **A guest-session row outlives the events it identifies.** The
 *      unique-visitor counts are `count(distinct guest_session_id)`, so a
 *      session row that was removed while its events were still kept would
 *      silently drop those visitors from the numbers. The session row is
 *      therefore kept for the same window as the events.
 *   3. **A session row linked to an account is never removed.** It is the
 *      account's stable visitor key: the same row is found again for every
 *      request of that account. There is one such row per account, so keeping
 *      them is bounded, and removing one would split the account's history in
 *      two.
 *
 * The removal is a **short-lived, bounded operation**: one run removes at most
 * `batchSize` rows from one table, it never locks a whole table, and it exits.
 * It is not a worker and it does not schedule itself.
 */

/** What one retention run removed. */
export type AnalyticsRetentionResult = {
  /** The view events that were removed. */
  contentViewEvents: number;
  /** The playback events that were removed. */
  playbackAnalyticsEvents: number;
  /** The search events that were removed. */
  searchEvents: number;
  /** The viewing sessions that were removed. */
  playbackViewingSessions: number;
  /** The daily aggregates that were removed. */
  analyticsDailyAggregates: number;
  /** The guest-session rows that were removed. */
  guestSessions: number;
};

/** The options of one retention run. */
export type AnalyticsRetentionOptions = {
  /** How long the raw events are kept. Defaults to 400 days. */
  retentionDays?: number;
  /** How long a guest-session row is kept. Defaults to 400 days. */
  guestSessionRetentionDays?: number;
  /** The maximum number of rows removed from one table. Defaults to 1000. */
  batchSize?: number;
  /** The instant the retention is measured from. Defaults to now. */
  now?: Date;
  /** The database executor. Defaults to the pooled client. */
  executor?: DbExecutor;
};

/**
 * Remove the analytics data that the retention policy no longer keeps.
 *
 * The run removes the expired raw events first and the guest-session rows
 * second, because a session row may only be removed once no event points at
 * it: the foreign keys use `ON DELETE SET NULL`, so removing the row first
 * would take the visitor key away from an event that is still inside its
 * retention window.
 *
 * @param options the retention window and the batch size
 * @returns how many rows each table lost
 */
export async function purgeExpiredGuestData(
  options: AnalyticsRetentionOptions = {}
): Promise<AnalyticsRetentionResult> {
  const executor = options.executor ?? db;
  const now = options.now ?? new Date();

  const retentionDays = clampDays(options.retentionDays, ANALYTICS_EVENT_RETENTION_DAYS);
  const guestSessionRetentionDays = clampDays(
    options.guestSessionRetentionDays,
    GUEST_SESSION_RETENTION_DAYS
  );
  const batchSize = clampBatchSize(options.batchSize);

  const eventCutoff = new Date(now.getTime() - retentionDays * DAY_IN_MILLISECONDS);
  const sessionCutoff = new Date(now.getTime() - guestSessionRetentionDays * DAY_IN_MILLISECONDS);
  const aggregateCutoffDay = dhakaDateString(eventCutoff);

  const contentViewEvents = await deleteBatched(
    content_view_events,
    content_view_events.viewed_at,
    eventCutoff,
    batchSize,
    executor
  );

  const playbackAnalyticsEvents = await deleteBatched(
    playback_analytics_events,
    playback_analytics_events.event_at,
    eventCutoff,
    batchSize,
    executor
  );

  const searchEvents = await deleteBatched(
    search_events,
    search_events.searched_at,
    eventCutoff,
    batchSize,
    executor
  );

  const analyticsDailyAggregates = await deleteBatchedAggregates(
    aggregateCutoffDay,
    batchSize,
    executor
  );

  // The viewing sessions go before the guest sessions: a baseline points at
  // the visitor key, so the key may only go once its baselines are gone.
  const playbackViewingSessions = await deleteExpiredViewingSessions(
    eventCutoff,
    batchSize,
    executor
  );

  const guestSessions = await deleteExpiredGuestSessions(
    sessionCutoff,
    batchSize,
    executor
  );

  return {
    contentViewEvents,
    playbackAnalyticsEvents,
    searchEvents,
    playbackViewingSessions,
    analyticsDailyAggregates,
    guestSessions,
  };
}

/**
 * Remove up to `limit` rows whose timestamp is older than the cutoff.
 *
 * @param table the table to remove rows from
 * @param column the timestamp column the cutoff applies to
 * @param cutoff the instant before which a row is expired
 * @param limit the maximum number of rows to remove
 * @param executor the database executor
 * @returns how many rows were removed
 */
async function deleteBatched(
  table: typeof content_view_events | typeof playback_analytics_events | typeof search_events,
  column: typeof content_view_events.viewed_at | typeof playback_analytics_events.event_at | typeof search_events.searched_at,
  cutoff: Date,
  limit: number,
  executor: DbExecutor
): Promise<number> {
  const result = await executor.execute(sql`
    delete from ${table}
     where id in (
       select id
         from ${table}
        where ${column} < ${cutoff}
        limit ${limit}
     )
  `);

  return readAffectedRows(result);
}

/**
 * Remove up to `limit` daily aggregate rows older than the cutoff day.
 *
 * The aggregate table stores a `YYYY-MM-DD` day, so the cutoff is a day
 * string and the comparison is a lexicographic one — which orders the days
 * exactly.
 *
 * @param cutoffDay the first day that is still kept
 * @param limit the maximum number of rows to remove
 * @param executor the database executor
 * @returns how many rows were removed
 */
async function deleteBatchedAggregates(
  cutoffDay: string,
  limit: number,
  executor: DbExecutor
): Promise<number> {
  const result = await executor.execute(sql`
    delete from ${analytics_daily_aggregates}
     where id in (
       select id
         from ${analytics_daily_aggregates}
        where ${analytics_daily_aggregates.date} < ${cutoffDay}
        limit ${limit}
     )
  `);

  return readAffectedRows(result);
}

/**
 * Remove up to `limit` viewing sessions that are no longer needed.
 *
 * A viewing session is the server's baseline of a viewing (D-090). It is stale
 * when neither its start nor its last stored event is inside the retention
 * window any more: the watch time it guarded is already stored in the event
 * rows, and a later beacon of that viewer simply starts a new session.
 *
 * @param cutoff the instant before which a session is expired
 * @param limit the maximum number of rows to remove
 * @param executor the database executor
 * @returns how many rows were removed
 */
async function deleteExpiredViewingSessions(
  cutoff: Date,
  limit: number,
  executor: DbExecutor
): Promise<number> {
  const result = await executor.execute(sql`
    delete from ${playback_viewing_sessions}
     where id in (
       select id
         from ${playback_viewing_sessions}
        where coalesce(${playback_viewing_sessions.last_event_at}, ${playback_viewing_sessions.started_at}) < ${cutoff}
        limit ${limit}
     )
  `);

  return readAffectedRows(result);
}

/**
 * Remove up to `limit` guest-session rows that are no longer needed.
 *
 * A row is removed when it is old, when it is not linked to an account, and
 * when no event points at it any more.
 *
 * @param cutoff the instant before which a row is expired
 * @param limit the maximum number of rows to remove
 * @param executor the database executor
 * @returns how many rows were removed
 */
async function deleteExpiredGuestSessions(
  cutoff: Date,
  limit: number,
  executor: DbExecutor
): Promise<number> {
  const result = await executor.execute(sql`
    with expired as (
      select session.id
        from ${guest_sessions} session
       where session.created_at < ${cutoff}
         and session.user_id is null
         and not exists (
           select 1
             from ${content_view_events} event
            where event.guest_session_id = session.id
         )
         and not exists (
           select 1
             from ${playback_analytics_events} event
            where event.guest_session_id = session.id
         )
         and not exists (
           select 1
             from ${search_events} event
            where event.guest_session_id = session.id
         )
         and not exists (
           select 1
             from ${playback_viewing_sessions} viewing
            where viewing.guest_session_id = session.id
         )
       limit ${limit}
    )
    delete from ${guest_sessions} session
     using expired
     where session.id = expired.id
  `);

  return readAffectedRows(result);
}

/**
 * How many rows a raw statement changed.
 *
 * The driver reports the count in different places depending on the query,
 * so the value is read from wherever it is present.
 *
 * @param result the statement result
 * @returns the number of changed rows
 */
function readAffectedRows(result: unknown): number {
  if (typeof result === 'object' && result !== null && 'rowCount' in result) {
    const rowCount = (result as { rowCount?: unknown }).rowCount;

    if (typeof rowCount === 'number') {
      return rowCount;
    }
  }

  if (typeof result === 'object' && result !== null && 'count' in result) {
    const count = (result as { count?: unknown }).count;

    if (typeof count === 'number') {
      return count;
    }
  }

  return 0;
}

/**
 * Clamp a retention window to a whole number of days.
 *
 * @param value the requested window
 * @param fallback the window used when none was requested
 * @returns the window in days
 */
function clampDays(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    return fallback;
  }

  return value;
}

/**
 * Clamp a batch size to the allowed range.
 *
 * @param value the requested batch size
 * @returns the batch size
 */
function clampBatchSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    return ANALYTICS_RETENTION_BATCH_SIZE;
  }

  return Math.min(value, ANALYTICS_RETENTION_MAX_BATCH_SIZE);
}
