import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_RETENTION_DAYS,
  EVENT_TABLES,
  MAX_BATCH_SIZE,
  createLogger,
  parsePositiveInteger,
  runAnalyticsRetention,
} from '../../../scripts/analytics-retention.mjs';

/**
 * Analytics retention command helpers.
 *
 * The command removes analytics data, so its SQL and its configuration parsing
 * are pinned here: a mistake in either would delete the wrong rows.
 */

type QueryCall = { sql: string; values?: unknown[] };

const CUTOFF = { rows: [{ cutoff: new Date('2026-01-01T00:00:00.000Z') }], rowCount: 1 };
const DAY_CUTOFF = { rows: [{ cutoff_day: '2026-01-01' }], rowCount: 1 };

function fakeClient(calls: QueryCall[], handlers: { match: string; result: unknown }[]) {
  return {
    connect: async () => {},
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });

      for (const handler of handlers) {
        if (sql.includes(handler.match)) {
          return handler.result as { rows: unknown[]; rowCount: number };
        }
      }

      return { rows: [], rowCount: 0 };
    },
    end: async () => {},
  };
}

describe('parsePositiveInteger', () => {
  it('accepts a positive integer', () => {
    expect(parsePositiveInteger('45', DEFAULT_RETENTION_DAYS)).toBe(45);
  });

  it('falls back for a missing or malformed value', () => {
    expect(parsePositiveInteger(undefined, DEFAULT_RETENTION_DAYS)).toBe(DEFAULT_RETENTION_DAYS);
    expect(parsePositiveInteger('', DEFAULT_RETENTION_DAYS)).toBe(DEFAULT_RETENTION_DAYS);
    expect(parsePositiveInteger('abc', DEFAULT_RETENTION_DAYS)).toBe(DEFAULT_RETENTION_DAYS);
    expect(parsePositiveInteger('0', DEFAULT_RETENTION_DAYS)).toBe(DEFAULT_RETENTION_DAYS);
    expect(parsePositiveInteger('-2', DEFAULT_RETENTION_DAYS)).toBe(DEFAULT_RETENTION_DAYS);
    expect(parsePositiveInteger('1.5', DEFAULT_RETENTION_DAYS)).toBe(DEFAULT_RETENTION_DAYS);
  });

  it('never exceeds the configured maximum', () => {
    expect(parsePositiveInteger('100000', DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE)).toBe(MAX_BATCH_SIZE);
  });
});

describe('EVENT_TABLES', () => {
  it('covers every raw event table with the column that decides its age', () => {
    expect(EVENT_TABLES.map(entry => entry.table)).toEqual([
      'content_view_events',
      'playback_analytics_events',
      'search_events',
    ]);
    expect(EVENT_TABLES.map(entry => entry.column)).toEqual([
      'viewed_at',
      'event_at',
      'searched_at',
    ]);
  });
});

