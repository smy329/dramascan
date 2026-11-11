import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration tests for login monitoring.
 *
 * These exercise the real PostgreSQL schema that Prompt 041 relies on:
 * the `login_attempts` table, its indexes, the `count(*)`/`count(distinct)`
 * aggregates, and the user-status lookup used for Google security changes.
 *
 * They run against the isolated `_test` database created by
 * `tests/global-setup.ts` and never touch the development database.
 */

const TEST_EMAIL_PREFIX = 'it-login-monitoring-';

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for login-monitoring integration tests.');
  }

  // The application reads DATABASE_URL; point it at the isolated test database.
  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, ilike, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { loginAttempts, users } from '@/modules/auth/schema';
import {
  checkGoogleSecurityChange,
  countFailedAttempts,
  getAllLoginAttempts,
  getLoginStatistics,
  getUserLoginAttempts,
  isUserLockedOut,
  recordLoginAttempt,
  resetFailedAttempts,
} from '@/modules/authorization/login-monitoring';
import { closePool } from '@/platform/db/pool';

/** User ids created by this file, cleaned up after each test. */
const trackedUserIds: string[] = [];

function newUserId(): string {
  const id = randomUUID();
  trackedUserIds.push(id);
  return id;
}

async function insertUser(options: {
  id?: string;
  email: string;
  isActive?: boolean;
  deletedAt?: Date | null;
}): Promise<string> {
  const id = options.id ?? newUserId();

  await db.insert(users).values({
    id,
    name: 'Login Monitoring Test User',
    email: options.email,
    isActive: options.isActive ?? true,
    deletedAt: options.deletedAt ?? null,
  });

  return id;
}

afterEach(async () => {
  if (trackedUserIds.length > 0) {
    await db.delete(loginAttempts).where(inArray(loginAttempts.userId, trackedUserIds));
    await db.delete(users).where(inArray(users.id, trackedUserIds));
    trackedUserIds.length = 0;
  }

  await db.delete(users).where(ilike(users.email, `${TEST_EMAIL_PREFIX}%`));
});

afterAll(async () => {
  await closePool();
});

describe('recordLoginAttempt / getUserLoginAttempts (real database)', () => {
  it('persists attempts with metadata and returns them newest first', async () => {
    const userId = newUserId();

    await recordLoginAttempt(userId, false, '203.0.113.10', 'Vitest/1.0');
    await recordLoginAttempt(userId, true, null, null);

    const attempts = await getUserLoginAttempts(userId);

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ success: true, ipAddress: null, userAgent: null });
    expect(attempts[1]).toMatchObject({
      success: false,
      ipAddress: '203.0.113.10',
      userAgent: 'Vitest/1.0',
    });
    expect(attempts[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(
      attempts[1]?.createdAt.getTime() ?? 0
    );
  });
});

describe('countFailedAttempts (real database)', () => {
  it('counts only failed attempts inside the window', async () => {
    const userId = newUserId();

    await recordLoginAttempt(userId, false);
    await recordLoginAttempt(userId, false);
    await recordLoginAttempt(userId, true);

    await expect(countFailedAttempts(userId, 30)).resolves.toBe(2);
    await expect(countFailedAttempts(userId, 0)).resolves.toBe(0);
  });

  it('does not count attempts belonging to another user', async () => {
    const userId = newUserId();
    const otherUserId = newUserId();

    await recordLoginAttempt(userId, false);
    await recordLoginAttempt(otherUserId, false);

    await expect(countFailedAttempts(userId, 30)).resolves.toBe(1);
  });
});

