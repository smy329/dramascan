import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LIMIT,
  DELIVERY_LEASE_SECONDS,
  DELIVERY_RETENTION_DAYS,
  MAX_LIMIT,
  MAX_PUSH_RETRY_ATTEMPTS,
  PUSH_RETRY_WINDOW_DAYS,
  createLogger,
  parsePositiveInteger,
  readPushConfig,
  runNotificationMaintenance,
} from '../../../scripts/notification-maintenance.mjs';

/**
 * Notification maintenance command helpers.
 *
 * The command retries push deliveries and removes delivery records, so its
 * SQL and its configuration parsing are pinned here: a mistake in either would
 * send a message twice or delete the wrong rows.
 */

type QueryCall = { sql: string; values?: unknown[] };

const PUSH_CONFIG = {
  publicKey: 'public-key',
  privateKey: 'private-key',
  subject: 'mailto:ops@dramascan.local',
  ttlSeconds: 3600,
  allowedHosts: [] as string[],
  timeoutMs: 10_000,
};

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
    expect(parsePositiveInteger('45', DEFAULT_LIMIT)).toBe(45);
  });

  it('falls back for a missing or malformed value', () => {
    expect(parsePositiveInteger(undefined, DEFAULT_LIMIT)).toBe(DEFAULT_LIMIT);
    expect(parsePositiveInteger('', DEFAULT_LIMIT)).toBe(DEFAULT_LIMIT);
    expect(parsePositiveInteger('abc', DEFAULT_LIMIT)).toBe(DEFAULT_LIMIT);
    expect(parsePositiveInteger('0', DEFAULT_LIMIT)).toBe(DEFAULT_LIMIT);
    expect(parsePositiveInteger('-2', DEFAULT_LIMIT)).toBe(DEFAULT_LIMIT);
  });

  it('never exceeds the configured maximum', () => {
    expect(parsePositiveInteger('100000', DEFAULT_LIMIT, MAX_LIMIT)).toBe(MAX_LIMIT);
  });
});

describe('readPushConfig', () => {
  it('reports an absent key pair as absent', () => {
    const config = readPushConfig({});

    expect(config.publicKey).toBeNull();
    expect(config.privateKey).toBeNull();
    expect(config.allowedHosts).toEqual([]);
    expect(config.ttlSeconds).toBe(3600);
  });

  it('reads the key pair, the subject, and the host allowlist', () => {
    const config = readPushConfig({
      WEB_PUSH_PUBLIC_KEY: 'public-key',
      WEB_PUSH_PRIVATE_KEY: 'private-key',
      WEB_PUSH_SUBJECT: 'mailto:ops@dramascan.local',
      WEB_PUSH_TTL_SECONDS: '120',
      PUSH_ALLOWED_HOSTS: 'fcm.googleapis.com, updates.push.services.mozilla.com',
    });

    expect(config.publicKey).toBe('public-key');
    expect(config.privateKey).toBe('private-key');
    expect(config.subject).toBe('mailto:ops@dramascan.local');
    expect(config.ttlSeconds).toBe(120);
    expect(config.allowedHosts).toEqual([
      'fcm.googleapis.com',
      'updates.push.services.mozilla.com',
    ]);
  });
});

