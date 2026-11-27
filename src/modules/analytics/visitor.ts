import 'server-only';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';
import { isUniqueViolation } from '@/platform/db/errors';
import { createRequestLogger } from '@/platform/logging';

import {
  content_view_events,
  guest_sessions,
  playback_analytics_events,
  playback_viewing_sessions,
  search_events,
} from './schema';
import {
  playbackContentIdExpression,
  playbackTargetTypeExpression,
  viewTargetIdExpression,
  viewTargetTypeExpression,
} from './typed-targets';

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
 * If the account already has a canonical row, that row stays the account's
 * visitor key. The active anonymous browser row is then reconciled into it in
 * one transaction and retired, so the events recorded before sign-in are not
 * left orphaned.
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
      try {
        await reconcileGuestVisitor(account, input.sessionId, input.userId);
      } catch (error) {
        // The analytics beacon is fire-and-forget. The transaction rolled back,
        // so the canonical account visitor is still valid and the page must not
        // fail because an orphaned browser guest row could not be reconciled.
        const { logger } = createRequestLogger({ module: 'analytics' });

        logger.warn(
          {
            err: error,
            event: 'analytics_visitor_reconciliation_failed',
            userId: input.userId,
          },
          'Analytics visitor reconciliation failed; returning the canonical visitor.'
        );
      }

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

/**
 * Reconcile an active anonymous browser row into the account's canonical row.
 *
 * The account row is locked first, so two requests for the same account cannot
 * reconcile the same browser row at the same time. The browser row is locked as
 * well, which also serializes two different accounts that somehow arrive with
 * the same anonymous session identifier.
 *
 * Every event move and the retirement of the browser row run in one
 * transaction. A conflicting event is soft-deleted before the remaining rows
 * are moved, because the canonical row's event was stored first and stays the
 * active event of its deduplication key.
 *
 * @param canonical the account's canonical visitor
 * @param sessionId the browser's anonymous session identifier
 * @param userId the account
 */
async function reconcileGuestVisitor(
  canonical: AnalyticsVisitor,
  sessionId: string,
  userId: string
): Promise<void> {
  await db.transaction(async tx => {
    const [lockedCanonical] = await tx
      .select({ id: guest_sessions.id })
      .from(guest_sessions)
      .where(
        and(
          eq(guest_sessions.id, canonical.guestSessionId),
          eq(guest_sessions.user_id, userId),
          isNull(guest_sessions.deleted_at)
        )
      )
      .for('update')
      .limit(1);

    if (!lockedCanonical) {
      return;
    }

    const [guest] = await tx
      .select({ id: guest_sessions.id })
      .from(guest_sessions)
      .where(
        and(
          eq(guest_sessions.session_id, sessionId),
          isNull(guest_sessions.user_id),
          isNull(guest_sessions.deleted_at)
        )
      )
      .for('update')
      .limit(1);

    if (!guest || guest.id === canonical.guestSessionId) {
      return;
    }

    await reconcileViewEvents(tx, guest.id, canonical.guestSessionId);
    await reconcilePlaybackEvents(tx, guest.id, canonical.guestSessionId);
    await reconcileViewingSessions(tx, guest.id, canonical.guestSessionId);
    await reconcileSearchEvents(tx, guest.id, canonical.guestSessionId);

    const retired = await tx
      .update(guest_sessions)
      .set({ deleted_at: sql`now()`, updated_at: sql`now()` })
      .where(
        and(
          eq(guest_sessions.id, guest.id),
          isNull(guest_sessions.user_id),
          isNull(guest_sessions.deleted_at)
        )
      )
      .returning({ id: guest_sessions.id });

    if (retired.length !== 1) {
      throw new Error('The orphaned analytics visitor row could not be retired.');
    }
  });
}

/**
 * Move the view events of an orphaned visitor into the canonical visitor.
 *
 * The deduplication key is the effective target and hour bucket used by
 * `uq_content_view_events_dedup`. The typed target wins over the legacy pair
 * (D-032, D-082).
 */
