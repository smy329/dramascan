import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Administrator notification centre integration coverage (D-067).
 *
 * The centre has two obligations, and both are enforced on the server:
 *
 *   - An alert is visible only to the administrators its audience addresses.
 *   - Read state is per administrator, not per alert.
 *
 * The suite runs against the real PostgreSQL test database.
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

import { inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  admin_notification_reads,
  admin_notifications,
} from '@/modules/notifications/schema';
import {
  countUnreadAdminNotifications,
  createAdminNotification,
  getAdminNotification,
  listAdminNotifications,
  setAdminNotificationRead,
  type AdminNotificationViewer,
} from '@/modules/notifications';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-admin-centre-';

/** A role name that no other test uses, so the test sees only its own alerts. */
const ROLE = `${TEST_PREFIX}${randomUUID().slice(0, 8)}`;

const moderator: AdminNotificationViewer = {
  userId: randomUUID(),
  roles: [ROLE],
  isSuperAdmin: false,
  canViewAlerts: true,
};

const otherModerator: AdminNotificationViewer = {
  userId: randomUUID(),
  roles: [ROLE],
  isSuperAdmin: false,
  canViewAlerts: true,
};

const superAdmin: AdminNotificationViewer = {
  userId: randomUUID(),
  roles: ['super_admin'],
  isSuperAdmin: true,
  canViewAlerts: true,
};

const deniedViewer: AdminNotificationViewer = {
  userId: randomUUID(),
  roles: [ROLE],
  isSuperAdmin: true,
  canViewAlerts: false,
};

let createdIds: string[] = [];

async function createAlert(
  input: {
    title: string;
    audience?: 'all' | 'super_admin' | 'roles';
    category?: 'security' | 'content' | 'system' | 'maintenance';
  }
): Promise<string> {
  const created = await createAdminNotification({
    title: `${TEST_PREFIX}${input.title}`,
    content: `${TEST_PREFIX}${input.title} content.`,
    audience: input.audience ?? 'roles',
    audienceRoles: input.audience === undefined || input.audience === 'roles' ? [ROLE] : [],
    category: input.category ?? 'system',
  });

  createdIds.push(created.id);

  return created.id;
}

describe('admin notification centre', () => {
  afterEach(async () => {
    if (createdIds.length > 0) {
      await db
        .delete(admin_notification_reads)
        .where(inArray(admin_notification_reads.notification_id, createdIds));
      await db.delete(admin_notifications).where(inArray(admin_notifications.id, createdIds));
    }

    createdIds = [];
  });

  it('shows an alert only to the audience it addresses', async () => {
    const allId = await createAlert({ title: 'All', audience: 'all' });
    const superAdminId = await createAlert({ title: 'Super', audience: 'super_admin' });
    const roleId = await createAlert({ title: 'Role', audience: 'roles' });

    const moderatorIds = (await listAdminNotifications(moderator)).items.map(item => item.id);
    const superAdminIds = (await listAdminNotifications(superAdmin)).items.map(item => item.id);
    const deniedIds = (await listAdminNotifications(deniedViewer)).items.map(item => item.id);

    expect(moderatorIds).toContain(allId);
    expect(moderatorIds).toContain(roleId);
    expect(moderatorIds).not.toContain(superAdminId);

    expect(superAdminIds).toContain(allId);
    expect(superAdminIds).toContain(superAdminId);
    expect(superAdminIds).not.toContain(roleId);

    expect(deniedIds).toHaveLength(0);
  });

  it('returns nothing for an alert outside the viewer’s audience', async () => {
    const superAdminId = await createAlert({ title: 'Super only', audience: 'super_admin' });

    expect(await getAdminNotification(moderator, superAdminId)).toBeNull();
    expect(await getAdminNotification(superAdmin, superAdminId)).not.toBeNull();
    expect(await getAdminNotification(deniedViewer, superAdminId)).toBeNull();
  });

  it('refuses to mark an invisible alert read', async () => {
    const superAdminId = await createAlert({ title: 'Not yours', audience: 'super_admin' });

    const marked = await setAdminNotificationRead(moderator, superAdminId, true);

    expect(marked).toBe(false);

    const reads = await db
      .select({ id: admin_notification_reads.id })
      .from(admin_notification_reads)
      .where(inArray(admin_notification_reads.notification_id, [superAdminId]));

    expect(reads).toHaveLength(0);
  });

  it('keeps read state per administrator', async () => {
    const alertId = await createAlert({ title: 'Shared alert' });

    expect(await countUnreadAdminNotifications(moderator)).toBe(1);

    const marked = await setAdminNotificationRead(moderator, alertId, true);

    expect(marked).toBe(true);
    expect((await getAdminNotification(moderator, alertId))?.readAt).not.toBeNull();
    expect(await countUnreadAdminNotifications(moderator)).toBe(0);

    // The other holder of the same role has not opened it.
    expect((await getAdminNotification(otherModerator, alertId))?.readAt).toBeNull();
    expect(await countUnreadAdminNotifications(otherModerator)).toBe(1);

    // Marking it unread removes only this administrator's read state.
    expect(await setAdminNotificationRead(moderator, alertId, false)).toBe(true);
    expect((await getAdminNotification(moderator, alertId))?.readAt).toBeNull();
    expect(await countUnreadAdminNotifications(moderator)).toBe(1);
  });

  it('filters by category and paginates the visible alerts', async () => {
    const contentId = await createAlert({ title: 'Content', category: 'content' });
    await createAlert({ title: 'System', category: 'system' });
    await createAlert({ title: 'Security', category: 'security' });

    const content = await listAdminNotifications(moderator, { category: 'content' });

    expect(content.items.map(item => item.id)).toEqual([contentId]);
    expect(content.total).toBe(1);

    const firstPage = await listAdminNotifications(moderator, { page: 1, pageSize: 2 });
    const secondPage = await listAdminNotifications(moderator, { page: 2, pageSize: 2 });

    expect(firstPage.total).toBe(3);
    expect(firstPage.items).toHaveLength(2);
    expect(secondPage.items).toHaveLength(1);
    expect(new Set([...firstPage.items, ...secondPage.items].map(item => item.id)).size).toBe(3);
  });
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await db
      .delete(admin_notification_reads)
      .where(inArray(admin_notification_reads.notification_id, createdIds));
    await db.delete(admin_notifications).where(inArray(admin_notifications.id, createdIds));
  }

  await closePool();
});