describe('runNotificationMaintenance', () => {
  it('refuses to run without a database URL', async () => {
    const report = await runNotificationMaintenance({
      connectionString: undefined,
      log: () => {},
    });

    expect(report.failures[0]?.reason).toBe('missing_database_url');
  });

  it('removes one bounded batch from every table', async () => {
    const calls: QueryCall[] = [];
    const client = fakeClient(calls, [
      {
        match: 'delete from notifications',
        result: { rows: [], rowCount: 4 },
      },
      {
        match: 'delete from notification_deliveries where id in (\n                    select d.id',
        result: { rows: [], rowCount: 3 },
      },
      {
        match: 'delete from notification_deliveries where id in (\n                    select id',
        result: { rows: [], rowCount: 2 },
      },
    ]);

    const report = await runNotificationMaintenance({
      client: client as never,
      connectionString: 'postgresql://localhost:5432/dramascan_test',
      limit: 1000,
      config: PUSH_CONFIG,
      log: () => {},
    });

    expect(report.invalidNotifications).toBe(4);
    expect(report.orphanedDeliveries).toBe(3);
    expect(report.oldDeliveries).toBe(2);
    expect(report.failures).toHaveLength(0);

    const deletes = calls.map(call => call.sql).filter(sql => sql.includes('delete from'));

    expect(deletes).toHaveLength(3);

    // Every delete is bounded by the limit.
    for (const statement of deletes) {
      expect(statement).toContain('limit $');
    }
  });

  it('never retries a notification that already reached a browser', async () => {
    const calls: QueryCall[] = [];
    const client = fakeClient(calls, []);

    await runNotificationMaintenance({
      client: client as never,
      connectionString: 'postgresql://localhost:5432/dramascan_test',
      config: PUSH_CONFIG,
      log: () => {},
    });

    const candidateQuery = calls
      .map(call => call.sql)
      .find(sql => sql.includes('from notifications n'));

    expect(candidateQuery).toBeDefined();
    expect(candidateQuery).toContain("d.channel = 'push'");
    expect(candidateQuery).toContain('d.success = true');
    expect(candidateQuery).toContain('not exists');
  });

  it('only considers recent notifications and stops after three attempts', async () => {
    const calls: QueryCall[] = [];
    const client = fakeClient(calls, []);

    await runNotificationMaintenance({
      client: client as never,
      connectionString: 'postgresql://localhost:5432/dramascan_test',
      config: PUSH_CONFIG,
      log: () => {},
    });

    const candidateQuery = calls
      .map(call => call.sql)
      .find(sql => sql.includes('from notifications n'));

    expect(candidateQuery).toContain('make_interval(days => $1)');
    expect(candidateQuery).toContain('count(*)');
    expect(candidateQuery).toContain('limit $3');

    const candidateCall = calls.find(call => call.sql.includes('from notifications n'));

    expect(candidateCall?.values?.[0]).toBe(PUSH_RETRY_WINDOW_DAYS);
    expect(candidateCall?.values?.[1]).toBe(MAX_PUSH_RETRY_ATTEMPTS);
  });

  it('claims candidates exclusively, releases the lease, and rechecks delivery before sending', async () => {
    const calls: QueryCall[] = [];
    const candidate = {
      id: '0198f3a2-0000-7000-8000-000000000001',
      user_id: '0198f3a2-0000-7000-8000-000000000002',
      event_type: 'new_drama',
      title: 'Lease candidate',
      content: 'The command must claim this row.',
      link: null,
    };
    const client = fakeClient(calls, [
      {
        match: 'from notifications n',
        result: { rows: [candidate], rowCount: 1 },
      },
      {
        match: 'select exists',
        result: { rows: [{ delivered: false }], rowCount: 1 },
      },
    ]);

    await runNotificationMaintenance({
      client: client as never,
      connectionString: 'postgresql://localhost:5432/dramascan_test',
      config: PUSH_CONFIG,
      log: () => {},
    });

    const candidateIndex = calls.findIndex(call => call.sql.includes('from notifications n'));
    const candidateSql = calls[candidateIndex]?.sql ?? '';

    expect(candidateSql).toContain('for update skip locked');
    expect(candidateSql).toContain('n.delivery_lease_until is null');
    expect(candidateSql).toContain('n.delivery_lease_until <= now()');

    const beginIndex = calls.findIndex(call => call.sql.trim().toLowerCase() === 'begin');
    const claimIndex = calls.findIndex(
      call =>
        call.sql.includes('set delivery_lease_until = now()') &&
        call.sql.includes('delivery_lease_token =')
    );
    const commitIndex = calls.findIndex(call => call.sql.trim().toLowerCase() === 'commit');

    expect(beginIndex).toBeGreaterThanOrEqual(0);
    expect(beginIndex).toBeLessThan(candidateIndex);
    expect(claimIndex).toBeGreaterThan(candidateIndex);
    expect(commitIndex).toBeGreaterThan(claimIndex);

    const repeatedCheckIndex = calls.findIndex(
      call =>
        call.sql.includes('select exists') &&
        call.sql.includes("d.channel = 'push'") &&
        call.sql.includes('d.success = true')
    );
    const subscriptionsIndex = calls.findIndex(call =>
      call.sql.includes('select id, endpoint, p256dh, auth')
    );

    expect(repeatedCheckIndex).toBeGreaterThan(candidateIndex);
    expect(repeatedCheckIndex).toBeLessThan(subscriptionsIndex);

    const releaseIndex = calls.findIndex(
      call =>
        call.sql.includes('set delivery_lease_until = null') &&
        call.sql.includes('delivery_lease_token = null')
    );
    const releaseSql = calls[releaseIndex]?.sql ?? '';

    expect(releaseIndex).toBeGreaterThan(repeatedCheckIndex);
    expect(releaseSql).toContain('delivery_lease_token = $2');

    expect(DELIVERY_LEASE_SECONDS).toBe(300);
  });

  it('removes the delivery records the retention window no longer keeps', async () => {
    const calls: QueryCall[] = [];
    const client = fakeClient(calls, []);

    await runNotificationMaintenance({
      client: client as never,
      connectionString: 'postgresql://localhost:5432/dramascan_test',
      config: PUSH_CONFIG,
      log: () => {},
    });

    const oldDeliveryDelete = calls
      .map(call => call.sql)
      .find(sql => sql.includes('created_at < now()'));

    expect(oldDeliveryDelete).toBeDefined();

    const oldDeliveryCall = calls.find(call => call.sql.includes('created_at < now()'));

    expect(oldDeliveryCall?.values?.[0]).toBe(DELIVERY_RETENTION_DAYS);
  });

  it('records a failure instead of throwing', async () => {
    const calls: QueryCall[] = [];
    const client = fakeClient(calls, []);

    const originalQuery = client.query;

    client.query = async (sql: string, values?: unknown[]) => {
      if (sql.includes('delete from notifications')) {
        throw new Error('permission denied');
      }

      return originalQuery(sql, values);
    };

    const report = await runNotificationMaintenance({
      client: client as never,
      connectionString: 'postgresql://localhost:5432/dramascan_test',
      config: PUSH_CONFIG,
      log: () => {},
    });

    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.reason).toBe('invalidNotifications');
  });
});

describe('createLogger', () => {
  it('writes one JSON object per line', () => {
    const lines: string[] = [];
    const log = createLogger(line => lines.push(line));

    log('notification_maintenance.started', { limit: 1000 });

    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0] as string) as {
      event: string;
      limit: number;
      timestamp: string;
    };

    expect(parsed.event).toBe('notification_maintenance.started');
    expect(parsed.limit).toBe(1000);
    expect(typeof parsed.timestamp).toBe('string');
  });
});