async function reconcileViewEvents(
  executor: DbExecutor,
  guestRowId: string,
  canonicalRowId: string
): Promise<void> {
  const canonicalRows = await executor
    .select({
      targetType: sql<string>`${viewTargetTypeExpression}`,
      targetId: sql<string>`${viewTargetIdExpression}`,
      hourBucket: content_view_events.viewed_hour_bucket,
    })
    .from(content_view_events)
    .where(
      and(
        eq(content_view_events.guest_session_id, canonicalRowId),
        isNull(content_view_events.deleted_at)
      )
    );

  const guestRows = await executor
    .select({
      id: content_view_events.id,
      targetType: sql<string>`${viewTargetTypeExpression}`,
      targetId: sql<string>`${viewTargetIdExpression}`,
      hourBucket: content_view_events.viewed_hour_bucket,
      deletedAt: content_view_events.deleted_at,
    })
    .from(content_view_events)
    .where(eq(content_view_events.guest_session_id, guestRowId));

  const canonicalKeys = new Set(
    canonicalRows
      .map(row => deduplicationKey([row.targetType, row.targetId, row.hourBucket]))
      .filter((key): key is string => key !== null)
  );
  const collidingIds = guestRows
    .filter(row => row.deletedAt === null)
    .filter(row => {
      const key = deduplicationKey([row.targetType, row.targetId, row.hourBucket]);

      return key !== null && canonicalKeys.has(key);
    })
    .map(row => row.id);

  if (collidingIds.length > 0) {
    await executor
      .update(content_view_events)
      .set({ deleted_at: sql`now()` })
      .where(inArray(content_view_events.id, collidingIds));
  }

  await executor
    .update(content_view_events)
    .set({ guest_session_id: canonicalRowId })
    .where(eq(content_view_events.guest_session_id, guestRowId));
}

/**
 * Move the playback events of an orphaned visitor into the canonical visitor.
 *
 * The deduplication key is the effective target, effective content, event type
 * and hour bucket used by `uq_playback_analytics_events_dedup`.
 */
async function reconcilePlaybackEvents(
  executor: DbExecutor,
  guestRowId: string,
  canonicalRowId: string
): Promise<void> {
  const canonicalRows = await executor
    .select({
      targetType: sql<string>`${playbackTargetTypeExpression}`,
      contentId: sql<string>`${playbackContentIdExpression}`,
      eventType: playback_analytics_events.event_type,
      hourBucket: playback_analytics_events.event_hour_bucket,
    })
    .from(playback_analytics_events)
    .where(
      and(
        eq(playback_analytics_events.guest_session_id, canonicalRowId),
        isNull(playback_analytics_events.deleted_at)
      )
    );

  const guestRows = await executor
    .select({
      id: playback_analytics_events.id,
      targetType: sql<string>`${playbackTargetTypeExpression}`,
      contentId: sql<string>`${playbackContentIdExpression}`,
      eventType: playback_analytics_events.event_type,
      hourBucket: playback_analytics_events.event_hour_bucket,
      deletedAt: playback_analytics_events.deleted_at,
    })
    .from(playback_analytics_events)
    .where(eq(playback_analytics_events.guest_session_id, guestRowId));

  const canonicalKeys = new Set(
    canonicalRows
      .map(row =>
        deduplicationKey([row.targetType, row.contentId, row.eventType, row.hourBucket])
      )
      .filter((key): key is string => key !== null)
  );
  const collidingIds = guestRows
    .filter(row => row.deletedAt === null)
    .filter(row => {
      const key = deduplicationKey([
        row.targetType,
        row.contentId,
        row.eventType,
        row.hourBucket,
      ]);

      return key !== null && canonicalKeys.has(key);
    })
    .map(row => row.id);

  if (collidingIds.length > 0) {
    await executor
      .update(playback_analytics_events)
      .set({ deleted_at: sql`now()` })
      .where(inArray(playback_analytics_events.id, collidingIds));
  }

  await executor
    .update(playback_analytics_events)
    .set({ guest_session_id: canonicalRowId })
    .where(eq(playback_analytics_events.guest_session_id, guestRowId));
}

