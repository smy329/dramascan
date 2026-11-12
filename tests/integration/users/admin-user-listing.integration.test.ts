import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for the auth module's paged, filtered, sorted
 * user-account listing.
 *
 * These tests run against the real PostgreSQL test database and verify the
 * filter, search, pagination, and tie-breaking behavior of `listUserAccounts`.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for admin user listing integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { like } from 'drizzle-orm';

import { db } from '@/db/client';
import { listUserAccounts } from '@/modules/auth';
import { users } from '@/modules/auth/schema';
import { listUsersForAdmin } from '@/modules/users';
import { closePool } from '@/platform/db/pool';
import { AuthenticationError, AuthorizationError } from '@/platform/errors';

const TEST_EMAIL_PREFIX = 'it-users-';

async function insertUser(options: {
  name: string;
  email: string;
  isActive?: boolean;
  isSuperAdmin?: boolean;
  deletedAt?: Date | null;
  createdAt?: Date;
}): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      name: options.name,
      email: options.email,
      isActive: options.isActive ?? true,
      isSuperAdmin: options.isSuperAdmin ?? false,
      deletedAt: options.deletedAt ?? null,
      createdAt: options.createdAt ?? new Date(),
    })
    .returning({ id: users.id });

  if (!row) {
    throw new Error('Test user insert returned no row.');
  }

  return row.id;
}

async function cleanupTestUsers(): Promise<void> {
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
}

beforeEach(async () => {
  await cleanupTestUsers();
});

afterEach(async () => {
  await cleanupTestUsers();
});

afterAll(async () => {
  await cleanupTestUsers();
  await closePool();
});

