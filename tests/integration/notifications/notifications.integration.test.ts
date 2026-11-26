import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Notification integration coverage (Prompts 148–154).
 *
 * The rules this suite pins down:
 *
 *   - A notification is private to the viewer it was written for.
 *   - A delivery requires the global switch of its channel *and* the event
 *     preference. Account/security notifications are mandatory.
 *   - A repeated publication request produces no second notification.
 *   - A failed push is recorded, not retried, and a dead subscription is
 *     retired.
 *
 * These tests run against the real PostgreSQL test database.
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

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { userActor } from '@/modules/authorization';
import { dramas, episodes, seasons } from '@/modules/content/schema';
import { bookmarks } from '@/modules/users/schema';
import {
  announcements,
  notification_deliveries,
  notification_preferences,
  notifications,
  push_subscriptions,
} from '@/modules/notifications/schema';
import {
  createNotification,
  createAnnouncement,
  deliverPush,
  dismissNotification,
  getNotificationCenter,
  getNotificationPreferences,
  getUnreadNotificationCount,
  listAnnouncements,
  listDeliveries,
  listSubscriptions,
  markAllNotificationsRead,
  markNotificationRead,
  notifyNewEpisode,
  publishAnnouncement,
  removeSubscription,
  saveSubscription,
  updateNotificationPreferences,
} from '@/modules/notifications';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-notifications-';

type Seed = {
  userId: string;
  otherUserId: string;
  dramaId: string;
  seasonId: string;
  episodeId: string;
};

async function seed(): Promise<Seed> {
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const dramaId = randomUUID();
  const seasonId = randomUUID();
  const episodeId = randomUUID();

  await db.insert(users).values([
    {
      id: userId,
      name: 'Notification tester',
      email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
    },
    {
      id: otherUserId,
      name: 'Other notification tester',
      email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
    },
  ]);

  await db.insert(dramas).values({
    id: dramaId,
    title: 'Notification drama',
    slug: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
    structure_type: 'season_based',
    status: 'ongoing',
    publication_status: 'published',
    visibility: 'coming_soon',
  });

  await db.insert(seasons).values({
    id: seasonId,
    drama_id: dramaId,
    title: 'Season 1',
    position: 0,
    publication_status: 'published',
  });

  await db.insert(episodes).values({
    id: episodeId,
    drama_id: dramaId,
    season_id: seasonId,
    title: 'Episode 1',
    episode_number: 1,
    position: 0,
    publication_status: 'published',
    video_source: 'https://media.example.com/episodes/1.mp4',
  });

  await db.insert(bookmarks).values({
    user_id: userId,
    content_type: 'drama',
    content_id: dramaId,
    drama_id: dramaId,
  });

  return { userId, otherUserId, dramaId, seasonId, episodeId };
}

async function cleanup(seeded: Seed): Promise<void> {
  await db
    .delete(notification_deliveries)
    .where(
      inArray(
        notification_deliveries.user_id,
        [seeded.userId, seeded.otherUserId]
      )
    );
  await db
    .delete(notifications)
    .where(inArray(notifications.user_id, [seeded.userId, seeded.otherUserId]));
  await db
    .delete(notification_preferences)
    .where(inArray(notification_preferences.user_id, [seeded.userId, seeded.otherUserId]));
  await db
    .delete(push_subscriptions)
    .where(inArray(push_subscriptions.user_id, [seeded.userId, seeded.otherUserId]));
  await db
    .delete(announcements)
    .where(eq(announcements.author_id, seeded.userId));
  await db.delete(bookmarks).where(eq(bookmarks.user_id, seeded.userId));
  await db.delete(episodes).where(eq(episodes.id, seeded.episodeId));
  await db.delete(seasons).where(eq(seasons.id, seeded.seasonId));
  await db.delete(dramas).where(eq(dramas.id, seeded.dramaId));
  await db.delete(users).where(inArray(users.id, [seeded.userId, seeded.otherUserId]));
}

async function countNotifications(userId: string): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.user_id, userId),
        isNull(notifications.deleted_at)
      )
    );

  return rows.length;
}