/**
 * Move the viewing-session baselines of an orphaned visitor into the canonical
 * visitor. The baseline key is the visitor, content item and browser session
 * key used by `uq_playback_viewing_sessions_visitor_content`.
 */
async function reconcileViewingSessions(
  executor: DbExecutor,
  guestRowId: string,
  canonicalRowId: string
): Promise<void> {
  const canonicalRows = await executor
    .select({
      contentId: playback_viewing_sessions.content_id,
      clientSessionKey: playback_viewing_sessions.client_session_key,
    })
    .from(playback_viewing_sessions)
    .where(
      and(
        eq(playback_viewing_sessions.guest_session_id, canonicalRowId),
        isNull(playback_viewing_sessions.deleted_at)
      )
    );

  const guestRows = await executor
    .select({
      id: playback_viewing_sessions.id,
      contentId: playback_viewing_sessions.content_id,
      clientSessionKey: playback_viewing_sessions.client_session_key,
      deletedAt: playback_viewing_sessions.deleted_at,
    })
    .from(playback_viewing_sessions)
    .where(eq(playback_viewing_sessions.guest_session_id, guestRowId));

  const canonicalKeys = new Set(
    canonicalRows
      .map(row => deduplicationKey([row.contentId, row.clientSessionKey]))
      .filter((key): key is string => key !== null)
  );
  const collidingIds = guestRows
    .filter(row => row.deletedAt === null)
    .filter(row => {
      const key = deduplicationKey([row.contentId, row.clientSessionKey]);

      return key !== null && canonicalKeys.has(key);
    })
    .map(row => row.id);

  if (collidingIds.length > 0) {
    await executor
      .update(playback_viewing_sessions)
      .set({ deleted_at: sql`now()`, updated_at: sql`now()` })
      .where(inArray(playback_viewing_sessions.id, collidingIds));
  }

  await executor
    .update(playback_viewing_sessions)
    .set({ guest_session_id: canonicalRowId })
    .where(eq(playback_viewing_sessions.guest_session_id, guestRowId));
}

/**
 * Move the search events of an orphaned visitor into the canonical visitor.
 *
 * Search events have their own hourly deduplication key. The canonical row's
 * event is kept when the two visitors searched in the same hour.
 */
async function reconcileSearchEvents(
  executor: DbExecutor,
  guestRowId: string,
  canonicalRowId: string
): Promise<void> {
  const canonicalRows = await executor
    .select({ hourBucket: search_events.search_hour_bucket })
    .from(search_events)
    .where(
      and(
        eq(search_events.guest_session_id, canonicalRowId),
        isNull(search_events.deleted_at)
      )
    );

  const guestRows = await executor
    .select({
      id: search_events.id,
      hourBucket: search_events.search_hour_bucket,
      deletedAt: search_events.deleted_at,
    })
    .from(search_events)
    .where(eq(search_events.guest_session_id, guestRowId));

  const canonicalKeys = new Set(
    canonicalRows
      .map(row => deduplicationKey([row.hourBucket]))
      .filter((key): key is string => key !== null)
  );
  const collidingIds = guestRows
    .filter(row => row.deletedAt === null)
    .filter(row => {
      const key = deduplicationKey([row.hourBucket]);

      return key !== null && canonicalKeys.has(key);
    })
    .map(row => row.id);

  if (collidingIds.length > 0) {
    await executor
      .update(search_events)
      .set({ deleted_at: sql`now()` })
      .where(inArray(search_events.id, collidingIds));
  }

  await executor
    .update(search_events)
    .set({ guest_session_id: canonicalRowId })
    .where(eq(search_events.guest_session_id, guestRowId));
}

/**
 * Build a PostgreSQL-style deduplication key.
 *
 * PostgreSQL treats `NULL` as distinct in a unique index, so a key that holds
 * `NULL` cannot collide.
 */
function deduplicationKey(parts: readonly (string | null)[]): string | null {
  if (parts.some(part => part === null)) {
    return null;
  }

  return JSON.stringify(parts);
}
