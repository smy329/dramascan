import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for the auth module's account-status operations.
 *
 * These tests run against the real PostgreSQL test database. They exist because
 * the last-active-Super-Admin invariant is a concurrency invariant: it has to
 * hold when two administrators deactivate accounts at the same time, not only
 * when they do it one after the other.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for account status integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { and, eq, like, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { getUserAccount, setUserAccountActive } from '@/modules/auth';
import { users } from '@/modules/auth/schema';
import { closePool } from '@/platform/db/pool';
import { ConflictError, NotFoundError } from '@/platform/errors';

const TEST_USER_PREFIX = 'r5t5-account-';

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
  await db.delete(users).where(like(users.email, `${TEST_USER_PREFIX}%`));
}

async function countActiveSuperAdmins(): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.isSuperAdmin, true),
        eq(users.isActive, true),
        like(users.email, `${TEST_USER_PREFIX}%`)
      )
    );

  return rows.length;
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

describe('getUserAccount (real database)', () => {
  it('returns the stored account', async () => {
    const id = await insertTestUser({ name: 'Readable User', isSuperAdmin: true });

    const account = await getUserAccount(id);

    expect(account?.id).toBe(id);
    expect(account?.name).toBe('Readable User');
    expect(account?.isSuperAdmin).toBe(true);
    expect(account?.isActive).toBe(true);
  });

  it('returns null for an unknown id', async () => {
    await expect(getUserAccount(randomUUID())).resolves.toBeNull();
  });
});

describe('setUserAccountActive (real database)', () => {
  it('deactivates an account and preserves its other columns', async () => {
    const id = await insertTestUser({ name: 'Deactivated User' });

    const result = await setUserAccountActive(id, false);

    expect(result.account.isActive).toBe(false);
    expect(result.account.name).toBe('Deactivated User');
    expect(result.changed).toBe(true);

    const stored = await getUserAccount(id);
    expect(stored?.isActive).toBe(false);
    expect(stored?.deletedAt).toBeNull();
  });

  it('reactivates a deactivated account', async () => {
    const id = await insertTestUser({ name: 'Reactivated User', isActive: false });

    const result = await setUserAccountActive(id, true);

    expect(result.account.isActive).toBe(true);
    expect(result.changed).toBe(true);
    expect((await getUserAccount(id))?.isActive).toBe(true);
  });

  it('reports an unknown account as not found', async () => {
    await expect(setUserAccountActive(randomUUID(), false)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('accepts a status that is already set', async () => {
    const id = await insertTestUser({ name: 'Already Active User' });

    await expect(setUserAccountActive(id, true)).resolves.toMatchObject({
      account: { isActive: true },
      changed: false,
    });
  });

  it('reports whether the account status changed', async () => {
    const id = await insertTestUser({ name: 'Reported Status User' });

    const unchanged = await setUserAccountActive(id, true);
    const changed = await setUserAccountActive(id, false);

    expect(unchanged.changed).toBe(false);
    expect(changed.changed).toBe(true);
  });

  it('refuses to deactivate the last active Super Admin', async () => {
    const id = await insertTestUser({ name: 'Only Super Admin', isSuperAdmin: true });

    await expect(setUserAccountActive(id, false)).rejects.toBeInstanceOf(ConflictError);
    expect((await getUserAccount(id))?.isActive).toBe(true);
  });

  it('deactivates one of two active Super Admins', async () => {
    const first = await insertTestUser({ name: 'First Super Admin', isSuperAdmin: true });
    const second = await insertTestUser({ name: 'Second Super Admin', isSuperAdmin: true });

    await expect(setUserAccountActive(first, false)).resolves.toMatchObject({
      account: { isActive: false },
      changed: true,
    });
    expect((await getUserAccount(second))?.isActive).toBe(true);
  });

  it('deactivates an ordinary account even when it is the only active user', async () => {
    const id = await insertTestUser({ name: 'Ordinary User' });

    await expect(setUserAccountActive(id, false)).resolves.toMatchObject({
      account: { isActive: false },
      changed: true,
    });
  });

  it('keeps one Super Admin active when two deactivations race', async () => {
    const first = await insertTestUser({ name: 'Racing Super Admin One', isSuperAdmin: true });
    const second = await insertTestUser({ name: 'Racing Super Admin Two', isSuperAdmin: true });

    // The race is made deterministic instead of left to chance. The holder
    // transaction locks every active Super Admin row and keeps them locked, so
    // both deactivation transactions have to wait for those rows before they
    // can decide. Without the lock the implementation takes, both transactions
    // would read "two Super Admins" and both would deactivate one, leaving the
    // platform with none.
    let releaseHolder: () => void = () => {};
    const holderReleased = new Promise<void>(resolve => {
      releaseHolder = resolve;
    });

    const holder = db.transaction(async tx => {
      await tx.execute(sql`
        SELECT id FROM users
        WHERE is_super_admin = true AND is_active = true AND deleted_at IS NULL
        ORDER BY id
        FOR UPDATE
      `);
      await holderReleased;
    });

    const deactivations = Promise.allSettled([
      setUserAccountActive(first, false),
      setUserAccountActive(second, false),
    ]);

    // Give both transactions time to reach their Super Admin read and block on
    // the held rows before the lock is released.
    await new Promise(resolve => setTimeout(resolve, 250));

    releaseHolder();
    await holder;

    const results = await deactivations;
    const fulfilled = results.filter(result => result.status === 'fulfilled');
    const rejected = results.filter(result => result.status === 'rejected');

    // Exactly one deactivation may succeed: the other would leave the platform
    // without any Super Admin.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(await countActiveSuperAdmins()).toBe(1);
  });
});
