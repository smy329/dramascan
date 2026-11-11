/**
 * Admin session security management.
 *
 * Tracks last activity per session and enforces inactivity timeout and
 * maximum lifetime configured in system settings. All checks are
 * server-side only; client-side state cannot bypass these guards.
 *
 * Authorized entrypoints (Super Admin only) may inspect, terminate, or
 * force-reauthenticate any session. Regular users never see or influence
 * another user's session metadata.
 */

import 'server-only';

import { db } from '@/db/client';
import { sessions, users } from '@/modules/auth/schema';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { resolveActor } from '@/modules/authorization/actors';

/** Session info returned to callers. */
export type SessionInfo = Readonly<{
  sessionId: string;
  userId: string;
  userEmail: string;
  userIsSuperAdmin: boolean;
  expiresAt: Date;
  lastActivityAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  ageMinutes: number;
  idleMinutes: number;
}>;

/** Default inactivity timeout when config is absent: 30 minutes. */
const DEFAULT_INACTIVITY_TIMEOUT = 30;
/** Default maximum lifetime when config is absent: 24 hours. */
const DEFAULT_MAX_LIFETIME = 24 * 60; // 24 hours in minutes

/**
 * Reads the admin session timeout config, falling back to defaults.
 */
function getConfig(
  config: { adminSessionInactivityTimeout?: number; adminSessionMaxLifetime?: number } | undefined
): {
  inactivityTimeout: number;
  maxLifetime: number;
} {
  const timeout = config?.adminSessionInactivityTimeout ?? DEFAULT_INACTIVITY_TIMEOUT;
  const lifetime = config?.adminSessionMaxLifetime ?? DEFAULT_MAX_LIFETIME;
  return { inactivityTimeout: timeout, maxLifetime: lifetime };
}

/**
 * Enrich a raw Better Auth session with application-owned metadata
 * (lastActivityAt, ipAddress, userAgent) and enforce session timeout.
 */
export async function enrichSession(
  session: { user: { id: string; email: string } } | null,
  config: { adminSessionInactivityTimeout?: number; adminSessionMaxLifetime?: number } | undefined
): Promise<SessionInfo | null> {
  if (!session?.user?.id) {
    return null;
  }

  const { inactivityTimeout, maxLifetime } = getConfig(config);

  const [account] = await db
    .select({
      isSuperAdmin: users.isSuperAdmin,
      isActive: users.isActive,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const isValid = account?.isActive && account.deletedAt == null;
  if (!isValid) {
    return null;
  }

  // Find the session row enriched with activity data
  const [sessionRow] = await db
    .select({
      id: sessions.id,
      expiresAt: sessions.expiresAt,
      lastActivityAt: sessions.lastActivityAt ?? new Date(),
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(eq(sessions.userId, session.user.id))
    .limit(1);

  if (!sessionRow) {
    // No DB session row; Better Auth cookie may be stale. Deny access.
    return null;
  }

  const now = new Date();
  const lastActivity = sessionRow.lastActivityAt ?? new Date();
  const ageMinutes = Math.max(0, (now.getTime() - lastActivity.getTime()) / 60000);

  // If the session has exceeded maximum lifetime — invalidate
  if (ageMinutes > maxLifetime) {
    await db.delete(sessions).where(eq(sessions.id, sessionRow.id));
    return null;
  }

  const idleMinutes = Math.max(0, (now.getTime() - lastActivity.getTime()) / 60000);

  // If the session exceeded inactivity timeout — invalidate
  if (idleMinutes > inactivityTimeout) {
    await db.delete(sessions).where(eq(sessions.id, sessionRow.id));
    return null;
  }

  return {
    sessionId: sessionRow.id,
    userId: session.user.id,
    userEmail: session.user.email,
    userIsSuperAdmin: account?.isSuperAdmin ?? false,
    expiresAt: sessionRow.expiresAt,
    lastActivityAt: sessionRow.lastActivityAt,
    ipAddress: sessionRow.ipAddress,
    userAgent: sessionRow.userAgent,
    ageMinutes: Math.floor(ageMinutes),
    idleMinutes: Math.floor(idleMinutes),
  };
}

/**
 * Re-prime a session's lastActivityAt timestamp. Called on each protected request.
 */
export async function refreshSessionActivity(
  userId: string,
  ipAddress?: string | null,
  userAgent?: string | null
): Promise<void> {
  await db
    .update(sessions)
    .set({
      lastActivityAt: sql`now()`,
      ipAddress: ipAddress ?? sessions.ipAddress,
      userAgent: userAgent ?? sessions.userAgent,
    })
    .where(eq(sessions.userId, userId));
}

/**
 * Resolve all active sessions for a given user, enriched with activity metadata.
 * Super Admin only — regular users must not call this.
 */
export async function listUserSessions(
  userId: string,
  config: { adminSessionInactivityTimeout?: number; adminSessionMaxLifetime?: number } | undefined
): Promise<SessionInfo[]> {
  const { adminSessionMaxLifetime } = config ?? {};
  const maxLifetime = adminSessionMaxLifetime ?? DEFAULT_MAX_LIFETIME;
  const now = new Date();

  const rows = await db
    .select({
      id: sessions.id,
      expiresAt: sessions.expiresAt,
      lastActivityAt: sessions.lastActivityAt,
      ipAddress: sessions.ipAddress,
      userAgent: sessions.userAgent,
    })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(sessions.lastActivityAt);

  return rows
    .filter(row => {
      const ageMinutes = Math.max(0, (now.getTime() - row.lastActivityAt.getTime()) / 60000);
      return ageMinutes <= maxLifetime;
    })
    .map(row => ({
      sessionId: row.id,
      userId,
      userEmail: '',
      userIsSuperAdmin: false,
      expiresAt: row.expiresAt,
      lastActivityAt: row.lastActivityAt,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      ageMinutes: Math.floor(
        Math.max(0, (now.getTime() - row.lastActivityAt.getTime()) / 60000)
      ),
      idleMinutes: Math.floor(
        Math.max(0, (now.getTime() - row.lastActivityAt.getTime()) / 60000)
      ),
    }));
}

/**
 * Force-invalidate all sessions for a user (Super Admin only).
 */
export async function invalidateUserSessions(
  userId: string,
  _actorUserId: string
): Promise<void> {
  const actor = await resolveActor();
  if (!actor.isSuperAdmin) {
    throw new Error('Only Super Admin may invalidate sessions.');
  }

  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Force reauthentication for a target user (Super Admin only).
 */
export async function forceReauthenticateUser(
  targetUserId: string,
  _actorUserId: string
): Promise<void> {
  const actor = await resolveActor();
  if (!actor.isSuperAdmin) {
    throw new Error('Only Super Admin may force reauthentication.');
  }

  await invalidateUserSessions(targetUserId, _actorUserId);
}
