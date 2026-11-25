import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Notification idempotency and delivery maintenance (D-069).
 *
 * The reviewer's findings 4–6 are pinned here:
 *
 *   - A notification row is written at most once; the database decides.
 *   - A notification that already reached a browser is never pushed again.
 *   - A notification is retried at most `MAX_PUSH_RETRY_ATTEMPTS` times.
 *   - Cleanup removes a bounded batch, not "everything and report the limit".
 *
 * These tests run against the real PostgreSQL test database. No push provider
 * is configured, so a retried delivery records an honest failure instead of
 * pretending to send.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for notification integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { and, eq, inArray, lt } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  notification_deliveries,
  notification_preferences,
  notifications,
  push_subscriptions,
} from '@/modules/notifications/schema';
import {
  MAX_PUSH_RETRY_ATTEMPTS,
  countPushAttempts,
  getNotificationPreferences,
  hasSuccessfulPushDelivery,
  recordDelivery,
  retryFailedPushDeliveries,
  runNotificationMaintenance,
  saveSubscription,
  updateNotificationPreferences,
  writeNotificationOnce,
} from '@/modules/notifications';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-delivery-';

type Seed = {
  userId: string;
  contentId: string;
};

function seed(): Seed {
  return { userId: randomUUID(), contentId: randomUUID() };
}

async function cleanup(seeded: Seed): Promise<void> {
  await db
    .delete(notification_deliveries)
    .where(eq(notification_deliveries.user_id, seeded.userId));
  await db.delete(notifications).where(eq(notifications.user_id, seeded.userId));
  await db
    .delete(notification_preferences)
    .where(eq(notification_preferences.user_id, seeded.userId));
  await db.delete(push_subscriptions).where(eq(push_subscriptions.user_id, seeded.userId));
}

async function pushDeliveries(notificationId: string): Promise<
  Array<{ success: boolean | null; errorMessage: string | null }>
> {
  return db
    .select({
      success: notification_deliveries.success,
      errorMessage: notification_deliveries.error_message,
    })
    .from(notification_deliveries)
    .where(
      and(
        eq(notification_deliveries.notification_id, notificationId),
        eq(notification_deliveries.channel, 'push')
      )
    );
}

describe('notification idempotency', () => {
  let seeded: Seed;

  beforeEach(() => {
    seeded = seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
  });

  it('writes a content notification once and reports the repeat as a duplicate', async () => {
    const preferences = await getNotificationPreferences(seeded.userId);
    const input = {
      userId: seeded.userId,
      title: `${TEST_PREFIX}New episode`,
      content: 'A new episode is available.',
      eventType: 'new_episode' as const,
      contentId: seeded.contentId,
      contentType: 'drama',
    };

    const first = await writeNotificationOnce(input, preferences);
    const second = await writeNotificationOnce(input, preferences);

    expect(first.status).toBe('created');
    expect(second.status).toBe('duplicate');

    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.user_id, seeded.userId));

    expect(rows).toHaveLength(1);
  });

  it('does not write a notification the recipient switched off', async () => {
    await updateNotificationPreferences(seeded.userId, { newEpisode: false });
    const preferences = await getNotificationPreferences(seeded.userId);

    const outcome = await writeNotificationOnce(
      {
        userId: seeded.userId,
        title: `${TEST_PREFIX}Ignored`,
        content: 'Not wanted.',
        eventType: 'new_episode',
        contentId: seeded.contentId,
        contentType: 'drama',
      },
      preferences
    );

    expect(outcome.status).toBe('not_wanted');

    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.user_id, seeded.userId));

    expect(rows).toHaveLength(0);
  });

  it('never collapses two mandatory notifications without a content id', async () => {
    const preferences = await getNotificationPreferences(seeded.userId);
    const input = {
      userId: seeded.userId,
      title: `${TEST_PREFIX}Security`,
      content: 'Your session was ended.',
      eventType: 'account_security' as const,
    };

    const first = await writeNotificationOnce(input, preferences);
    const second = await writeNotificationOnce(input, preferences);

    expect(first.status).toBe('created');
    expect(second.status).toBe('created');

    const rows = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.user_id, seeded.userId));

    expect(rows).toHaveLength(2);
  });
});

