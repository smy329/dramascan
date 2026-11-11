/**
 * Active-session resolution for Server Components and Server Actions.
 *
 * `auth.api.getSession` only proves that a session cookie is valid. Account
 * status is owned by this application, so every protected entrypoint re-reads
 * it from the database. A deactivated or soft-deleted user therefore loses
 * access even while an existing session cookie is still valid.
 *
 * In addition, this enforces the configured inactivity timeout and maximum
 * session lifetime from system settings. A session that has exceeded either
 * limit is invalidated and `null` is returned.
 */


import 'server-only';

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { auth } from '@/platform/auth/better-auth';
import { decideSessionCreation } from './auth-policy';
import { enrichSession } from '@/modules/authorization';

export type ActiveSession = Readonly<{
  userId: string;
  userEmail: string;
  userName: string;
}>;

/** Return the signed-in, active user, or `null` when access must be denied. */
export async function getActiveSession(): Promise<ActiveSession | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;

  if (!userId) {
    return null;
  }

  const [account] = await db
    .select({ isActive: users.isActive, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (decideSessionCreation(account ?? null) !== 'allowed') {
    return null;
  }

  // Enrich with application-owned metadata and enforce session timeout.
  const config = await import('@/platform/config').then(m => m.serverConfig);
  const enriched = await enrichSession(session, config);

  if (!enriched) {
    // Session exceeded inactivity timeout or max lifetime — invalidate.
    return null;
  }

  return {
    userId: enriched.userId,
    userEmail: enriched.userEmail,
    userName: session.user.name,
  };
}
