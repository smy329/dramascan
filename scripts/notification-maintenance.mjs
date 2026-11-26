/**
 * Notification maintenance command.
 *
 * A short-lived maintenance command: it runs once, retries the push
 * deliveries that never reached a browser, removes the records the retention
 * policy no longer keeps, writes a structured report, and exits. It is not a
 * worker and it does not schedule itself; the systemd timer starts it.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/notification-maintenance.mjs
 *   npm run db:notifications:maintenance
 *
 * Environment:
 *   DATABASE_URL                    required; the database the command runs against.
 *   NOTIFICATION_MAINTENANCE_LIMIT  optional; rows touched per step (default 1000).
 *   WEB_PUSH_PUBLIC_KEY             optional; the VAPID public key.
 *   WEB_PUSH_PRIVATE_KEY            optional; the VAPID private key.
 *   WEB_PUSH_SUBJECT                optional; the contact address the push service shows.
 *   WEB_PUSH_TTL_SECONDS            optional; the message lifetime in seconds.
 *   PUSH_ALLOWED_HOSTS              optional; the hosts a push endpoint may point at.
 *
 * The command shares the delivery rule, the delivery limits, and the push
 * transport with the application. It imports
 * `src/modules/notifications/delivery-rules.ts`,
 * `src/modules/notifications/delivery-limits.ts`, and
 * `src/modules/notifications/push-transport.ts` directly — Node runs the
 * TypeScript sources with its built-in type stripping — so there is exactly
 * one implementation of "may this notification be pushed?", of "how many
 * attempts may it receive?", and of "is this endpoint acceptable?". The
 * command needs no build step and no dependency beyond the ones the
 * application already has.
 *
 * The SQL mirrors `src/modules/notifications/delivery.ts`. Keep the two in
 * step: a rule that exists in only one of them is a rule the command and the
 * application disagree about.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { parse } from 'dotenv';
import { Client } from 'pg';

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  isDeliveryAllowed,
} from '../src/modules/notifications/delivery-rules.ts';
import {
  DELIVERY_RETENTION_DAYS,
  MAX_DELIVERY_ATTEMPTS,
  MAX_PUSH_RETRY_ATTEMPTS,
  PUSH_RETRY_WINDOW_DAYS,
} from '../src/modules/notifications/delivery-limits.ts';
import {
  DEFAULT_PUSH_TIMEOUT_MS,
  sendWebPush,
} from '../src/modules/notifications/push-transport.ts';

/** How many rows one run touches per step. */
export const DEFAULT_LIMIT = 1000;

/** The largest bound one run may use. */
export const MAX_LIMIT = 10_000;

export {
  DELIVERY_RETENTION_DAYS,
  MAX_DELIVERY_ATTEMPTS,
  MAX_PUSH_RETRY_ATTEMPTS,
  PUSH_RETRY_WINDOW_DAYS,
};

/** The default lifetime of a queued push message, in seconds. */
const DEFAULT_PUSH_TTL_SECONDS = 3600;

/**
 * The outcome of one maintenance run.
 *
 * @typedef {object} MaintenanceReport
 * @property {string} startedAt
 * @property {string} finishedAt
 * @property {number} limit
 * @property {number} considered
 * @property {number} retried
 * @property {number} delivered
 * @property {number} expiredSubscriptions
 * @property {number} invalidNotifications
 * @property {number} orphanedDeliveries
 * @property {number} oldDeliveries
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
 * The push configuration of this deployment.
 *
 * @param {Record<string, string | undefined>} [environment] the environment to read
 */
export function readPushConfig(environment = process.env) {
  const read = name => {
    const value = environment[name]?.trim() ?? '';
    return value.length > 0 ? value : null;
  };
  return {
    publicKey: read('WEB_PUSH_PUBLIC_KEY'),
    privateKey: read('WEB_PUSH_PRIVATE_KEY'),
    subject: read('WEB_PUSH_SUBJECT') ?? 'mailto:noreply@dramascan.local',
    ttlSeconds: parsePositiveInteger(
      environment.WEB_PUSH_TTL_SECONDS,
      DEFAULT_PUSH_TTL_SECONDS,
      2_419_200
    ),
    allowedHosts: (environment.PUSH_ALLOWED_HOSTS ?? '')
      .split(',')
      .map(host => host.trim().toLowerCase())
      .filter(host => host.length > 0),
    timeoutMs: DEFAULT_PUSH_TIMEOUT_MS,
  };
}