describe('notification delivery maintenance', () => {
  let seeded: Seed;

  beforeEach(() => {
    seeded = seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
  });

  async function createFixtureNotification(): Promise<string> {
    const preferences = await getNotificationPreferences(seeded.userId);
    const created = await writeNotificationOnce(
      {
        userId: seeded.userId,
        title: `${TEST_PREFIX}Push me`,
        content: 'Delivery maintenance.',
        eventType: 'new_drama',
        contentId: seeded.contentId,
        contentType: 'drama',
      },
      preferences
    );

    if (created.status !== 'created') {
      throw new Error('The fixture notification was not created.');
    }

    return created.id;
  }

  async function subscribe(): Promise<void> {
    await saveSubscription(seeded.userId, {
      endpoint: `https://push.example.com/${TEST_PREFIX}${randomUUID()}`,
      p256dh: 'public-key',
      auth: 'auth-secret',
      browser: 'chromium',
      userAgent: 'test',
    });
  }

  async function createNotificationWithSubscription(): Promise<string> {
    const notificationId = await createFixtureNotification();

    await subscribe();

    return notificationId;
  }

  it('never re-sends a notification that already reached a browser', async () => {
    const notificationId = await createNotificationWithSubscription();

    await recordDelivery(db, {
      notificationId,
      userId: seeded.userId,
      channel: 'push',
      success: true,
      errorMessage: null,
    });

    const before = await pushDeliveries(notificationId);
    const result = await retryFailedPushDeliveries(200);
    const after = await pushDeliveries(notificationId);

    expect(result.delivered).toBe(0);
    expect(after).toHaveLength(before.length);
    expect(after.every(row => row.success === true)).toBe(true);
    expect(await hasSuccessfulPushDelivery(notificationId)).toBe(true);
  });

  it('stops retrying a notification after the attempt cap', async () => {
    const notificationId = await createNotificationWithSubscription();

    for (let attempt = 0; attempt < MAX_PUSH_RETRY_ATTEMPTS; attempt += 1) {
      await recordDelivery(db, {
        notificationId,
        userId: seeded.userId,
        channel: 'push',
        success: false,
        errorMessage: 'The push service could not be reached.',
      });
    }

    const result = await retryFailedPushDeliveries(200);

    expect(result.delivered).toBe(0);
    expect(await countPushAttempts(notificationId)).toBe(MAX_PUSH_RETRY_ATTEMPTS);
  });

  it('retries a notification that never reached a browser', async () => {
    const notificationId = await createNotificationWithSubscription();

    const result = await retryFailedPushDeliveries(200);
    const deliveries = await pushDeliveries(notificationId);

    expect(result.retried).toBeGreaterThanOrEqual(1);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.success).toBe(false);
    expect(deliveries[0]?.errorMessage).toBeTruthy();
    expect(await hasSuccessfulPushDelivery(notificationId)).toBe(false);
  });

  it('removes at most one bounded batch of old delivery records per run', async () => {
    // No subscription: the retry step must not add a delivery of its own.
    const notificationId = await createFixtureNotification();
    const old = new Date('2020-01-01T00:00:00.000Z');
    const cutoff = new Date('2021-01-01T00:00:00.000Z');

    await db.insert(notification_deliveries).values(
      Array.from({ length: 5 }, () => ({
        notification_id: notificationId,
        user_id: seeded.userId,
        channel: 'in_app',
        success: true,
        error_message: null,
        delivered_at: old,
        created_at: old,
      }))
    );

    const countOld = async (): Promise<number> => {
      const rows = await db
        .select({ id: notification_deliveries.id })
        .from(notification_deliveries)
        .where(
          and(
            eq(notification_deliveries.notification_id, notificationId),
            lt(notification_deliveries.created_at, cutoff)
          )
        );

      return rows.length;
    };

    const firstRun = await runNotificationMaintenance({ olderThan: cutoff, limit: 2 });

    expect(firstRun.oldDeliveries).toBe(2);
    expect(await countOld()).toBe(3);

    await runNotificationMaintenance({ olderThan: cutoff, limit: 2 });

    expect(await countOld()).toBe(1);
  });

  it('removes delivery records whose notification no longer exists', async () => {
    const orphanId = randomUUID();

    await recordDelivery(db, {
      notificationId: orphanId,
      userId: seeded.userId,
      channel: 'in_app',
      success: true,
      errorMessage: null,
    });

    await runNotificationMaintenance({ limit: 1000 });

    const rows = await db
      .select({ id: notification_deliveries.id })
      .from(notification_deliveries)
      .where(
        and(
          eq(notification_deliveries.notification_id, orphanId),
          inArray(notification_deliveries.user_id, [seeded.userId])
        )
      );

    expect(rows).toHaveLength(0);
  });
});

afterAll(async () => {
  await closePool();
});