/**
 * The notifications one recipient holds for one event.
 *
 * The count is scoped to the event, because a broadcast reaches *every* active
 * account: a new drama, a new season, or a website announcement legitimately
 * notifies an account that another test file created in the same shared test
 * database. The assertion of a test is about its own event, not about every
 * notification the recipient happens to hold.
 */
async function countEventNotifications(
  userId: string,
  eventType: string,
  contentId: string
): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.user_id, userId),
        eq(notifications.event_type, eventType),
        eq(notifications.content_id, contentId),
        isNull(notifications.deleted_at)
      )
    );

  return rows.length;
}

describe('notification preferences', () => {
  let seeded: Seed;

  beforeEach(async () => {
    seeded = await seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
  });

  it('defaults to everything on when the viewer has no preference row', async () => {
    const preferences = await getNotificationPreferences(seeded.userId);

    expect(preferences.newEpisode).toBe(true);
    expect(preferences.newDrama).toBe(true);
    expect(preferences.newDramaSeason).toBe(true);
    expect(preferences.websiteAnnouncement).toBe(true);
    expect(preferences.globalInApp).toBe(true);
    expect(preferences.globalPush).toBe(true);
  });

  it('stores the switches the viewer changed', async () => {
    const saved = await updateNotificationPreferences(seeded.userId, {
      newEpisode: false,
      globalPush: false,
    });

    expect(saved.newEpisode).toBe(false);
    expect(saved.globalPush).toBe(false);
    expect(saved.newDrama).toBe(true);

    const rows = await db
      .select({ count: notification_preferences.id })
      .from(notification_preferences)
      .where(eq(notification_preferences.user_id, seeded.userId));

    expect(rows).toHaveLength(1);
  });

  it('keeps the switches independent across updates', async () => {
    await updateNotificationPreferences(seeded.userId, { newDrama: false });
    const saved = await updateNotificationPreferences(seeded.userId, { newDramaSeason: true });

    expect(saved.newDrama).toBe(false);
    expect(saved.newEpisode).toBe(true);
  });

  it('stores the new-drama switch as NOT NULL DEFAULT true', async () => {
    // The column is the fifth independent event switch, and DATABASE.md §8.9
    // defines it as `boolean NOT NULL DEFAULT true`.
    const result = await db.execute(sql`
      select is_nullable, column_default
        from information_schema.columns
       where table_name = 'notification_preferences'
         and column_name = 'new_drama'
    `);

    const rows = 'rows' in result ? result.rows : [];
    const column = rows[0] as { is_nullable?: string; column_default?: string } | undefined;

    expect(column?.is_nullable).toBe('NO');
    expect(column?.column_default).toBe('true');
  });
});

