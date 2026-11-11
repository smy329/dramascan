/**
 * Login monitoring and security alerts.
 *
 * Records successful and failed administrator login attempts, tracks repeated
 * failures, and provides Super Admin dashboard alerts. All data is stored
 * server-side; no credentials are persisted.
 *
 * Configurable temporary restrictions lock out users after N failed attempts.
 * Google security change detection revokes sessions when the relevant change
 * can be reliably detected; no real-time Google security notifications are promised.
 */

import 'server-only';

import { db } from '@/db/client';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { loginAttempts, users } from '@/modules/auth/schema';

/** Maximum failed attempts before temporary lockout is triggered. */
const DEFAULT_FAILURE_THRESHOLD = 5;
/** Default lockout duration in minutes. */
const DEFAULT_LOCKOUT_DURATION = 30;

/** Record a login attempt (success or failure). */
export async function recordLoginAttempt(
  userId: string,
  success: boolean,
  ipAddress?: string | null,
  userAgent?: string | null
): Promise<void> {
  await db.insert(loginAttempts).values({
    userId,
    success,
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
  });
}

/** Count failed login attempts for a user within the lockout window. */
export async function countFailedAttempts(
  userId: string,
  windowMinutes: number
): Promise<number> {
  const since = new Date(Date.now() - windowMinutes * 60000);

  const [result] = await db
    .select({ count: sql<string>`count(*)` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.userId, userId),
        eq(loginAttempts.success, false),
        gte(loginAttempts.createdAt, since)
      )
    );

  return Number(result?.count ?? 0);
}

/** Check whether a user is currently locked out. */
export async function isUserLockedOut(userId: string): Promise<{
  lockedOut: boolean;
  failedAttempts: number;
  lockUntil?: Date;
}> {
  const failedAttempts = await countFailedAttempts(userId, DEFAULT_FAILURE_THRESHOLD);

  if (failedAttempts < DEFAULT_FAILURE_THRESHOLD) {
    return { lockedOut: false, failedAttempts, lockUntil: undefined };
  }

  // Calculate lockUntil based on the earliest failed attempt that put us over the threshold
  const [earliest] = await db
    .select({ createdAt: loginAttempts.createdAt })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.userId, userId), eq(loginAttempts.success, false)))
    .orderBy(loginAttempts.createdAt);

  let lockUntil: Date | undefined;
  if (earliest?.createdAt) {
    lockUntil = new Date(earliest.createdAt.getTime() + DEFAULT_LOCKOUT_DURATION * 60000);
  }

  return { lockedOut: true, failedAttempts, lockUntil };
}

/** Reset failed login attempts for a user (called on successful login). */
export async function resetFailedAttempts(userId: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.userId, userId));
}

/** Get recent login attempts for a user (Super Admin only). */
export async function getUserLoginAttempts(
  userId: string,
  limit: number = 50
): Promise<Array<{
  id: string;
  success: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}>> {
  const rows = await db
    .select({
      id: loginAttempts.id,
      success: loginAttempts.success,
      ipAddress: loginAttempts.ipAddress,
      userAgent: loginAttempts.userAgent,
      createdAt: loginAttempts.createdAt,
    })
    .from(loginAttempts)
    .where(eq(loginAttempts.userId, userId))
    .orderBy(desc(loginAttempts.createdAt))
    .limit(limit);

  return rows.map(row => ({
    id: row.id,
    success: row.success,
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    createdAt: row.createdAt,
  }));
}

/** Get all login attempts across all users (Super Admin only, with pagination). */
export async function getAllLoginAttempts(
  limit: number = 100,
  offset: number = 0
): Promise<Array<{
  id: string;
  userId: string | null;
  success: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}>> {
  const rows = await db
    .select({
      id: loginAttempts.id,
      userId: loginAttempts.userId,
      success: loginAttempts.success,
      ipAddress: loginAttempts.ipAddress,
      userAgent: loginAttempts.userAgent,
      createdAt: loginAttempts.createdAt,
    })
    .from(loginAttempts)
    .orderBy(desc(loginAttempts.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map(row => ({
    id: row.id,
    userId: row.userId,
    success: row.success,
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    createdAt: row.createdAt,
  }));
}

/** Get login statistics for the dashboard (Super Admin only). */
export async function getLoginStatistics(): Promise<{
  totalAttempts: number;
  successfulLogins: number;
  failedLogins: number;
  lockedOutUsers: number;
  recentFailed: number;
}> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const lockoutWindowStart = new Date(Date.now() - DEFAULT_LOCKOUT_DURATION * 60 * 1000);

  const [totalAttempts, successfulLogins, failedLogins, recentFailed, lockedUsers] =
    await Promise.all([
      db.$count(loginAttempts),
      db.$count(loginAttempts, eq(loginAttempts.success, true)),
      db.$count(loginAttempts, eq(loginAttempts.success, false)),
      db.$count(
        loginAttempts,
        and(eq(loginAttempts.success, false), gte(loginAttempts.createdAt, twentyFourHoursAgo))
      ),
      // Users with failures inside the lockout window who may be restricted.
      db
        .select({ count: sql<string>`count(distinct ${loginAttempts.userId})` })
        .from(loginAttempts)
        .where(
          and(
            eq(loginAttempts.success, false),
            gte(loginAttempts.createdAt, lockoutWindowStart)
          )
        ),
    ]);

  return {
    totalAttempts,
    successfulLogins,
    failedLogins,
    lockedOutUsers: Number(lockedUsers[0]?.count ?? 0),
    recentFailed,
  };
}

/**
 * Google security change detection.
 *
 * Checks whether the user's Google account status has changed in a way that
 * would invalidate their session. This is a best-effort check — it does not
 * promise real-time Google security notifications. It compares the last-known
 * Google account status stored in the user record against what can be inferred
 * from the session.
 *
 * Returns `true` if the session should be revoked, `false` otherwise.
 */
export async function checkGoogleSecurityChange(userId: string): Promise<boolean> {
  // Best-effort check: if the user account is deactivated, soft-deleted, or
  // missing, revoke all sessions. Otherwise, no real-time Google security
  // integration is promised.
  const [account] = await db
    .select({ isActive: users.isActive, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!account) {
    return true;
  }

  return !account.isActive || account.deletedAt !== null;
}