describe('runAnalyticsRetention', () => {
  it('refuses to run without a database URL', async () => {
    const report = await runAnalyticsRetention({
      connectionString: undefined,
      log: () => {},
    });

    expect(report.failures[0]?.reason).toBe('missing_database_url');
  });

  it('removes one bounded batch from every table', async () => {
    const calls: QueryCall[] = [];
    const client = fakeClient(calls, [
      { match: 'as cutoff', result: CUTOFF },
      { match: 'as cutoff_day', result: DAY_CUTOFF },
      { match: 'delete from content_view_events', result: { rows: [], rowCount: 7 } },
      { match: 'delete from playback_analytics_events', result: { rows: [], rowCount: 3 } },
      { match: 'delete from search_events', result: { rows: [], rowCount: 1 } },
      { match: 'delete from analytics_daily_aggregates', result: { rows: [], rowCount: 2 } },
      { match: 'delete from guest_sessions', result: { rows: [], rowCount: 5 } },
    ]);

    const report = await runAnalyticsRetention({
      client: client as never,
      connectionString: 'postgresql://localhost:5432/dramascan_test',
      retentionDays: 400,
      guestRetentionDays: 400,
      batchSize: 1000,
      dryRun: false,
      log: () => {},
    });

    expect(report.removed).toEqual({
      contentViewEvents: 7,
      playbackAnalyticsEvents: 3,
      searchEvents: 1,
      analyticsDailyAggregates: 2,
      guestSessions: 5,
    });
    expect(report.failures).toHaveLength(0);

    const deletes = calls.map(call => call.sql).filter(sql => sql.includes('delete from'));

    expect(deletes).toHaveLength(5);

    // Every delete is bounded by the batch size.
    for (const statement of deletes) {
      expect(statement).toContain('limit $2');
    }
  });

  it('never removes a guest session that is linked to an account', async () => {
    const calls: QueryCall[] = [];
    const client = fakeClient(calls, [
      { match: 'as cutoff', result: CUTOFF },
      { match: 'as cutoff_day', result: DAY_CUTOFF },
    ]);

    await runAnalyticsRetention({
      client: client as never,
      connectionString: 'postgresql://localhost:5432/dramascan_test',
      dryRun: false,
      log: () => {},
    });

    const sessionDelete = calls
      .map(call => call.sql)
      .find(sql => sql.includes('delete from guest_sessions'));

    expect(sessionDelete).toBeDefined();
    expect(sessionDelete).toContain('session.user_id is null');
  });

  it('only removes a guest session when no event points at it any more', async () => {
    const calls: QueryCall[] = [];
    const client = fakeClient(calls, [
      { match: 'as cutoff', result: CUTOFF },
      { match: 'as cutoff_day', result: DAY_CUTOFF },
    ]);

    await runAnalyticsRetention({
      client: client as never,
      connectionString: 'postgresql://localhost:5432/dramascan_test',
      dryRun: false,
      log: () => {},
    });

    const sessionDelete = calls
      .map(call => call.sql)
      .find(sql => sql.includes('delete from guest_sessions'));

    expect(sessionDelete).toContain('not exists');
    expect(sessionDelete).toContain('content_view_events');
    expect(sessionDelete).toContain('playback_analytics_events');
    expect(sessionDelete).toContain('search_events');
  });

  it('counts the rows instead of removing them in the dry run', async () => {
    const calls: QueryCall[] = [];
    const client = fakeClient(calls, [
      { match: 'as cutoff', result: CUTOFF },
      { match: 'as cutoff_day', result: DAY_CUTOFF },
      { match: 'count(*)::int as total from content_view_events', result: { rows: [{ total: 42 }], rowCount: 1 } },
    ]);

    const report = await runAnalyticsRetention({
      client: client as never,
      connectionString: 'postgresql://localhost:5432/dramascan_test',
      dryRun: true,
      log: () => {},
    });

    expect(report.removed.contentViewEvents).toBe(42);
    expect(calls.map(call => call.sql).some(sql => sql.includes('delete from'))).toBe(false);
  });

  it('records a failure instead of throwing', async () => {
    const calls: QueryCall[] = [];
    const client = fakeClient(calls, [
      { match: 'as cutoff', result: CUTOFF },
      { match: 'as cutoff_day', result: DAY_CUTOFF },
    ]);

    const originalQuery = client.query;

    client.query = async (sql: string, values?: unknown[]) => {
      if (sql.includes('delete from content_view_events')) {
        throw new Error('permission denied');
      }

      return originalQuery(sql, values);
    };

    const report = await runAnalyticsRetention({
      client: client as never,
      connectionString: 'postgresql://localhost:5432/dramascan_test',
      dryRun: false,
      log: () => {},
    });

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.reason).toBe('contentViewEvents');
  });
});

describe('createLogger', () => {
  it('writes one JSON object per line', () => {
    const lines: string[] = [];
    const log = createLogger(line => lines.push(line));

    log('analytics_retention.started', { retentionDays: 400 });

    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0] as string) as {
      event: string;
      retentionDays: number;
      timestamp: string;
    };

    expect(parsed.event).toBe('analytics_retention.started');
    expect(parsed.retentionDays).toBe(400);
    expect(typeof parsed.timestamp).toBe('string');
  });
});