describe('notification center', () => {
  let seeded: Seed;

  beforeEach(async () => {
    seeded = await seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
  });

  it('keeps a notification private to its recipient', async () => {
    await createNotification({
      userId: seeded.userId,
      title: 'Private',
      content: 'Only for the first viewer.',
      eventType: 'new_drama',
    });

    const center = await getNotificationCenter(seeded.otherUserId);

    expect(center.notifications).toHaveLength(0);
    expect(center.unreadCount).toBe(0);
    expect(await countNotifications(seeded.otherUserId)).toBe(0);
  });

  it('counts and marks the viewer’s own unread notifications', async () => {
    const created = await createNotification({
      userId: seeded.userId,
      title: 'First',
      content: 'Hello.',
      eventType: 'new_drama',
    });

    expect(await getUnreadNotificationCount(seeded.userId)).toBe(1);

    const marked = await markNotificationRead(seeded.userId, created?.id ?? '');

    expect(marked).toBe(true);
    expect(await getUnreadNotificationCount(seeded.userId)).toBe(0);
  });

  it('refuses to mark another viewer’s notification as read', async () => {
    const created = await createNotification({
      userId: seeded.otherUserId,
      title: 'Theirs',
      content: 'Not yours.',
      eventType: 'new_drama',
    });

    const marked = await markNotificationRead(seeded.userId, created?.id ?? '');

    expect(marked).toBe(false);
    expect(await getUnreadNotificationCount(seeded.otherUserId)).toBe(1);
  });

  it('marks every one of the viewer’s notifications as read at once', async () => {
    await createNotification({
      userId: seeded.userId,
      title: 'One',
      content: 'One.',
      eventType: 'new_drama',
    });
    await createNotification({
      userId: seeded.userId,
      title: 'Two',
      content: 'Two.',
      eventType: 'new_episode',
    });

    const marked = await markAllNotificationsRead(seeded.userId);

    expect(marked).toBe(2);
    expect(await getUnreadNotificationCount(seeded.userId)).toBe(0);
  });

  it('removes a dismissed notification from the viewer’s center', async () => {
    const created = await createNotification({
      userId: seeded.userId,
      title: 'Dismiss me',
      content: 'Bye.',
      eventType: 'new_drama',
    });

    const dismissed = await dismissNotification(seeded.userId, created?.id ?? '');

    expect(dismissed).toBe(true);
    expect(await countNotifications(seeded.userId)).toBe(0);
  });

  it('hides optional notifications when the in-app switch is off', async () => {
    await updateNotificationPreferences(seeded.userId, { globalInApp: false });

    await createNotification({
      userId: seeded.userId,
      title: 'Optional',
      content: 'Hidden while the switch is off.',
      eventType: 'new_drama',
    });
    await createNotification({
      userId: seeded.userId,
      title: 'Security',
      content: 'Always visible.',
      eventType: 'account_security',
    });

    const center = await getNotificationCenter(seeded.userId);

    expect(center.notifications.map(row => row.eventType)).toEqual(['account_security']);
  });

  it('still records the event when the in-app switch is off', async () => {
    await updateNotificationPreferences(seeded.userId, { globalInApp: false });

    await createNotification({
      userId: seeded.userId,
      title: 'Optional',
      content: 'Recorded, but not shown in the centre.',
      eventType: 'new_drama',
    });

    // The row exists so the push channel can still deliver it, and it honestly
    // reports that the in-app channel did not deliver it.
    expect(await countNotifications(seeded.userId)).toBe(1);

    const [row] = await db
      .select({ delivered: notifications.delivered })
      .from(notifications)
      .where(eq(notifications.user_id, seeded.userId));

    expect(row?.delivered).toBe(false);
  });
});

describe('push subscriptions', () => {
  let seeded: Seed;

  beforeEach(async () => {
    seeded = await seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
  });

  it('stores a subscription for the signed-in viewer', async () => {
    const stored = await saveSubscription(seeded.userId, {
      endpoint: 'https://push.example.com/endpoint/1',
      p256dh: 'public-key',
      auth: 'auth-secret',
      browser: 'chromium',
      userAgent: 'test',
    });

    expect(stored).not.toBeNull();

    const subscriptions = await listSubscriptions(seeded.userId);

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.endpoint).toBe('https://push.example.com/endpoint/1');
  });

  it('replaces the subscription of the same browser instead of duplicating it', async () => {
    await saveSubscription(seeded.userId, {
      endpoint: 'https://push.example.com/endpoint/1',
      p256dh: 'first-key',
      auth: 'first-auth',
      browser: 'chromium',
      userAgent: 'test',
    });
    await saveSubscription(seeded.userId, {
      endpoint: 'https://push.example.com/endpoint/1',
      p256dh: 'second-key',
      auth: 'second-auth',
      browser: 'chromium',
      userAgent: 'test',
    });

    const subscriptions = await listSubscriptions(seeded.userId);

    expect(subscriptions).toHaveLength(1);
  });

  it('removes a subscription of the viewer', async () => {
    const stored = await saveSubscription(seeded.userId, {
      endpoint: 'https://push.example.com/endpoint/2',
      p256dh: 'public-key',
      auth: 'auth-secret',
      browser: 'chromium',
      userAgent: 'test',
    });

    const removed = await removeSubscription(seeded.userId, stored?.id ?? '');

    expect(removed).toBe(true);
    expect(await listSubscriptions(seeded.userId)).toHaveLength(0);
  });
});

