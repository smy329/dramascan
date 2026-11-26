import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';
import { isUniqueViolation } from '@/platform/db/errors';

import { guest_sessions } from './schema';

export { ANALYTICS_VIEWER_TYPES, analyticsViewerType } from './viewer-types';
export type { AnalyticsViewerType } from './viewer-types';

/**
 * The analytics visitor (Prompt 139).
 *
 * Every analytics event names a visitor, and the event tables may only carry
 * the anonymous `guest_session_id` — never a personal identifier. The
 * `guest_sessions` table is therefore the one place where an account and an
 * anonymous session meet, and it is the place the link is made.
 *
 * Two kinds of visitor exist:
 *
 *   - **Guest:** the anonymous session identifier from the cookie.
 *   - **Signed-in viewer:** the account. The viewer still gets a guest session
 *     row, but that row carries the account id, so the viewer's events are
 *     counted once per viewer rather than once per browser.
 *
 * The visitor key is the `guest_sessions.id`, the row id. It is stable: a
 * signed-in viewer resolves to the same row on every request, and a guest
 * resolves to the same row for the same cookie.
 */

/** The resolved analytics visitor. */
export type AnalyticsVisitor = {
  /** The `guest_sessions.id` stored on every event row. */
  guestSessionId: string;
  /** The anonymous session identifier of the row. */
  sessionId: string;
  /** The linked account, when the visitor is signed in. */
  userId: string | null;
};

/**
 * Resolve the analytics visitor of a request.
 *
 * The row is created on first use and reused afterwards.
 *
 * When a visitor signs in with the cookie they arrived with, the anonymous
 * row is *linked* to the account rather than replaced: the visitor keeps the
 * key their earlier views were counted under, so signing in does not count a
 * second view of the page they were already looking at, and the guest-side
 * history stays attached to the account.
 *
 * @param input the account, when there is one, and the anonymous session id
 * @param executor the database executor
 * @returns the resolved visitor
 */
export async function resolveAnalyticsVisitor(
  input: { userId: string | null; sessionId: string },
  executor: DbExecutor = db
): Promise<AnalyticsVisitor> {
  if (input.userId !== null) {
    const account = await findVisitorByUser(input.userId, executor);

    if (account) {
      return account;
    }

    const session = await findVisitorBySession(input.sessionId, executor);

    if (session && session.userId === null) {
      const linked = await linkVisitorToAccount(session, input.userId, executor);

      if (linked) {
        return linked;
      }
    }

    return createAccountVisitor(input.userId, executor);
  }

  const guest = await findVisitorBySession(input.sessionId, executor);

  if (guest) {
    return guest;
  }

  await executor
    .insert(guest_sessions)
    .values({ session_id: input.sessionId })
    .onConflictDoNothing({
      target: guest_sessions.session_id,
      where: sql`${guest_sessions.deleted_at} IS NULL`,
    });

  const created = await findVisitorBySession(input.sessionId, executor);

  if (created) {
    return created;
  }

  // Another request won the race and created the row. The next read finds it.
  return {
    guestSessionId: input.sessionId,
    sessionId: input.sessionId,
    userId: null,
  };
}

/**
 * Link an anonymous visitor row to an account.
 *
 * The row keeps its identity, so the events already recorded under it stay
 * attached to the account.
 *
 * @param session the anonymous row
 * @param userId the account
 * @param executor the database executor
 * @returns the linked visitor, or `null` when the link lost a race
 */
async function linkVisitorToAccount(
  session: AnalyticsVisitor,
  userId: string,
  executor: DbExecutor
): Promise<AnalyticsVisitor | null> {
  try {
    await executor
      .update(guest_sessions)
      .set({ user_id: userId, updated_at: sql`now()` })
      .where(
        and(
          eq(guest_sessions.id, session.guestSessionId),
          isNull(guest_sessions.user_id),
          isNull(guest_sessions.deleted_at)
        )
      );
  } catch (error) {
    // Another request linked the account to a different row first.
    if (isUniqueViolation(error)) {
      return findVisitorByUser(userId, executor);
    }

    throw error;
  }

  const linked = await findVisitorByUser(userId, executor);

  if (linked) {
    return linked;
  }

  return { ...session, userId };
}

/**
 * Create the visitor row of an account that has none.
 *
 * The row carries a fresh anonymous session identifier: the cookie of the
 * browser the account signed in from may already belong to another account,
 * and two accounts must never share one anonymous session identifier.
 */
async function createAccountVisitor(
  userId: string,
  executor: DbExecutor
): Promise<AnalyticsVisitor> {
  await executor
    .insert(guest_sessions)
    .values({ session_id: crypto.randomUUID(), user_id: userId })
    .onConflictDoNothing({
      target: guest_sessions.user_id,
      where: sql`${guest_sessions.user_id} IS NOT NULL AND ${guest_sessions.deleted_at} IS NULL`,
    });

  const created = await findVisitorByUser(userId, executor);

  if (created) {
    return created;
  }

  return {
    guestSessionId: userId,
    sessionId: userId,
    userId,
  };
}

/** The active guest session row of an account. */
async function findVisitorByUser(
  userId: string,
  executor: DbExecutor
): Promise<AnalyticsVisitor | null> {
  const [row] = await executor
    .select({
      guestSessionId: guest_sessions.id,
      sessionId: guest_sessions.session_id,
      userId: guest_sessions.user_id,
    })
    .from(guest_sessions)
    .where(
      and(
        eq(guest_sessions.user_id, userId),
        isNull(guest_sessions.deleted_at)
      )
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    guestSessionId: row.guestSessionId,
    sessionId: row.sessionId,
    userId: row.userId,
  };
}

/** The active guest session row of an anonymous session identifier. */
async function findVisitorBySession(
  sessionId: string,
  executor: DbExecutor
): Promise<AnalyticsVisitor | null> {
  const [row] = await executor
    .select({
      guestSessionId: guest_sessions.id,
      sessionId: guest_sessions.session_id,
      userId: guest_sessions.user_id,
    })
    .from(guest_sessions)
    .where(
      and(
        eq(guest_sessions.session_id, sessionId),
        isNull(guest_sessions.deleted_at)
      )
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    guestSessionId: row.guestSessionId,
    sessionId: row.sessionId,
    userId: row.userId,
  };
}
