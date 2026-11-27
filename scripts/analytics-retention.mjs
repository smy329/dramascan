/**
 * Analytics retention command.
 *
 * A short-lived maintenance command: it runs once, removes the analytics rows
 * that the retention policy no longer keeps, writes a structured report, and
 * exits. It is not a worker and it does not schedule itself; the systemd timer
 * starts it.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/analytics-retention.mjs
 *   npm run db:analytics:retention
 *
 * Environment:
 *   DATABASE_URL                          required; the database the command runs against.
 *   ANALYTICS_RETENTION_DAYS             optional; raw-event retention in days (default 400).
 *   ANALYTICS_GUEST_RETENTION_DAYS       optional; guest-session retention in days (default 400).
 *   ANALYTICS_RETENTION_BATCH_SIZE       optional; rows removed per table (default 1000).
 *   ANALYTICS_RETENTION_DRY_RUN          optional; `1` reports what would be deleted and writes nothing.
 *
 * The retention window is longer than the longest range the dashboard may
 * query (`MAX_RANGE_DAYS`, 366 days), so every number the dashboard can show
 * can still be rebuilt from the raw events. A guest-session row is kept for
 * the same window as the events it identifies, because the unique-visitor
 * counts are made of the visitor keys; and a session row linked to an account
 * is never removed, because it is that account's stable visitor key.
 *
 * The constants are imported from `src/modules/analytics/retention-constants.ts`,
 * which is shared between the application and the maintenance script.
 * Keep the two in step.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

import { parse } from 'dotenv';
import { Client } from 'pg';

// Import retention constants from the shared constants module to avoid duplication.
// The script runs outside the Next.js build, so we load the compiled output.
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const constantsModule = await import('../src/modules/analytics/retention-constants.ts');

/** How long the raw analytics events are kept, in days. */
export const DEFAULT_RETENTION_DAYS = constantsModule.ANALYTICS_EVENT_RETENTION_DAYS;

/** How long a guest-session row is kept, in days. */
export const DEFAULT_GUEST_RETENTION_DAYS = constantsModule.GUEST_SESSION_RETENTION_DAYS;

/** How many rows one run removes from one table. */
export const DEFAULT_BATCH_SIZE = constantsModule.ANALYTICS_RETENTION_BATCH_SIZE;

/** The largest batch one run may remove from one table. */
export const MAX_BATCH_SIZE = constantsModule.ANALYTICS_RETENTION_MAX_BATCH_SIZE;

/**
 * The tables the command removes rows from, and the column that decides when a
 * row has expired.
 *
 * @type {ReadonlyArray<{ key: string, table: string, column: string }>}
 */
export const EVENT_TABLES = Object.freeze([
  { key: 'contentViewEvents', table: 'content_view_events', column: 'viewed_at' },
  { key: 'playbackAnalyticsEvents', table: 'playback_analytics_events', column: 'event_at' },
  { key: 'searchEvents', table: 'search_events', column: 'searched_at' },
  // A viewing session is the server's baseline of a viewing. It is stale when
  // neither its start nor its last stored event is inside the window any more.
  {
    key: 'playbackViewingSessions',
    table: 'playback_viewing_sessions',
    column: 'coalesce(last_event_at, started_at)',
  },
]);

/**
 * The outcome of one retention run.
 *
 * @typedef {object} RetentionReport
 * @property {string} startedAt
 * @property {string} finishedAt
 * @property {number} retentionDays
 * @property {number} guestRetentionDays
 * @property {number} batchSize
 * @property {boolean} dryRun
 * @property {Record<string, number>} removed
 * @property {{ reason: string, message: string }[]} failures
 */

/** Structured logger: one JSON object per line. */
export function createLogger(write = line => console.log(line)) {
  return function log(event, payload = {}) {
    write(JSON.stringify({ timestamp: new Date().toISOString(), event, ...payload }));
  };
}

/** Parse a positive integer environment value, falling back to the default. */
export function parsePositiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, maximum);
}

