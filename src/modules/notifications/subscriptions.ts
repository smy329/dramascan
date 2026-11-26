import 'server-only';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { push_subscriptions } from './schema';
import type { PushSubscriptionPayload } from './push-provider';
import type { PushSubscription } from './subscriptions.shared';

/**
 * Browser push subscriptions (Prompt 148).
 *
 * A subscription is the browser's own endpoint plus the two keys it generated.
 * The endpoint is a capability: anyone who holds it can receive that viewer's
 * push messages, so it is stored per viewer and never exposed to another
 * viewer.
 *
 * Three things happen here:
 *
 *   - **Subscribe:** the browser hands over its endpoint and keys, and the
 *     subscription is stored against the signed-in viewer.
 *   - **Unsubscribe:** the viewer removes the subscription; the row is
 *     soft-deleted so the removal is auditable.
 *   - **Expire:** a provider reports that the endpoint is gone; the row is
 *     soft-deleted and the viewer is not told about it again.
 */

/** The maximum number of active subscriptions one viewer may hold. */
export const MAX_SUBSCRIPTIONS_PER_USER = 5;

export type { PushSubscription } from './subscriptions.shared';

/**
 * Store a browser push subscription for a viewer.
 *
 * A viewer who re-subscribes from the same browser replaces the old
 * subscription rather than accumulating them: the endpoint identifies the
 * browser profile, and a stale endpoint is a delivery that goes nowhere.
 *
 * @param userId the signed-in viewer
 * @param payload the browser's subscription
 * @param executor the database executor
 * @returns the stored subscription, or `null` when the viewer holds too many
 */
export async function saveSubscription(
  userId: string,
  payload: PushSubscriptionPayload,
  executor: DbExecutor = db
): Promise<PushSubscription | null> {
  const endpoint = payload.endpoint.trim();

  if (endpoint.length === 0) {
    return null;
  }

  const existing = await executor
    .select({
      id: push_subscriptions.id,
      userId: push_subscriptions.user_id,
      endpoint: push_subscriptions.endpoint,
      browser: push_subscriptions.browser,
      createdAt: push_subscriptions.created_at,
    })
    .from(push_subscriptions)
    .where(
      and(
        eq(push_subscriptions.user_id, userId),
        isNull(push_subscriptions.deleted_at)
      )
    )
    .limit(MAX_SUBSCRIPTIONS_PER_USER + 1);

  const sameEndpoint = existing.find(row => row.endpoint === endpoint);

  if (sameEndpoint) {
    // The browser re-subscribed with the same endpoint: refresh the keys and
    // keep the row, so the viewer does not accumulate duplicates.
    await executor
      .update(push_subscriptions)
      .set({
        p256dh: payload.p256dh,
        auth: payload.auth,
        browser: payload.browser ?? sameEndpoint.browser,
        user_agent: payload.userAgent,
        updated_at: sql`now()`,
      })
      .where(eq(push_subscriptions.id, sameEndpoint.id));

    return { ...sameEndpoint, browser: payload.browser ?? sameEndpoint.browser };
  }

  if (existing.length >= MAX_SUBSCRIPTIONS_PER_USER) {
    return null;
  }

  const [row] = await executor
    .insert(push_subscriptions)
    .values({
      user_id: userId,
      endpoint,
      p256dh: payload.p256dh,
      auth: payload.auth,
      browser: payload.browser,
      user_agent: payload.userAgent,
    })
    .returning({
      id: push_subscriptions.id,
      userId: push_subscriptions.user_id,
      endpoint: push_subscriptions.endpoint,
      browser: push_subscriptions.browser,
      createdAt: push_subscriptions.created_at,
    });

  return row ?? null;
}

/**
 * Remove one of a viewer's subscriptions.
 *
 * @param userId the signed-in viewer
 * @param subscriptionId the subscription to remove
 * @param executor the database executor
 * @returns whether a subscription was removed
 */
export async function removeSubscription(
  userId: string,
  subscriptionId: string,
  executor: DbExecutor = db
): Promise<boolean> {
  const result = await executor
    .update(push_subscriptions)
    .set({ deleted_at: sql`now()`, updated_at: sql`now()` })
    .where(
      and(
        eq(push_subscriptions.id, subscriptionId),
        eq(push_subscriptions.user_id, userId),
        isNull(push_subscriptions.deleted_at)
      )
    )
    .returning({ id: push_subscriptions.id });

  return result.length > 0;
}

