import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Account and security notification coverage (Prompt 154, requirements §11.4).
 *
 * The rules this suite pins down:
 *
 *   - Deactivating and reactivating an account tells the account's owner.
 *   - A role change tells the account's owner.
 *   - The notification is mandatory: no preference switch withholds it.
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

import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { notifications } from '@/modules/notifications/schema';
import { roles, userRoles } from '@/modules/authorization/schema';
import { updateNotificationPreferences } from '@/modules/notifications';
import { userActor } from '@/modules/authorization/actors';
import {
  assignUserRoleForAdmin,
  setUserAccountActiveForAdmin,
} from '@/workflows/admin/users';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-account-security-';

type Seed = {
  adminId: string;
  targetId: string;
  roleId: string;
};

async function seed(): Promise<Seed> {
  const adminId = randomUUID();
  const targetId = randomUUID();
  const roleId = randomUUID();

  await db.insert(users).values([
    {
      id: adminId,
      name: 'Security admin',
      email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
    },
    {
      id: targetId,
      name: 'Security target',
      email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
    },
  ]);

  await db.insert(roles).values({
    id: roleId,
    name: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
    description: 'A role created by the account-security integration suite.',
  });

  return { adminId, targetId, roleId };
}

async function cleanup(seeded: Seed): Promise<void> {
  await db
    .delete(notifications)
    .where(inArray(notifications.user_id, [seeded.adminId, seeded.targetId]));
  await db.delete(userRoles).where(eq(userRoles.user_id, seeded.targetId));
  await db.delete(userRoles).where(eq(userRoles.user_id, seeded.adminId));
  await db.delete(roles).where(eq(roles.id, seeded.roleId));
  await db.delete(users).where(inArray(users.id, [seeded.adminId, seeded.targetId]));
}

async function listSecurityNotifications(userId: string): Promise<
  Array<{ title: string; content: string }>
> {
  const rows = await db
    .select({ title: notifications.title, content: notifications.content })
    .from(notifications)
    .where(
      and(
        eq(notifications.user_id, userId),
        eq(notifications.event_type, 'account_security'),
        isNull(notifications.deleted_at)
      )
    );

  return rows;
}

describe('account and security notifications', () => {
  let seeded: Seed;

  beforeEach(async () => {
    seeded = await seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
  });

  it('tells the account owner when the account is deactivated', async () => {
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    await setUserAccountActiveForAdmin(actor, seeded.targetId, false);

    const rows = await listSecurityNotifications(seeded.targetId);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toContain('deactivated');
  });

  it('tells the account owner when the account is reactivated', async () => {
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    await setUserAccountActiveForAdmin(actor, seeded.targetId, false);
    await setUserAccountActiveForAdmin(actor, seeded.targetId, true);

    const rows = await listSecurityNotifications(seeded.targetId);

    expect(rows).toHaveLength(2);
    expect(rows.some(row => row.title.includes('reactivated'))).toBe(true);
  });

  it('tells the account owner when a role is assigned', async () => {
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    await assignUserRoleForAdmin(actor, seeded.targetId, seeded.roleId);

    const rows = await listSecurityNotifications(seeded.targetId);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toContain('role');
  });

  it('delivers the security notification even when every switch is off', async () => {
    await updateNotificationPreferences(seeded.targetId, {
      globalInApp: false,
      globalPush: false,
    });

    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    await setUserAccountActiveForAdmin(actor, seeded.targetId, false);

    const rows = await listSecurityNotifications(seeded.targetId);

    expect(rows).toHaveLength(1);
  });
});

afterAll(async () => {
  await closePool();
});