describe('isUserLockedOut (real database)', () => {
  it('reports not locked out below the threshold', async () => {
    const userId = newUserId();

    await recordLoginAttempt(userId, false);
    await recordLoginAttempt(userId, false);

    const result = await isUserLockedOut(userId);

    expect(result.lockedOut).toBe(false);
    expect(result.failedAttempts).toBe(2);
    expect(result.lockUntil).toBeUndefined();
  });

  it('reports locked out at the threshold with a future lock expiry', async () => {
    const userId = newUserId();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await recordLoginAttempt(userId, false);
    }

    const result = await isUserLockedOut(userId);

    expect(result.lockedOut).toBe(true);
    expect(result.failedAttempts).toBe(5);
    expect(result.lockUntil).toBeInstanceOf(Date);
    expect(result.lockUntil?.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('resetFailedAttempts (real database)', () => {
  it('removes every attempt for the user and leaves other users untouched', async () => {
    const userId = newUserId();
    const otherUserId = newUserId();

    await recordLoginAttempt(userId, false);
    await recordLoginAttempt(userId, true);
    await recordLoginAttempt(otherUserId, false);

    await resetFailedAttempts(userId);

    await expect(getUserLoginAttempts(userId)).resolves.toHaveLength(0);
    await expect(getUserLoginAttempts(otherUserId)).resolves.toHaveLength(1);
  });
});

describe('getAllLoginAttempts (real database)', () => {
  it('paginates without returning another user id by mistake', async () => {
    const userId = newUserId();

    await recordLoginAttempt(userId, false);
    await recordLoginAttempt(userId, true);
    await recordLoginAttempt(userId, true);

    const firstPage = await getAllLoginAttempts(2, 0);
    const secondPage = await getAllLoginAttempts(2, 2);

    expect(firstPage).toHaveLength(2);
    expect(firstPage.every(row => typeof row.id === 'string')).toBe(true);
    // Only this file writes login attempts, so offset 2 returns the third row.
    expect(secondPage).toHaveLength(1);
    expect(secondPage[0]?.id).not.toBe(firstPage[0]?.id);
    expect(secondPage[0]?.id).not.toBe(firstPage[1]?.id);
  });
});

describe('getLoginStatistics (real database)', () => {
  it('counts new attempts monotonically across the shared table', async () => {
    const userId = newUserId();

    const before = await getLoginStatistics();

    await recordLoginAttempt(userId, true);
    await recordLoginAttempt(userId, true);
    await recordLoginAttempt(userId, false);

    const after = await getLoginStatistics();

    expect(after.totalAttempts).toBeGreaterThanOrEqual(before.totalAttempts + 3);
    expect(after.successfulLogins).toBeGreaterThanOrEqual(before.successfulLogins + 2);
    expect(after.failedLogins).toBeGreaterThanOrEqual(before.failedLogins + 1);
    expect(after.recentFailed).toBeGreaterThanOrEqual(before.recentFailed + 1);
    expect(after.lockedOutUsers).toBeGreaterThanOrEqual(before.lockedOutUsers + 1);
  });
});

describe('checkGoogleSecurityChange (real database)', () => {
  it('returns false for an active user', async () => {
    const userId = await insertUser({ email: `${TEST_EMAIL_PREFIX}active@example.com` });

    await expect(checkGoogleSecurityChange(userId)).resolves.toBe(false);
  });

  it('returns true for a deactivated user', async () => {
    const userId = await insertUser({
      email: `${TEST_EMAIL_PREFIX}inactive@example.com`,
      isActive: false,
    });

    await expect(checkGoogleSecurityChange(userId)).resolves.toBe(true);
  });

  it('returns true for a soft-deleted user', async () => {
    const userId = await insertUser({
      email: `${TEST_EMAIL_PREFIX}deleted@example.com`,
      deletedAt: new Date(),
    });

    await expect(checkGoogleSecurityChange(userId)).resolves.toBe(true);
  });

  it('returns true for an unknown user id', async () => {
    await expect(
      checkGoogleSecurityChange('00000000-0000-7000-8000-000000000000')
    ).resolves.toBe(true);
  });
});

describe('login_attempts retention helper', () => {
  it('keeps attempt rows after a user is deleted (no destructive cascade)', async () => {
    const userId = await insertUser({ email: `${TEST_EMAIL_PREFIX}cascade@example.com` });
    await recordLoginAttempt(userId, false);

    await db.delete(users).where(eq(users.id, userId));

    const [row] = await db
      .select({ id: loginAttempts.id })
      .from(loginAttempts)
      .where(eq(loginAttempts.userId, userId))
      .limit(1);

    expect(row?.id).toBeDefined();
  });
});