/** Load `.env.local` into the environment without overwriting real variables. */
function loadLocalEnv() {
  const envPath = new URL('../.env.local', import.meta.url);
  let contents;

  try {
    contents = readFileSync(envPath);
  } catch {
    return;
  }

  let text;

  if (contents.length >= 2 && contents[0] === 0xff && contents[1] === 0xfe) {
    text = contents.subarray(2).toString('utf16le');
  } else if (contents.length >= 2 && contents[0] === 0xfe && contents[1] === 0xff) {
    const body = contents.subarray(2);
    text = Buffer.from(body).swap16().toString('utf16le');
  } else {
    text = contents.toString('utf8').replace(/^\uFEFF/, '');
  }

  for (const [key, value] of Object.entries(parse(text))) {
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

/**
 * Run the retention command.
 *
 * The function is exported so the test suite can drive it against the test
 * database; the command line entry point is added at the bottom of the file.
 *
 * @param {{ connectionString?: string, client?: any, retentionDays?: number, guestRetentionDays?: number, batchSize?: number, dryRun?: boolean, log?: (event: string, payload?: Record<string, unknown>) => void }} [options]
 * @returns {Promise<RetentionReport>}
 */
export async function runAnalyticsRetention(options = {}) {
  const {
    connectionString = process.env.DATABASE_URL,
    client: providedClient,
    retentionDays = parsePositiveInteger(
      process.env.ANALYTICS_RETENTION_DAYS,
      DEFAULT_RETENTION_DAYS,
      3650
    ),
    guestRetentionDays = parsePositiveInteger(
      process.env.ANALYTICS_GUEST_RETENTION_DAYS,
      DEFAULT_GUEST_RETENTION_DAYS,
      3650
    ),
    batchSize = parsePositiveInteger(
      process.env.ANALYTICS_RETENTION_BATCH_SIZE,
      DEFAULT_BATCH_SIZE,
      MAX_BATCH_SIZE
    ),
    dryRun = process.env.ANALYTICS_RETENTION_DRY_RUN === '1',
    log = createLogger(),
  } = options;

  const startedAt = new Date().toISOString();
  /** @type {RetentionReport} */
  const report = {
    startedAt,
    finishedAt: startedAt,
    retentionDays,
    guestRetentionDays,
    batchSize,
    dryRun,
    removed: {},
    failures: [],
  };

  if (!connectionString && !providedClient) {
    log('analytics_retention.failed', { reason: 'missing_database_url' });
    report.failures.push({ reason: 'missing_database_url', message: 'DATABASE_URL is not set.' });
    report.finishedAt = new Date().toISOString();
    return report;
  }

  const client = providedClient ?? new Client({ connectionString });
  const ownsClient = providedClient === undefined;

  try {
    await client.connect();

    const cutoffResult = await client.query(
      `select (now() - ($1::int * interval '1 day')) as cutoff`,
      [retentionDays]
    );
    const cutoff = cutoffResult.rows[0]?.cutoff;

    const guestCutoffResult = await client.query(
      `select (now() - ($1::int * interval '1 day')) as cutoff`,
      [guestRetentionDays]
    );
    const guestCutoff = guestCutoffResult.rows[0]?.cutoff;

    // The aggregate table stores a Dhaka calendar day, so its cutoff is a day
    // string and not an instant.
    const dayCutoffResult = await client.query(
      `select to_char((now() - ($1::int * interval '1 day')) at time zone 'UTC' + interval '6 hours', 'YYYY-MM-DD') as cutoff_day`,
      [retentionDays]
    );
    const dayCutoff = dayCutoffResult.rows[0]?.cutoff_day;

    log('analytics_retention.started', {
      retentionDays,
      guestRetentionDays,
      batchSize,
      dryRun,
      cutoff: cutoff instanceof Date ? cutoff.toISOString() : String(cutoff),
    });

    for (const entry of EVENT_TABLES) {
      await removeRows(client, report, log, {
        key: entry.key,
        countSql: `select count(*)::int as total from ${entry.table} where ${entry.column} < $1`,
        removeSql: `delete from ${entry.table} where id in (select id from ${entry.table} where ${entry.column} < $1 limit $2)`,
        parameters: [cutoff, batchSize],
        dryRun,
      });
    }

    await removeRows(client, report, log, {
      key: 'analyticsDailyAggregates',
      countSql: `select count(*)::int as total from analytics_daily_aggregates where date < $1`,
      removeSql: `delete from analytics_daily_aggregates where id in (select id from analytics_daily_aggregates where date < $1 limit $2)`,
      parameters: [dayCutoff, batchSize],
      dryRun,
    });

    // A guest-session row may only be removed once no event points at it: the
    // foreign keys use `ON DELETE SET NULL`, so removing the row first would
    // take the visitor key away from an event that is still inside its window.
    // A viewing session points at the guest session as well, so the baseline
    // has to be gone before the visitor key may go.
    await removeRows(client, report, log, {
      key: 'guestSessions',
      countSql: `select count(*)::int as total
                   from guest_sessions session
                  where session.created_at < $1
                    and session.user_id is null
                    and not exists (select 1 from content_view_events event where event.guest_session_id = session.id)
                    and not exists (select 1 from playback_analytics_events event where event.guest_session_id = session.id)
                    and not exists (select 1 from search_events event where event.guest_session_id = session.id)
                    and not exists (select 1 from playback_viewing_sessions viewing where viewing.guest_session_id = session.id)`,
      removeSql: `with expired as (
                    select session.id
                      from guest_sessions session
                     where session.created_at < $1
                       and session.user_id is null
                       and not exists (select 1 from content_view_events event where event.guest_session_id = session.id)
                       and not exists (select 1 from playback_analytics_events event where event.guest_session_id = session.id)
                       and not exists (select 1 from search_events event where event.guest_session_id = session.id)
                       and not exists (select 1 from playback_viewing_sessions viewing where viewing.guest_session_id = session.id)
                     limit $2
                  )
                  delete from guest_sessions session
                   using expired
                   where session.id = expired.id`,
      parameters: [guestCutoff, batchSize],
      dryRun,
    });

    report.finishedAt = new Date().toISOString();

    log('analytics_retention.finished', {
      removed: report.removed,
      failed: report.failures.length,
      durationMs: Date.parse(report.finishedAt) - Date.parse(startedAt),
    });

    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.failures.push({ reason: 'fatal', message });
    report.finishedAt = new Date().toISOString();
    log('analytics_retention.failed', { reason: 'fatal', message });
    return report;
  } finally {
    if (ownsClient) {
      await client.end();
    }
  }
}

/**
 * Remove one batch of rows and record what happened.
 *
 * @param {any} client
 * @param {RetentionReport} report
 * @param {(event: string, payload?: Record<string, unknown>) => void} log
 * @param {{ key: string, countSql: string, removeSql: string, parameters: unknown[], dryRun: boolean }} options
 */
async function removeRows(client, report, log, options) {
  try {
    if (options.dryRun) {
      const counted = await client.query(options.countSql, [options.parameters[0]]);
      const total = Number(counted.rows[0]?.total ?? 0);

      report.removed[options.key] = total;
      log('analytics_retention.dry_run', { table: options.key, rows: total });

      return;
    }

    const result = await client.query(options.removeSql, options.parameters);
    const removed = result.rowCount ?? 0;

    report.removed[options.key] = removed;
    log('analytics_retention.removed', { table: options.key, rows: removed });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    report.removed[options.key] = 0;
    report.failures.push({ reason: options.key, message });
    log('analytics_retention.failed', { table: options.key, message });
  }
}

/** Command line entry point. */
async function main() {
  loadLocalEnv();

  const report = await runAnalyticsRetention();

  if (report.failures.length > 0) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];

if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch(error => {
    createLogger()('analytics_retention.failed', {
      reason: 'unhandled',
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
