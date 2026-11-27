import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Delivery-lease coverage for notification maintenance (Phase 11 review T7).
 *
 * Two maintenance runs may overlap: the systemd timer can fire while an
 * operator starts the command by hand. The database lease makes the claim
 * exclusive, while the repeated delivery checks keep a claimed row from being
 * sent when another path already delivered it or exhausted the attempt cap.
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

import { inArray, like, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import {
  MAX_PUSH_RETRY_ATTEMPTS,
  countPushAttempts,
  getNotificationPreferences,
  recordDelivery,
  retryFailedPushDeliveries,
  saveSubscription,
  writeNotificationOnce,
} from '@/modules/notifications';
import {
  notification_deliveries,
  notification_preferences,
  notifications,
  push_subscriptions,
} from '@/modules/notifications/schema';
import { closePool } from '@/platform/db/pool';

const TEST_EMAIL_PREFIX = 'r5t7-';

type Fixture = {
  userId: string;
  notificationId: string;
};

async function cleanup(): Promise<void> {
  const fixtureUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
  const userIds = fixtureUsers.map(user => user.id);

  if (userIds.length > 0) {
    await db
      .delete(notification_deliveries)
      .where(inArray(notification_deliveries.user_id, userIds));
    await db.delete(notifications).where(inArray(notifications.user_id, userIds));
    await db
      .delete(notification_preferences)
      .where(inArray(notification_preferences.user_id, userIds));
    await db.delete(push_subscriptions).where(inArray(push_subscriptions.user_id, userIds));
  }

  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
}

async function createFixture(): Promise<Fixture> {
  const email = `${TEST_EMAIL_PREFIX}${randomUUID().replace(/-/g, '')}@example.com`;
  const [user] = await db
    .insert(users)
    .values({
      name: 'Delivery lease fixture',
      email,
    })
    .returning({ id: users.id });

  if (!user) {
    throw new Error('The fixture user was not created.');
  }

  const preferences = await getNotificationPreferences(user.id);
  const created = await writeNotificationOnce(
    {
      userId: user.id,
      title: `${TEST_EMAIL_PREFIX}Push candidate`,
      content: 'The delivery lease owns this retry.',
      eventType: 'new_drama',
      contentId: randomUUID(),
      contentType: 'drama',
    },
    preferences
  );

  if (created.status !== 'created') {
    throw new Error('The fixture notification was not created.');
  }

  await saveSubscription(user.id, {
    endpoint: `https://push.example.com/${TEST_EMAIL_PREFIX}${randomUUID()}`,
    p256dh: 'public-key',
    auth: 'auth-secret',
    browser: 'chromium',
    userAgent: 'delivery-lease-test',
  });

  return { userId: user.id, notificationId: created.id };
}

async function readLease(notificationId: string): Promise<{
  leaseUntil: string | Date | null;
  leaseToken: string | null;
}> {
  const result = await db.execute(sql`
    select delivery_lease_until, delivery_lease_token
      from notifications
     where id = ${notificationId}
  `);

  const row = result.rows[0] as
    | {
        delivery_lease_until: string | Date | null;
        delivery_lease_token: string | null;
      }
    | undefined;

  return {
    leaseUntil: row?.delivery_lease_until ?? null,
    leaseToken: row?.delivery_lease_token ?? null,
  };
}

beforeEach(async () => {
  await cleanup();
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('notification delivery lease', () => {
  it('never retries a notification that already has a successful push delivery', async () => {
    const fixture = await createFixture();

    await recordDelivery(db, {
      notificationId: fixture.notificationId,
      userId: fixture.userId,
      channel: 'push',
      success: true,
      errorMessage: null,
    });

    const before = await countPushAttempts(fixture.notificationId);
    const result = await retryFailedPushDeliveries(200);
    const after = await countPushAttempts(fixture.notificationId);

    expect(result.delivered).toBe(0);
    expect(after).toBe(before);
    expect(after).toBe(1);
  });

  it('never retries a notification whose push attempts reached the cap', async () => {
    const fixture = await createFixture();

    for (let attempt = 0; attempt < MAX_PUSH_RETRY_ATTEMPTS; attempt += 1) {
      await recordDelivery(db, {
        notificationId: fixture.notificationId,
        userId: fixture.userId,
        channel: 'push',
        success: false,
        errorMessage: 'The push service could not be reached.',
      });
    }

    const result = await retryFailedPushDeliveries(200);
    const after = await countPushAttempts(fixture.notificationId);

    expect(result.delivered).toBe(0);
    expect(after).toBe(MAX_PUSH_RETRY_ATTEMPTS);
  });

  it('does not retry a candidate while another run holds a live lease', async () => {
    const fixture = await createFixture();

    await db.execute(sql`
      update notifications
         set delivery_lease_until = now() + interval '5 minutes',
             delivery_lease_token = 'another-run'
       where id = ${fixture.notificationId}
    `);

    const result = await retryFailedPushDeliveries(200);
    const attempts = await countPushAttempts(fixture.notificationId);
    const lease = await readLease(fixture.notificationId);

    expect(result.delivered).toBe(0);
    expect(attempts).toBe(0);
    expect(lease.leaseToken).toBe('another-run');
    expect(lease.leaseUntil).not.toBeNull();
  });

  it('releases its lease after a normal retry run', async () => {
    const fixture = await createFixture();

    const result = await retryFailedPushDeliveries(200);
    const attempts = await countPushAttempts(fixture.notificationId);
    const lease = await readLease(fixture.notificationId);

    expect(result.retried).toBeGreaterThanOrEqual(1);
    expect(attempts).toBe(1);
    expect(lease.leaseUntil).toBeNull();
    expect(lease.leaseToken).toBeNull();
  });

  it('can claim a notification whose previous lease has expired', async () => {
    const fixture = await createFixture();

    await db.execute(sql`
      update notifications
         set delivery_lease_until = now() - interval '1 second',
             delivery_lease_token = 'expired-run'
       where id = ${fixture.notificationId}
    `);

    const result = await retryFailedPushDeliveries(200);
    const attempts = await countPushAttempts(fixture.notificationId);
    const lease = await readLease(fixture.notificationId);

    expect(result.retried).toBeGreaterThanOrEqual(1);
    expect(attempts).toBe(1);
    expect(lease.leaseUntil).toBeNull();
    expect(lease.leaseToken).toBeNull();
  });
});
