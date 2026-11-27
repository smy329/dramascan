import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for the authorization module's role, permission, and
 * user-role persistence.
 *
 * These tests run against the real PostgreSQL test database. They exist because
 * the previous implementation returned fabricated identifiers and empty
 * permission lists, so no test could tell a real grant from a placeholder.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for role integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import {
  assignUserRole,
  createRole,
  deleteRole,
  getRole,
  listRoleAssignmentsForUsers,
  listRoles,
  listUserRoleAssignments,
  revokeUserRole,
  setRolePermissions,
  updateRole,
} from '@/modules/authorization';
import type { ActorContext } from '@/modules/authorization';
import { permissions, roles, userRoles } from '@/modules/authorization/schema';
import { closePool } from '@/platform/db/pool';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/platform/errors';

const TEST_ROLE_PREFIX = 'r5t5_role_';
const TEST_USER_PREFIX = 'r5t5-role-';

const superAdmin: ActorContext = {
  userId: 'it-role-super-admin',
  roles: [],
  isSuperAdmin: true,
  permissions: [],
};

const adminManager: ActorContext = {
  userId: 'it-role-admin-manager',
  roles: [],
  isSuperAdmin: false,
  permissions: ['admin.manage'],
};

const userReader: ActorContext = {
  userId: 'it-role-user-reader',
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

async function insertTestUser(name: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      name,
      email: `${TEST_USER_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
      isActive: true,
      isSuperAdmin: false,
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

describe('listRoles (real database)', () => {
  it('rejects an anonymous actor', async () => {
    await expect(listRoles(anonymous)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects an actor that only holds admin.manage', async () => {
    await expect(listRoles(adminManager)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('returns each role with its own permission rows', async () => {
    const first = await createRole(superAdmin, { name: uniqueName('first') });
    const second = await createRole(superAdmin, { name: uniqueName('second') });

    await setRolePermissions(superAdmin, first.id, ['drama.read']);
    await setRolePermissions(superAdmin, second.id, ['episode.read', 'movie.read']);

    const listed = await listRoles(superAdmin);

    const firstListed = listed.find(role => role.id === first.id);
    const secondListed = listed.find(role => role.id === second.id);

    expect(firstListed?.grantedPermissionKeys).toEqual(['drama.read']);
    expect(secondListed?.grantedPermissionKeys).toEqual(['episode.read', 'movie.read']);
  });

  it('counts the users assigned to each role', async () => {
    const role = await createRole(superAdmin, { name: uniqueName('counted') });
    const userId = await insertTestUser('Counted User');

    await assignUserRole(superAdmin, userId, role.id);

    const listed = await listRoles(superAdmin);
    expect(listed.find(item => item.id === role.id)?.userCount).toBe(1);
  });
});

describe('createRole (real database)', () => {
  it('persists the role with no permissions', async () => {
    const created = await createRole(superAdmin, {
      name: uniqueName('created'),
      description: 'Created by the integration suite.',
    });

    const stored = await db.select().from(roles).where(eq(roles.id, created.id)).limit(1);

    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe(created.name);
    expect(stored[0]?.description).toBe('Created by the integration suite.');
    expect(created.grantedPermissionKeys).toEqual([]);
    expect(created.userCount).toBe(0);
  });

  it('refuses a duplicate role name', async () => {
    const name = uniqueName('duplicate');

    await createRole(superAdmin, { name });

    await expect(createRole(superAdmin, { name })).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a name that is not lowercase snake_case', async () => {
    await expect(createRole(superAdmin, { name: 'Not A Valid Name' })).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('refuses the reserved super_admin name', async () => {
    await expect(createRole(superAdmin, { name: 'super_admin' })).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('rejects an actor that is not a Super Admin', async () => {
    await expect(
      createRole(adminManager, { name: uniqueName('forbidden') })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('updateRole (real database)', () => {
  it('renames the role and updates its description', async () => {
    const created = await createRole(superAdmin, { name: uniqueName('before') });

    const updated = await updateRole(superAdmin, created.id, {
      name: uniqueName('after'),
      description: 'Renamed by the integration suite.',
    });

    expect(updated.id).toBe(created.id);
    expect(updated.name).not.toBe(created.name);
    expect(updated.description).toBe('Renamed by the integration suite.');

    const stored = await db.select().from(roles).where(eq(roles.id, created.id)).limit(1);
    expect(stored[0]?.name).toBe(updated.name);
  });

  it('reports an unknown role as not found', async () => {
    await expect(
      updateRole(superAdmin, randomUUID(), { name: uniqueName('missing') })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a name already used by another role', async () => {
    const first = await createRole(superAdmin, { name: uniqueName('taken') });
    const second = await createRole(superAdmin, { name: uniqueName('other') });

    await expect(updateRole(superAdmin, second.id, { name: first.name })).rejects.toBeInstanceOf(
      ConflictError
    );
  });
});

describe('deleteRole (real database)', () => {
  it('removes the role and its permission rows', async () => {
    const created = await createRole(superAdmin, { name: uniqueName('deleted') });
    await setRolePermissions(superAdmin, created.id, ['drama.read']);

    await deleteRole(superAdmin, created.id);

    expect(await db.select().from(roles).where(eq(roles.id, created.id))).toHaveLength(0);
    expect(
      await db.select().from(permissions).where(eq(permissions.role_id, created.id))
    ).toHaveLength(0);
  });

  it('refuses to delete a role that is still assigned to a user', async () => {
    const created = await createRole(superAdmin, { name: uniqueName('assigned') });
    const userId = await insertTestUser('Assigned User');

    await assignUserRole(superAdmin, userId, created.id);

    await expect(deleteRole(superAdmin, created.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.select().from(roles).where(eq(roles.id, created.id))).toHaveLength(1);
  });

  it('reports an unknown role as not found', async () => {
    await expect(deleteRole(superAdmin, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('setRolePermissions (real database)', () => {
  it('grants the requested permissions', async () => {
    const created = await createRole(superAdmin, { name: uniqueName('granted') });

    const updated = await setRolePermissions(superAdmin, created.id, [
      'drama.read',
      'episode.read',
    ]);

    expect(updated.grantedPermissionKeys).toEqual(['drama.read', 'episode.read']);
  });

  it('records a revoked permission as not granted instead of deleting the row', async () => {
    const created = await createRole(superAdmin, { name: uniqueName('revoked') });

    await setRolePermissions(superAdmin, created.id, ['drama.read', 'episode.read']);
    const updated = await setRolePermissions(superAdmin, created.id, ['drama.read']);

    expect(updated.grantedPermissionKeys).toEqual(['drama.read']);

    const stored = await db.select().from(permissions).where(eq(permissions.role_id, created.id));

    expect(stored).toHaveLength(2);
    expect(stored.filter(row => row.granted)).toHaveLength(1);
  });

  it('reports an unknown role as not found', async () => {
    await expect(
      setRolePermissions(superAdmin, randomUUID(), ['drama.read'])
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a permission key that is not in the catalog', async () => {
    const created = await createRole(superAdmin, { name: uniqueName('unknown_key') });

    await expect(
      setRolePermissions(superAdmin, created.id, [
        'not-a-real.permission' as unknown as 'drama.read',
      ])
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('holds the role row before touching its permissions, so replacements cannot interleave', async () => {
    const created = await createRole(superAdmin, { name: uniqueName('locked') });

    await setRolePermissions(superAdmin, created.id, ['drama.read']);

    // A competing administrator holds the role row. A full replacement must
    // wait for that row before it reads or writes the permission set: reading
    // first is what lets two replacements merge into a union instead of one
    // replacing the other.
    //
    // The replacement below only revokes, so it inserts no permission row and
    // the foreign key on `role_id` cannot block it. The only thing that can
    // hold it back is the role row lock taken by the service itself.
    let releaseLock: () => void = () => {};
    const holdLock = new Promise<void>(resolve => {
      releaseLock = resolve;
    });
    let markAcquired: () => void = () => {};
    const lockAcquired = new Promise<void>(resolve => {
      markAcquired = resolve;
    });

    const lockTransaction = db.transaction(async tx => {
      await tx.select({ id: roles.id }).from(roles).where(eq(roles.id, created.id)).for('update');

      markAcquired();
      await holdLock;
    });

    await lockAcquired;

    const replacement = setRolePermissions(superAdmin, created.id, []);
    replacement.catch(() => undefined);

    const outcome = await Promise.race([
      replacement.then(() => 'settled' as const),
      new Promise<'blocked'>(resolve => {
        setTimeout(() => resolve('blocked'), 250);
      }),
    ]);

    releaseLock();
    await lockTransaction;

    expect(outcome).toBe('blocked');

    const updated = await replacement;
    expect(updated.grantedPermissionKeys).toEqual([]);

    const stored = await db.select().from(permissions).where(eq(permissions.role_id, created.id));

    expect(stored.filter(row => row.granted)).toHaveLength(0);
  }, 20000);
});

describe('user role assignments (real database)', () => {
  it('assigns a role and reports it', async () => {
    const created = await createRole(superAdmin, { name: uniqueName('assigned') });
    const userId = await insertTestUser('Assignee');

    const result = await assignUserRole(superAdmin, userId, created.id);

    expect(result.assignments.map(item => item.roleId)).toContain(created.id);
    expect(result.assignments[0]?.roleName).toBe(created.name);
    expect(result.changed).toBe(true);
  });

  it('is idempotent when the same role is assigned twice', async () => {
    const created = await createRole(superAdmin, { name: uniqueName('twice') });
    const userId = await insertTestUser('Twice User');

    await assignUserRole(superAdmin, userId, created.id);
    const result = await assignUserRole(superAdmin, userId, created.id);

    expect(result.assignments).toHaveLength(1);
    expect(result.changed).toBe(false);
  });

  it('reports whether a role assignment changed', async () => {
    const created = await createRole(superAdmin, { name: uniqueName('reported') });
    const userId = await insertTestUser('Reported Assignment User');

    const first = await assignUserRole(superAdmin, userId, created.id);
    const repeated = await assignUserRole(superAdmin, userId, created.id);

    expect(first.changed).toBe(true);
    expect(repeated.changed).toBe(false);
  });

  it('reports an unknown role as not found', async () => {
    const userId = await insertTestUser('No Role User');

    await expect(assignUserRole(superAdmin, userId, randomUUID())).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it('reports an unknown user as not found', async () => {
    const created = await createRole(superAdmin, { name: uniqueName('no_user') });

    await expect(assignUserRole(superAdmin, randomUUID(), created.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it('revokes an assignment', async () => {
    const created = await createRole(superAdmin, { name: uniqueName('revoked') });
    const userId = await insertTestUser('Revoke User');

    await assignUserRole(superAdmin, userId, created.id);
    const result = await revokeUserRole(superAdmin, userId, created.id);

    expect(result.assignments).toHaveLength(0);
    expect(result.changed).toBe(true);
  });

  it('reports a missing assignment as not found', async () => {
    const created = await createRole(superAdmin, { name: uniqueName('never_assigned') });
    const userId = await insertTestUser('Never Assigned User');

    await expect(revokeUserRole(superAdmin, userId, created.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it('requires admin.manage to inspect a single user assignment', async () => {
    const userId = await insertTestUser('Inspected User');

    await expect(listUserRoleAssignments(anonymous, userId)).rejects.toBeInstanceOf(
      AuthenticationError
    );
    await expect(listUserRoleAssignments(userReader, userId)).rejects.toBeInstanceOf(
      AuthorizationError
    );

    await expect(listUserRoleAssignments(adminManager, userId)).resolves.toEqual([]);
  });

  it('requires user.read to read assignments for the admin listing', async () => {
    const created = await createRole(superAdmin, { name: uniqueName('bulk') });
    const userId = await insertTestUser('Bulk User');

    await assignUserRole(superAdmin, userId, created.id);

    await expect(listRoleAssignmentsForUsers(anonymous, [userId])).rejects.toBeInstanceOf(
      AuthenticationError
    );
    await expect(listRoleAssignmentsForUsers(userReader, [userId])).resolves.toEqual({
      [userId]: [expect.objectContaining({ roleId: created.id })],
    });
  });
});

describe('getRole (real database)', () => {
  it('returns the stored role', async () => {
    const created = await createRole(superAdmin, { name: uniqueName('read') });

    const loaded = await getRole(superAdmin, created.id);

    expect(loaded.id).toBe(created.id);
    expect(loaded.name).toBe(created.name);
  });

  it('reports an unknown role as not found', async () => {
    await expect(getRole(superAdmin, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });
});