describe('notification events', () => {
  let seeded: Seed;

  beforeEach(async () => {
    seeded = await seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
  });

  it('notifies the viewers who bookmarked the drama of a new episode', async () => {
    const result = await notifyNewEpisode({
      episodeId: seeded.episodeId,
      episodeTitle: 'Episode 1',
      dramaId: seeded.dramaId,
      dramaTitle: 'Notification drama',
      link: `/drama/${seeded.dramaId}/notification-drama`,
    });

    expect(result.notified).toBeGreaterThanOrEqual(1);
    expect(
      await countEventNotifications(seeded.userId, 'new_episode', seeded.episodeId)
    ).toBe(1);
    expect(
      await countEventNotifications(seeded.otherUserId, 'new_episode', seeded.episodeId)
    ).toBe(0);
  });

  it('does not notify a viewer who switched the event off', async () => {
    await updateNotificationPreferences(seeded.userId, { newEpisode: false });

    const result = await notifyNewEpisode({
      episodeId: seeded.episodeId,
      episodeTitle: 'Episode 1',
      dramaId: seeded.dramaId,
      dramaTitle: 'Notification drama',
      link: `/drama/${seeded.dramaId}/notification-drama`,
    });

    expect(
      await countEventNotifications(seeded.userId, 'new_episode', seeded.episodeId)
    ).toBe(0);
    expect(result.skippedByPreference).toBeGreaterThanOrEqual(1);
  });

  it('does not produce a second notification for a repeated request', async () => {
    const input = {
      episodeId: seeded.episodeId,
      episodeTitle: 'Episode 1',
      dramaId: seeded.dramaId,
      dramaTitle: 'Notification drama',
      link: `/drama/${seeded.dramaId}/notification-drama`,
    };

    await notifyNewEpisode(input);
    const second = await notifyNewEpisode(input);

    expect(second.notified).toBe(0);
    expect(second.skippedAsDuplicate).toBeGreaterThanOrEqual(1);
    expect(
      await countEventNotifications(seeded.userId, 'new_episode', seeded.episodeId)
    ).toBe(1);
  });
});

