import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration tests for the database-backed authentication hooks.
 *
 * Unit tests cover the decisions with an in-memory store. These tests exercise
 * the real SQL: the migrated PostgreSQL schema, the UUIDv7 defaults, the
 * transaction-scoped advisory lock, and the UPDATE that promotes a user.
 *
 * They require the isolated `_test` database created by `tests/global-setup.ts`
 * and never touch the development database.
 */

const TEST_EMAIL_PREFIX = 'it-auth-';
const CONFIGURED_EMAIL = `${TEST_EMAIL_PREFIX}bootstrap@example.com`;

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for authentication integration tests.');
  }

  // The application reads DATABASE_URL; point it at the isolated test database.
  // TEST_DATABASE_URL is then removed because the configuration layer rejects
  // a test URL that is identical to DATABASE_URL.
  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
  process.env.BETTER_AUTH_SECRET = 'integration-test-secret-with-32-or-more-characters';
  process.env.SUPER_ADMIN_EMAIL = 'it-auth-bootstrap@example.com';
});

vi.mock('server-only', () => ({}));

import { eq, ilike } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { assertUserCanCreateSession, bootstrapSuperAdminForUser } from '@/platform/auth/auth-hooks';
import { closePool } from '@/platform/db/pool';

type NewUser = {
  email: string;
  isActive?: boolean;
  isSuperAdmin?: boolean;
  deletedAt?: Date | null;
};

async function insertUser({
  email,
  isActive = true,
  isSuperAdmin = false,
  deletedAt = null,
}: NewUser): Promise<{ id: string; email: string }> {
  const [row] = await db
    .insert(users)
    .values({ name: 'Integration Test User', email, isActive, isSuperAdmin, deletedAt })
    .returning({ id: users.id, email: users.email });

  if (!row) {
    throw new Error('Failed to insert the test user.');
  }

  return row;
}

async function isSuperAdmin(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ isSuperAdmin: users.isSuperAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row?.isSuperAdmin ?? false;
}

beforeEach(async () => {
  // Each test starts from the "no Super Admin exists" baseline. `ilike`
  // matches the case-insensitivity test, which stores an upper-case email.
  await db.delete(users).where(ilike(users.email, `${TEST_EMAIL_PREFIX}%`));
});

afterAll(async () => {
  await db.delete(users).where(ilike(users.email, `${TEST_EMAIL_PREFIX}%`));
  await closePool();
});

describe('assertUserCanCreateSession (real database)', () => {
  it('allows an active user', async () => {
    const user = await insertUser({ email: `${TEST_EMAIL_PREFIX}active@example.com` });

    await expect(assertUserCanCreateSession(user.id)).resolves.toBeUndefined();
  });

  it('rejects a deactivated user', async () => {
    const user = await insertUser({
      email: `${TEST_EMAIL_PREFIX}inactive@example.com`,
      isActive: false,
    });

    await expect(assertUserCanCreateSession(user.id)).rejects.toMatchObject({
      status: 'FORBIDDEN',
      body: { code: 'ACCOUNT_NOT_ACTIVE' },
    });
  });

  it('rejects a soft-deleted user', async () => {
    const user = await insertUser({
      email: `${TEST_EMAIL_PREFIX}deleted@example.com`,
      deletedAt: new Date(),
    });

    await expect(assertUserCanCreateSession(user.id)).rejects.toMatchObject({
      status: 'FORBIDDEN',
      body: { code: 'ACCOUNT_NOT_ACTIVE' },
    });
  });

  it('rejects an unknown user id', async () => {
    await expect(
      assertUserCanCreateSession('00000000-0000-7000-8000-000000000000')
    ).rejects.toMatchObject({
      status: 'FORBIDDEN',
      body: { code: 'ACCOUNT_NOT_ACTIVE' },
    });
  });
});

describe('bootstrapSuperAdminForUser (real database)', () => {
  it('promotes the configured email once and is idempotent afterwards', async () => {
    const user = await insertUser({ email: CONFIGURED_EMAIL });

    await expect(bootstrapSuperAdminForUser(user.id)).resolves.toEqual({
      promoted: true,
      reason: 'promoted',
    });
    await expect(isSuperAdmin(user.id)).resolves.toBe(true);

    await expect(bootstrapSuperAdminForUser(user.id)).resolves.toEqual({
      promoted: false,
      reason: 'already-super-admin',
    });
  });

  it('matches the configured email case-insensitively', async () => {
    const user = await insertUser({ email: 'IT-AUTH-BOOTSTRAP@Example.COM' });

    await expect(bootstrapSuperAdminForUser(user.id)).resolves.toEqual({
      promoted: true,
      reason: 'promoted',
    });
  });

  it('never promotes a user with a different email', async () => {
    const user = await insertUser({ email: `${TEST_EMAIL_PREFIX}viewer@example.com` });

    await expect(bootstrapSuperAdminForUser(user.id)).resolves.toEqual({
      promoted: false,
      reason: 'email-mismatch',
    });
    await expect(isSuperAdmin(user.id)).resolves.toBe(false);
  });

  it('never promotes when a Super Admin already exists', async () => {
    await insertUser({
      email: `${TEST_EMAIL_PREFIX}existing-admin@example.com`,
      isSuperAdmin: true,
    });
    const candidate = await insertUser({ email: CONFIGURED_EMAIL });

    await expect(bootstrapSuperAdminForUser(candidate.id)).resolves.toEqual({
      promoted: false,
      reason: 'super-admin-exists',
    });
    await expect(isSuperAdmin(candidate.id)).resolves.toBe(false);
  });

  it('promotes at most one user when concurrent sign-ins race', async () => {
    const configured = await insertUser({ email: CONFIGURED_EMAIL });
    const other = await insertUser({ email: `${TEST_EMAIL_PREFIX}other@example.com` });

    const results = await Promise.all([
      bootstrapSuperAdminForUser(configured.id),
      bootstrapSuperAdminForUser(other.id),
      bootstrapSuperAdminForUser(configured.id),
    ]);

    expect(results.filter(result => result.promoted)).toHaveLength(1);
    await expect(isSuperAdmin(configured.id)).resolves.toBe(true);
    await expect(isSuperAdmin(other.id)).resolves.toBe(false);
  });
});