/**
 * Run the notification maintenance once.
 *
 * The function is exported so the test suite can drive it against the test
 * database; the command line entry point is added at the bottom of the file.
 *
 * @param {{ connectionString?: string, client?: any, limit?: number, config?: ReturnType<typeof readPushConfig>, log?: (event: string, payload?: Record<string, unknown>) => void }} [options]
 * @returns {Promise<MaintenanceReport>}
 */
export async function runNotificationMaintenance(options = {}) {
  const {
    connectionString = process.env.DATABASE_URL,
    client: providedClient,
    limit = parsePositiveInteger(
      process.env.NOTIFICATION_MAINTENANCE_LIMIT,
      DEFAULT_LIMIT,
      MAX_LIMIT
    ),
    config = readPushConfig(),
    log = createLogger(),
  } = options;

  const startedAt = new Date().toISOString();
  /** @type {MaintenanceReport} */
  const report = {
    startedAt,
    finishedAt: startedAt,
    limit,
    considered: 0,
    retried: 0,
    delivered: 0,
    expiredSubscriptions: 0,
    invalidNotifications: 0,
    orphanedDeliveries: 0,
    oldDeliveries: 0,
    failures: [],
  };

  if (!connectionString && !providedClient) {
    log('notification_maintenance.failed', { reason: 'missing_database_url' });
    report.failures.push({ reason: 'missing_database_url', message: 'DATABASE_URL is not set.' });
    report.finishedAt = new Date().toISOString();
    return report;
  }

  const client = providedClient ?? new Client({ connectionString });
  const ownsClient = providedClient === undefined;

  try {
    await client.connect();

    log('notification_maintenance.started', {
      limit,
      pushConfigured: Boolean(config.publicKey && config.privateKey),
    });

    await retryFailedPushes(client, report, log, config, limit);

    await removeRows(client, report, log, {
      key: 'invalidNotifications',
      removeSql: `delete from notifications where id in (
                    select id from notifications
                     where deleted_at is null
                       and (user_id is null or event_type is null or title is null or content is null)
                     limit $1
                  )`,
      parameters: [limit],
    });

    await removeRows(client, report, log, {
      key: 'orphanedDeliveries',
      removeSql: `delete from notification_deliveries where id in (
                    select d.id
                      from notification_deliveries d
                      left join notifications n on n.id = d.notification_id
                     where n.id is null
                     limit $1
                  )`,
      parameters: [limit],
    });

    await removeRows(client, report, log, {
      key: 'oldDeliveries',
      removeSql: `delete from notification_deliveries where id in (
                    select id from notification_deliveries
                     where created_at < now() - make_interval(days => $1)
                     limit $2
                  )`,
      parameters: [DELIVERY_RETENTION_DAYS, limit],
    });

    report.finishedAt = new Date().toISOString();

    log('notification_maintenance.finished', {
      retried: report.retried,
      delivered: report.delivered,
      failed: report.failures.length,
      durationMs: Date.parse(report.finishedAt) - Date.parse(startedAt),
    });

    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.failures.push({ reason: 'fatal', message });
    report.finishedAt = new Date().toISOString();
    log('notification_maintenance.failed', { reason: 'fatal', message });
    return report;
  } finally {
    if (ownsClient) {
      await client.end();
    }
  }
}

/**
 * Retry the push delivery of the notifications that never reached a browser.
 *
 * The same three rules the application applies: only the last
 * `PUSH_RETRY_WINDOW_DAYS`, never a notification that already reached a
 * browser, and never more than `MAX_PUSH_RETRY_ATTEMPTS` recorded attempts.
 *
 * @param {any} client
 * @param {MaintenanceReport} report
 * @param {(event: string, payload?: Record<string, unknown>) => void} log
 * @param {ReturnType<typeof readPushConfig>} config
 * @param {number} limit
 */