describe('website announcements', () => {
  let seeded: Seed;

  beforeEach(async () => {
    seeded = await seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
  });

  it('refuses an actor without the settings permission', async () => {
    // The service is the authority: it re-checks the permission the entrypoint
    // checked, so a caller that reaches it without the guard cannot create or
    // publish an announcement (ARCHITECTURE §11.3).
    const actor = userActor(seeded.otherUserId);

    await expect(
      createAnnouncement(actor, {
        title: 'Not allowed',
        content: 'This viewer may not announce anything.',
        authorId: seeded.otherUserId,
      })
    ).rejects.toThrow();

    const announcement = await createAnnouncement(
      userActor(seeded.userId, { isSuperAdmin: true }),
      {
        title: 'Allowed',
        content: 'The administrator may announce this.',
        authorId: seeded.userId,
      }
    );

    await expect(publishAnnouncement(actor, announcement.id)).rejects.toThrow();

    expect(
      await countEventNotifications(seeded.userId, 'website_announcement', announcement.id)
    ).toBe(0);
  });

  it('refuses a publication of an announcement that does not exist', async () => {
    await expect(
      publishAnnouncement(userActor(seeded.userId, { isSuperAdmin: true }), randomUUID())
    ).rejects.toThrow();
  });

  it('creates a draft that publishes nothing', async () => {
    const announcement = await createAnnouncement(
      userActor(seeded.userId, { isSuperAdmin: true }),
      {
        title: 'Scheduled maintenance',
        content: 'The site will be read-only for an hour.',
        authorId: seeded.userId,
      }
    );

    expect(announcement.status).toBe('draft');
    expect(
      await countEventNotifications(seeded.userId, 'website_announcement', announcement.id)
    ).toBe(0);
  });

  it('notifies the eligible viewers when the announcement is published', async () => {
    const actor = userActor(seeded.userId, { isSuperAdmin: true });
    const announcement = await createAnnouncement(actor, {
      title: 'New features',
      content: 'The notification centre is live.',
      authorId: seeded.userId,
    });

    await publishAnnouncement(actor, announcement.id);

    expect(
      await countEventNotifications(seeded.userId, 'website_announcement', announcement.id)
    ).toBe(1);
    expect(
      await countEventNotifications(seeded.otherUserId, 'website_announcement', announcement.id)
    ).toBe(1);
  });

  it('does not notify twice when the publication is repeated', async () => {
    const actor = userActor(seeded.userId, { isSuperAdmin: true });
    const announcement = await createAnnouncement(actor, {
      title: 'One shot',
      content: 'Only once.',
      authorId: seeded.userId,
    });

    await publishAnnouncement(actor, announcement.id);
    const second = await publishAnnouncement(actor, announcement.id);

    expect(second.notified).toBe(0);
    expect(
      await countEventNotifications(seeded.userId, 'website_announcement', announcement.id)
    ).toBe(1);
  });

  it('respects the announcement preference', async () => {
    await updateNotificationPreferences(seeded.userId, { websiteAnnouncement: false });

    const actor = userActor(seeded.userId, { isSuperAdmin: true });
    const announcement = await createAnnouncement(actor, {
      title: 'Ignored',
      content: 'Not for this viewer.',
      authorId: seeded.userId,
    });

    await publishAnnouncement(actor, announcement.id);

    expect(
      await countEventNotifications(seeded.userId, 'website_announcement', announcement.id)
    ).toBe(0);
    expect(
      await countEventNotifications(seeded.otherUserId, 'website_announcement', announcement.id)
    ).toBe(1);
  });

  it('lists the published announcements', async () => {
    const actor = userActor(seeded.userId, { isSuperAdmin: true });
    const announcement = await createAnnouncement(actor, {
      title: 'Visible',
      content: 'Everyone can read this.',
      authorId: seeded.userId,
    });

    await publishAnnouncement(actor, announcement.id);

    const all = await listAnnouncements();

    expect(all.some(row => row.id === announcement.id)).toBe(true);
  });
});

describe('delivery safety', () => {
  let seeded: Seed;

  beforeEach(async () => {
    seeded = await seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
  });

  it('records a failed push attempt instead of claiming a delivery', async () => {
    const created = await createNotification({
      userId: seeded.userId,
      title: 'Push me',
      content: 'The provider is not configured.',
      eventType: 'new_drama',
    });

    const outcome = await deliverPush(created?.id ?? '');

    expect(outcome.delivered).toBe(0);

    const deliveries = await listDeliveries(created?.id ?? '');
    const pushDeliveries = deliveries.filter(row => row.channel === 'push');

    expect(pushDeliveries.length).toBeGreaterThanOrEqual(1);
    expect(pushDeliveries.every(row => row.success === false)).toBe(true);
  });

  it('does not claim a delivery when no channel could deliver', async () => {
    await updateNotificationPreferences(seeded.userId, {
      globalInApp: false,
      globalPush: false,
    });

    const created = await createNotification({
      userId: seeded.userId,
      title: 'Nobody hears this',
      content: 'Both channels are off.',
      eventType: 'new_drama',
    });

    await deliverPush(created?.id ?? '');

    const [row] = await db
      .select({ delivered: notifications.delivered })
      .from(notifications)
      .where(eq(notifications.id, created?.id ?? ''));

    expect(row?.delivered).toBe(false);
  });

  it('writes a delivery record with a real recipient', async () => {
    const created = await createNotification({
      userId: seeded.userId,
      title: 'In app',
      content: 'Delivered in the app.',
      eventType: 'new_drama',
    });

    const deliveries = await listDeliveries(created?.id ?? '');

    expect(deliveries.length).toBeGreaterThanOrEqual(1);

    const rows = await db
      .select({ userId: notification_deliveries.user_id })
      .from(notification_deliveries)
      .where(eq(notification_deliveries.notification_id, created?.id ?? ''));

    expect(rows.every(row => row.userId === seeded.userId)).toBe(true);
  });
});

afterAll(async () => {
  await closePool();
});
