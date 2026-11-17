import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for the administrator role and user workflows.
 *
 * These tests run against the real PostgreSQL test database. They exist because
 * the previous workflows returned `{ success: true }` without touching a table,
 * so a passing test proved nothing about roles, permissions, or account state.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for admin workflow integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import type { ActorContext } from '@/modules/authorization';
import { resolveEffectivePermissionsForUser } from '@/modules/authorization';
import { permissions, roles, userRoles } from '@/modules/authorization/schema';
import { closePool } from '@/platform/db/pool';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from '@/platform/errors';
import {
  createRoleForAdmin,
  deleteRoleForAdmin,
  listRolesForAdmin,
  setRolePermissionsForAdmin,
  updateRoleForAdmin,
} from '@/workflows/admin/roles';
import {
  assignUserRoleForAdmin,
  listUserRolesForAdmin,
  revokeUserRoleForAdmin,
  setUserAccountActiveForAdmin,
} from '@/workflows/admin/users';

const TEST_ROLE_PREFIX = 'it_wf_role_';
const TEST_USER_PREFIX = 'it-wf-user-';

const superAdmin: ActorContext = {
  userId: 'it-wf-super-admin',
  roles: [],
  isSuperAdmin: true,
  permissions: [],
};

const adminManager: ActorContext = {
  userId: 'it-wf-admin-manager',
  roles: [],
  isSuperAdmin: false,
  permissions: ['admin.manage'],
};

const userReader: ActorContext = {
  userId: 'it-wf-user-reader',
  roles: [],
  isSuperAdmin: false,
  permissions: ['user.read'],
};

const anonymous: ActorContext = {
  userId: null,
  roles: [],
  isSuperAdmin: false,
  permissions: [],
};

async function insertTestUser(options: {
  name: string;
  isActive?: boolean;
  isSuperAdmin?: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      name: options.name,
      email: `${TEST_USER_PREFIX}${randomUUID().replace(/-/g, '').slice(0, 12)}@example.com`,
      isActive: options.isActive ?? true,
      isSuperAdmin: options.isSuperAdmin ?? false,
    })
    .returning({ id: users.id });

  if (!row) {
    throw new Error('Test user insert returned no row.');
  }

  return row.id;
}

async function cleanup(): Promise<void> {
  const roleRows = await db
    .select({ id: roles.id })
    .from(roles)
    .where(like(roles.name, `${TEST_ROLE_PREFIX}%`));

  const roleIds = roleRows.map(row => row.id);

  if (roleIds.length > 0) {
    await db.delete(userRoles).where(inArray(userRoles.role_id, roleIds));
    await db.delete(permissions).where(inArray(permissions.role_id, roleIds));
    await db.delete(roles).where(inArray(roles.id, roleIds));
  }

  await db.delete(users).where(like(users.email, `${TEST_USER_PREFIX}%`));
}