async function retryFailedPushes(client, report, log, config, limit) {
  const bounded = Math.min(limit, 200);

  const candidates = await client.query(
    `select n.id, n.user_id, n.event_type, n.title, n.content, n.link
       from notifications n
      where n.deleted_at is null
        and n.created_at >= now() - make_interval(days => $1)
        and exists (
          select 1
            from push_subscriptions s
           where s.user_id = n.user_id
             and s.deleted_at is null
        )
        and not exists (
          select 1
            from notification_deliveries d
           where d.notification_id = n.id
             and d.channel = 'push'
             and d.success = true
        )
        and (
          select count(*)
            from notification_deliveries d
           where d.notification_id = n.id
             and d.channel = 'push'
        ) < $2
      order by n.created_at desc
      limit $3`,
    [PUSH_RETRY_WINDOW_DAYS, MAX_PUSH_RETRY_ATTEMPTS, bounded]
  );

  report.considered = candidates.rows.length;

  for (const candidate of candidates.rows) {
    try {
      const preferences = await readPreferences(client, candidate.user_id);

      if (!isDeliveryAllowed(preferences, candidate.event_type, 'push')) {
        continue;
      }

      const subscriptions = await client.query(
        `select id, endpoint, p256dh, auth
           from push_subscriptions
          where user_id = $1
            and deleted_at is null
          order by created_at asc
          limit $2`,
        [candidate.user_id, MAX_DELIVERY_ATTEMPTS]
      );

      if (subscriptions.rows.length === 0) {
        continue;
      }

      report.retried += 1;

      for (const subscription of subscriptions.rows) {
        const result = await sendWebPush(
          {
            endpoint: subscription.endpoint,
            p256dh: subscription.p256dh ?? null,
            auth: subscription.auth ?? null,
          },
          {
            title: candidate.title,
            body: candidate.content,
            link: candidate.link ?? null,
            collapseKey: candidate.id,
          },
          config
        );

        await recordDelivery(client, {
          notificationId: candidate.id,
          userId: candidate.user_id,
          success: result.delivered,
          errorMessage: result.error,
          subscriptionId: subscription.id,
        });

        if (result.delivered) {
          report.delivered += 1;
          continue;
        }

        if (result.expired) {
          await retireSubscription(client, subscription.id);
          report.expiredSubscriptions += 1;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.failures.push({ reason: 'retry', message });
      log('notification_maintenance.failed', { reason: 'retry', message });
    }
  }
}

/**
 * The preferences of one recipient.
 *
 * A recipient without a preference row has the defaults: everything on.
 *
 * @param {any} client
 * @param {string} userId
 */
async function readPreferences(client, userId) {
  const result = await client.query(
    `select new_episode, new_drama, new_drama_season, website_announcement,
            global_in_app, global_push
       from notification_preferences
      where user_id = $1
        and deleted_at is null
      limit 1`,
    [userId]
  );

  const row = result.rows[0];

  if (!row) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  return {
    newEpisode: row.new_episode !== false,
    newDrama: row.new_drama !== false,
    newDramaSeason: row.new_drama_season !== false,
    websiteAnnouncement: row.website_announcement !== false,
    accountSecurity: true,
    globalInApp: row.global_in_app !== false,
    globalPush: row.global_push !== false,
  };
}

/**
 * Record one delivery attempt.
 *
 * @param {any} client
 * @param {{ notificationId: string, userId: string, success: boolean, errorMessage: string | null, subscriptionId: string | null }} input
 */
async function recordDelivery(client, input) {
  await client.query(
    `insert into notification_deliveries
       (notification_id, user_id, channel, success, error_message, subscription_id, delivered_at)
     values ($1, $2, 'push', $3, $4, $5, now())`,
    [
      input.notificationId,
      input.userId,
      input.success,
      input.errorMessage,
      input.subscriptionId,
    ]
  );
}

/**
 * Retire a subscription the push service reported as gone.
 *
 * @param {any} client
 * @param {string} subscriptionId
 */
async function retireSubscription(client, subscriptionId) {
  await client.query(
    `update push_subscriptions
        set deleted_at = now(), updated_at = now()
      where id = $1
        and deleted_at is null`,
    [subscriptionId]
  );
}

/**
 * Remove one bounded batch of rows and record what happened.
 *
 * @param {any} client
 * @param {MaintenanceReport} report
 * @param {(event: string, payload?: Record<string, unknown>) => void} log
 * @param {{ key: string, removeSql: string, parameters: unknown[] }} options
 */
async function removeRows(client, report, log, options) {
  try {
    const result = await client.query(options.removeSql, options.parameters);
    const removed = result.rowCount ?? 0;

    report[options.key] = removed;
    log('notification_maintenance.removed', { table: options.key, rows: removed });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    report[options.key] = 0;
    report.failures.push({ reason: options.key, message });
    log('notification_maintenance.failed', { table: options.key, message });
  }
}

/** Command line entry point. */
async function main() {
  loadLocalEnv();

  const report = await runNotificationMaintenance();

  if (report.failures.length > 0) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];

if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch(error => {
    createLogger()('notification_maintenance.failed', {
      reason: 'unhandled',
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  });
}