describe('listUserAccounts (real database)', () => {
  it('returns only non-deleted accounts by default', async () => {
    const activeId = await insertUser({
      name: 'Active Person',
      email: `${TEST_EMAIL_PREFIX}active@example.com`,
    });
    const deletedId = await insertUser({
      name: 'Deleted Person',
      email: `${TEST_EMAIL_PREFIX}deleted@example.com`,
      deletedAt: new Date(),
    });

    const result = await listUserAccounts({
      page: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortDirection: 'desc',
      search: null,
      status: null,
      isSuperAdmin: null,
    });

    const ids = result.rows.map(row => row.id);
    expect(ids).toContain(activeId);
    expect(ids).not.toContain(deletedId);
  });

  it('includes soft-deleted accounts only for the deleted status', async () => {
    const deletedId = await insertUser({
      name: 'Deleted Person',
      email: `${TEST_EMAIL_PREFIX}deleted@example.com`,
      isActive: true,
      deletedAt: new Date(),
    });

    const deleted = await listUserAccounts({
      page: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortDirection: 'desc',
      search: null,
      status: 'deleted',
      isSuperAdmin: null,
    });

    expect(deleted.rows.map(row => row.id)).toContain(deletedId);
  });

  it('separates active from deactivated accounts', async () => {
    const deactivatedId = await insertUser({
      name: 'Inactive Person',
      email: `${TEST_EMAIL_PREFIX}inactive@example.com`,
      isActive: false,
    });

    const active = await listUserAccounts({
      page: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortDirection: 'desc',
      search: null,
      status: 'active',
      isSuperAdmin: null,
    });
    const deactivated = await listUserAccounts({
      page: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortDirection: 'desc',
      search: null,
      status: 'deactivated',
      isSuperAdmin: null,
    });

    expect(active.rows.map(row => row.id)).not.toContain(deactivatedId);
    expect(deactivated.rows.map(row => row.id)).toContain(deactivatedId);
  });

  it('matches the search term against the name or the email, case-insensitively', async () => {
    const byName = await insertUser({
      name: 'Zaphod Beeblebrox',
      email: `${TEST_EMAIL_PREFIX}by-name@example.com`,
    });
    const byEmail = await insertUser({
      name: 'Unrelated',
      email: `${TEST_EMAIL_PREFIX}hoopy@example.com`,
    });

    const result = await listUserAccounts({
      page: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortDirection: 'desc',
      search: 'ZAPHO',
      status: null,
      isSuperAdmin: null,
    });
    expect(result.rows.map(row => row.id)).toContain(byName);
    expect(result.rows.map(row => row.id)).not.toContain(byEmail);

    const byEmailResult = await listUserAccounts({
      page: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortDirection: 'desc',
      search: 'hoopy',
      status: null,
      isSuperAdmin: null,
    });
    expect(byEmailResult.rows.map(row => row.id)).toContain(byEmail);
  });

  it('treats a search wildcard as a literal character', async () => {
    const literal = await insertUser({
      name: '100% Person',
      email: `${TEST_EMAIL_PREFIX}literal@example.com`,
    });
    const other = await insertUser({
      name: '100X Person',
      email: `${TEST_EMAIL_PREFIX}other@example.com`,
    });

    const result = await listUserAccounts({
      page: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortDirection: 'desc',
      search: '100%',
      status: null,
      isSuperAdmin: null,
    });

    expect(result.rows.map(row => row.id)).toContain(literal);
    expect(result.rows.map(row => row.id)).not.toContain(other);
  });

  it('filters by the Super Admin flag', async () => {
    const superAdminId = await insertUser({
      name: 'Root Person',
      email: `${TEST_EMAIL_PREFIX}root@example.com`,
      isSuperAdmin: true,
    });

    const yes = await listUserAccounts({
      page: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortDirection: 'desc',
      search: null,
      status: null,
      isSuperAdmin: true,
    });
    const no = await listUserAccounts({
      page: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortDirection: 'desc',
      search: null,
      status: null,
      isSuperAdmin: false,
    });

    expect(yes.rows.map(row => row.id)).toContain(superAdminId);
    expect(no.rows.map(row => row.id)).not.toContain(superAdminId);
  });

  it('combines the status and Super Admin filters', async () => {
    const activeSuperAdmin = await insertUser({
      name: 'Active Root',
      email: `${TEST_EMAIL_PREFIX}active-root@example.com`,
      isSuperAdmin: true,
    });
    const deactivatedSuperAdmin = await insertUser({
      name: 'Retired Root',
      email: `${TEST_EMAIL_PREFIX}retired-root@example.com`,
      isSuperAdmin: true,
      isActive: false,
    });

    const result = await listUserAccounts({
      page: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortDirection: 'desc',
      search: null,
      status: 'active',
      isSuperAdmin: true,
    });
    const ids = result.rows.map(row => row.id);

    expect(ids).toContain(activeSuperAdmin);
    expect(ids).not.toContain(deactivatedSuperAdmin);
  });

  it('paginates with a stable total and never repeats a row across pages', async () => {
    for (let index = 0; index < 5; index += 1) {
      await insertUser({
        name: `Paged ${index}`,
        email: `${TEST_EMAIL_PREFIX}paged-${index}@example.com`,
      });
    }

    const first = await listUserAccounts({
      page: 1,
      pageSize: 2,
      sortBy: 'name',
      sortDirection: 'asc',
      search: null,
      status: null,
      isSuperAdmin: null,
    });
    const second = await listUserAccounts({
      page: 2,
      pageSize: 2,
      sortBy: 'name',
      sortDirection: 'asc',
      search: null,
      status: null,
      isSuperAdmin: null,
    });

    expect(first.rows).toHaveLength(2);
    expect(first.total).toBe(second.total);
    expect(first.rows.map(row => row.id)).not.toEqual(second.rows.map(row => row.id));
  });

  it('breaks sort ties with the row id so the order is total', async () => {
    const sameTime = new Date('2026-01-01T00:00:00.000Z');
    const first = await insertUser({
      name: 'Tied Person',
      email: `${TEST_EMAIL_PREFIX}tied-a@example.com`,
      createdAt: sameTime,
    });
    const second = await insertUser({
      name: 'Tied Person',
      email: `${TEST_EMAIL_PREFIX}tied-b@example.com`,
      createdAt: sameTime,
    });

    const ascending = await listUserAccounts({
      page: 1,
      pageSize: 100,
      sortBy: 'name',
      sortDirection: 'asc',
      search: null,
      status: null,
      isSuperAdmin: null,
    });
    const names = ascending.rows.filter(row => row.name === 'Tied Person').map(row => row.id);

    expect(names).toEqual([first, second].sort());
  });

  it('reports the total number of matching accounts, not the page size', async () => {
    await insertUser({ name: 'Counted One', email: `${TEST_EMAIL_PREFIX}counted-1@example.com` });
    await insertUser({ name: 'Counted Two', email: `${TEST_EMAIL_PREFIX}counted-2@example.com` });
    await insertUser({ name: 'Counted Three', email: `${TEST_EMAIL_PREFIX}counted-3@example.com` });

    const page = await listUserAccounts({
      page: 2,
      pageSize: 2,
      sortBy: 'name',
      sortDirection: 'asc',
      search: 'Counted',
      status: null,
      isSuperAdmin: null,
    });

    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(3);
  });
});

describe('listUsersForAdmin (real database)', () => {
  it('rejects an anonymous actor', async () => {
    await expect(
      listUsersForAdmin(
        { userId: null, roles: [], isSuperAdmin: false, permissions: [] },
        { page: 1, pageSize: 20, sortBy: 'createdAt', sortDirection: 'desc', search: '', status: null, superAdmin: null }
      )
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects an actor without user.read', async () => {
    await expect(
      listUsersForAdmin(
        { userId: 'u1', roles: [], isSuperAdmin: false, permissions: ['user.manage'] },
        { page: 1, pageSize: 20, sortBy: 'createdAt', sortDirection: 'desc', search: '', status: null, superAdmin: null }
      )
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('lists accounts for an actor with user.read', async () => {
    const id = await insertUser({ name: 'Listed Person', email: `${TEST_EMAIL_PREFIX}listed@example.com` });

    const result = await listUsersForAdmin(
      { userId: 'u2', roles: [], isSuperAdmin: false, permissions: ['user.read'] },
      { page: 1, pageSize: 100, sortBy: 'createdAt', sortDirection: 'desc', search: 'Listed Person', status: null, superAdmin: null }
    );

    expect(result.items.map(item => item.id)).toContain(id);
    expect(result.items[0]?.status).toBe('active');
  });
});