function uniqueName(suffix: string): string {
  return `${TEST_ROLE_PREFIX}${suffix}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
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

describe('role workflows (real database)', () => {
  it('rejects an anonymous actor', async () => {
    await expect(listRolesForAdmin(anonymous)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects an actor that only holds admin.manage', async () => {
    await expect(listRolesForAdmin(adminManager)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('creates a role that is really stored', async () => {
    const created = await createRoleForAdmin(superAdmin, { name: uniqueName('created') });

    const stored = await db.select().from(roles).where(inArray(roles.id, [created.id]));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe(created.name);
  });

  it('renames a role', async () => {
    const created = await createRoleForAdmin(superAdmin, { name: uniqueName('before') });

    const updated = await updateRoleForAdmin(superAdmin, created.id, {
      name: uniqueName('after'),
    });

    expect(updated.name).not.toBe(created.name);
  });

  it('deletes a role', async () => {
    const created = await createRoleForAdmin(superAdmin, { name: uniqueName('deleted') });

    await deleteRoleForAdmin(superAdmin, created.id);

    expect(await db.select().from(roles).where(inArray(roles.id, [created.id]))).toHaveLength(0);
  });

  it('grants a permission that the assigned user really receives', async () => {
    const created = await createRoleForAdmin(superAdmin, { name: uniqueName('granted') });
    const userId = await insertTestUser({ name: 'Granted User' });

    await setRolePermissionsForAdmin(superAdmin, created.id, ['user.read']);
    await assignUserRoleForAdmin(superAdmin, userId, created.id);

    const effective = await resolveEffectivePermissionsForUser(userId);

    expect(effective.roles).toContain(created.name);
    expect(effective.permissions).toContain('user.read');
  });

  it('removes the effective permission when it is revoked', async () => {
    const created = await createRoleForAdmin(superAdmin, { name: uniqueName('revoked') });
    const userId = await insertTestUser({ name: 'Revoked User' });

    await setRolePermissionsForAdmin(superAdmin, created.id, ['user.read']);
    await assignUserRoleForAdmin(superAdmin, userId, created.id);
    await setRolePermissionsForAdmin(superAdmin, created.id, []);

    const effective = await resolveEffectivePermissionsForUser(userId);

    expect(effective.permissions).not.toContain('user.read');
  });
});

describe('user role workflows (real database)', () => {
  it('requires admin.manage to inspect the assignments', async () => {
    const userId = await insertTestUser({ name: 'Inspected User' });

    await expect(listUserRolesForAdmin(anonymous, userId)).rejects.toBeInstanceOf(
      AuthenticationError
    );
    await expect(listUserRolesForAdmin(userReader, userId)).rejects.toBeInstanceOf(
      AuthorizationError
    );

    await expect(listUserRolesForAdmin(adminManager, userId)).resolves.toEqual([]);
  });

  it('refuses to assign a role for an actor that is not a Super Admin', async () => {
    const created = await createRoleForAdmin(superAdmin, { name: uniqueName('assign') });
    const userId = await insertTestUser({ name: 'Assign Target' });

    await expect(assignUserRoleForAdmin(adminManager, userId, created.id)).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it('assigns and revokes a role', async () => {
    const created = await createRoleForAdmin(superAdmin, { name: uniqueName('assigned') });
    const userId = await insertTestUser({ name: 'Assignment Target' });

    const assigned = await assignUserRoleForAdmin(superAdmin, userId, created.id);
    expect(assigned.map(item => item.roleId)).toContain(created.id);

    const revoked = await revokeUserRoleForAdmin(superAdmin, userId, created.id);
    expect(revoked).toHaveLength(0);
  });
});

describe('account status workflow (real database)', () => {
  it('deactivates an ordinary account for an admin.manage holder', async () => {
    const userId = await insertTestUser({ name: 'Ordinary Target' });

    const updated = await setUserAccountActiveForAdmin(adminManager, userId, false);

    expect(updated.isActive).toBe(false);
  });

  it('refuses to change a Super Admin account for a non-Super-Admin', async () => {
    const userId = await insertTestUser({ name: 'Root Target', isSuperAdmin: true });

    await expect(
      setUserAccountActiveForAdmin(adminManager, userId, false)
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('refuses to deactivate the last active Super Admin', async () => {
    const userId = await insertTestUser({ name: 'Only Root', isSuperAdmin: true });

    await expect(
      setUserAccountActiveForAdmin(superAdmin, userId, false)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('deactivates a Super Admin account for a Super Admin', async () => {
    const first = await insertTestUser({ name: 'Root One', isSuperAdmin: true });
    const second = await insertTestUser({ name: 'Root Two', isSuperAdmin: true });
    const third = await insertTestUser({ name: 'Root Three', isSuperAdmin: true });

    const updated = await setUserAccountActiveForAdmin(superAdmin, first, false);

    expect(updated.isActive).toBe(false);
    expect((await setUserAccountActiveForAdmin(superAdmin, second, false)).isActive).toBe(false);

    // The third root is now the last one, so it can no longer be deactivated.
    await expect(
      setUserAccountActiveForAdmin(superAdmin, third, false)
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('reports an unknown account as not found', async () => {
    await expect(
      setUserAccountActiveForAdmin(superAdmin, randomUUID(), false)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an anonymous actor', async () => {
    const userId = await insertTestUser({ name: 'Anonymous Target' });

    await expect(
      setUserAccountActiveForAdmin(anonymous, userId, false)
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});