/**
 * Remove every subscription of a viewer.
 *
 * @param userId the signed-in viewer
 * @param executor the database executor
 * @returns how many subscriptions were removed
 */
export async function removeAllSubscriptions(
  userId: string,
  executor: DbExecutor = db
): Promise<number> {
  const result = await executor
    .update(push_subscriptions)
    .set({ deleted_at: sql`now()`, updated_at: sql`now()` })
    .where(
      and(
        eq(push_subscriptions.user_id, userId),
        isNull(push_subscriptions.deleted_at)
      )
    )
    .returning({ id: push_subscriptions.id });

  return result.length;
}

/**
 * A viewer's active subscriptions.
 *
 * @param userId the signed-in viewer
 * @param executor the database executor
 * @returns the subscriptions
 */
export async function listSubscriptions(
  userId: string,
  executor: DbExecutor = db
): Promise<PushSubscription[]> {
  return executor
    .select({
      id: push_subscriptions.id,
      userId: push_subscriptions.user_id,
      endpoint: push_subscriptions.endpoint,
      browser: push_subscriptions.browser,
      createdAt: push_subscriptions.created_at,
    })
    .from(push_subscriptions)
    .where(
      and(
        eq(push_subscriptions.user_id, userId),
        isNull(push_subscriptions.deleted_at)
      )
    );
}

/**
 * The subscriptions that a delivery should try, for one viewer.
 *
 * The endpoint and the keys are needed to actually deliver, so this read
 * returns them. It is only ever called for the recipient of a notification.
 *
 * @param userId the recipient
 * @param executor the database executor
 * @returns the deliverable subscriptions
 */
export async function listDeliverableSubscriptions(
  userId: string,
  executor: DbExecutor = db
): Promise<Array<PushSubscription & { p256dh: string | null; auth: string | null }>> {
  return executor
    .select({
      id: push_subscriptions.id,
      userId: push_subscriptions.user_id,
      endpoint: push_subscriptions.endpoint,
      p256dh: push_subscriptions.p256dh,
      auth: push_subscriptions.auth,
      browser: push_subscriptions.browser,
      createdAt: push_subscriptions.created_at,
    })
    .from(push_subscriptions)
    .where(
      and(
        eq(push_subscriptions.user_id, userId),
        isNull(push_subscriptions.deleted_at)
      )
    );
}

/**
 * Which of these viewers hold at least one active subscription.
 *
 * A broadcast asks this question once for the whole audience, so it does not
 * attempt a push delivery for a viewer who has no browser to receive it.
 *
 * @param userIds the candidates
 * @param executor the database executor
 * @returns the viewers who hold a subscription
 */
export async function listUsersWithSubscriptions(
  userIds: readonly string[],
  executor: DbExecutor = db
): Promise<Set<string>> {
  if (userIds.length === 0) {
    return new Set();
  }

  const rows = await executor
    .selectDistinct({ userId: push_subscriptions.user_id })
    .from(push_subscriptions)
    .where(
      and(
        inArray(push_subscriptions.user_id, [...userIds]),
        isNull(push_subscriptions.deleted_at)
      )
    );

  return new Set(rows.map(row => row.userId));
}

/**
 * Remove a subscription that a provider reported as gone.
 *
 * The provider says the endpoint is dead; keeping the row would mean retrying
 * a delivery that can never succeed.
 *
 * @param subscriptionId the subscription to retire
 * @param executor the database executor
 * @returns whether a subscription was retired
 */
export async function retireExpiredSubscription(
  subscriptionId: string,
  executor: DbExecutor = db
): Promise<boolean> {
  const result = await executor
    .update(push_subscriptions)
    .set({ deleted_at: sql`now()`, updated_at: sql`now()` })
    .where(
      and(
        eq(push_subscriptions.id, subscriptionId),
        isNull(push_subscriptions.deleted_at)
      )
    )
    .returning({ id: push_subscriptions.id });

  return result.length > 0;
}
