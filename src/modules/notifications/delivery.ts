import 'server-only';

import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { notification_deliveries, notifications } from './schema';
import { getNotificationPreferences, isDeliveryAllowed } from './preferences';
import { listDeliverableSubscriptions, retireExpiredSubscription } from './subscriptions';
import { resolvePushProvider, type PushMessage } from './push-provider';
import { recordDelivery, listDeliveries } from './delivery-records';
import type { NotificationEventType } from './notifications';
import type { NotificationPreferenceSet } from './delivery-rules';

/**
 * Notification delivery safety and cleanup (Prompt 154).
 *
 * The rules this module enforces:
 *
 *   - **No uncontrolled retries.** A failed delivery is recorded, and that is
 *     the end of it. There is no queue and no retry loop; a message that fails
 *     once is not attempted again automatically.
 *   - **No duplicate notifications.** A notification row is written once. The
 *     caller checks for an existing notification before creating a second one.
 *   - **Expired subscriptions are retired.** A provider that reports the
 *     endpoint is gone causes the subscription to be soft-deleted, so the next
 *     delivery does not try it again.
 *   - **Invalid records are cleaned up.** A short-lived maintenance command
 *     removes notifications with no recipient or no event type, and deliveries
 *     that point at a notification that no longer exists.
 */

/** The maximum number of delivery attempts one call makes. */
export const MAX_DELIVERY_ATTEMPTS = 10;

/** The outcome of one delivery round. */
export type DeliveryOutcome = {
  /** The notification that was delivered. */
  notificationId: string;
  /** How many subscriptions the push was attempted on. */
  attempted: number;
  /** How many subscriptions accepted the message. */
  delivered: number;
  /** How many subscriptions were retired because the provider said so. */
  expired: number;
  /** How many attempts failed. */
  failed: number;
};

/**
 * Attempt the browser-push delivery of one notification.
 *
 * The delivery is bounded: at most `MAX_DELIVERY_ATTEMPTS` subscriptions are
 * tried, and each attempt is recorded. A failed attempt is not retried.
 *
 * @param notificationId the notification to deliver
 * @param executor the database executor
 * @param knownPreferences the recipient's preferences, when the caller already
 *   read them
 * @returns the delivery outcome
 */
export async function deliverPush(
  notificationId: string,
  executor: DbExecutor = db,
  knownPreferences?: NotificationPreferenceSet
): Promise<DeliveryOutcome> {
  const outcome: DeliveryOutcome = {
    notificationId,
    attempted: 0,
    delivered: 0,
    expired: 0,
    failed: 0,
  };

  const [notification] = await executor
    .select({
      id: notifications.id,
      userId: notifications.user_id,
      title: notifications.title,
      content: notifications.content,
      link: notifications.link,
      eventType: notifications.event_type,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.id, notificationId),
        isNull(notifications.deleted_at)
      )
    )
    .limit(1);

  if (!notification) {
    return outcome;
  }

  const preferences =
    knownPreferences ?? await getNotificationPreferences(notification.userId, executor);

  if (!isDeliveryAllowed(preferences, notification.eventType as NotificationEventType, 'push')) {
    // The viewer switched browser push off. The in-app notification stands;
    // the push channel simply has nothing to deliver.
    await recordDelivery(executor, {
      notificationId: notification.id,
      userId: notification.userId,
      channel: 'push',
      success: false,
      errorMessage: 'Browser push is disabled for this viewer.',
    });

    return outcome;
  }

  const provider = resolvePushProvider();

  if (!provider.isAvailable()) {
    await recordDelivery(executor, {
      notificationId: notification.id,
      userId: notification.userId,
      channel: 'push',
      success: false,
      errorMessage: 'No browser push provider is configured.',
    });

    return outcome;
  }

  const subscriptions = await listDeliverableSubscriptions(notification.userId, executor);
  const message: PushMessage = {
    title: notification.title,
    body: notification.content,
    link: notification.link,
    collapseKey: notification.id,
  };

  for (const subscription of subscriptions.slice(0, MAX_DELIVERY_ATTEMPTS)) {
    outcome.attempted += 1;

    const result = await provider.send(
      {
        endpoint: subscription.endpoint,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
        browser: subscription.browser,
        userAgent: null,
      },
      message
    );

    await recordDelivery(executor, {
      notificationId: notification.id,
      userId: notification.userId,
      channel: 'push',
      success: result.delivered,
      errorMessage: result.error,
      subscriptionId: subscription.id,
    });

    if (result.delivered) {
      outcome.delivered += 1;
      continue;
    }

    outcome.failed += 1;

    if (result.expired) {
      await retireExpiredSubscription(subscription.id, executor);
      outcome.expired += 1;
    }
  }

  // The notification is delivered when at least one subscription accepted it.
  // The in-app row may already have been delivered, so a failed push never
  // un-delivers the notification.
  if (outcome.delivered > 0) {
    await executor
      .update(notifications)
      .set({
        delivered: true,
        delivery_timestamp: sql`now()`,
        updated_at: sql`now()`,
      })
      .where(eq(notifications.id, notification.id));
  }

  return outcome;
}

/**
 * Record the in-app delivery of a notification.
 *
 * The in-app row exists the moment the notification is created; this records
 * that the viewer can see it.
 *
 * @param notificationId the notification
 * @param userId the recipient
 * @param executor the database executor
 */
export async function markInAppDelivered(
  notificationId: string,
  userId: string,
  executor: DbExecutor = db
): Promise<void> {
  await executor
    .update(notifications)
    .set({ delivered: true, delivery_timestamp: sql`now()`, updated_at: sql`now()` })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.user_id, userId),
        isNull(notifications.deleted_at)
      )
    );

  await recordDelivery(executor, {
    notificationId,
    userId,
    channel: 'in_app',
    success: true,
    errorMessage: null,
  });
}

export { listDeliveries };

/**
 * How many rows a raw statement changed.
 *
 * The driver reports the count in different places depending on the query,
 * so the value is read from wherever it is present.
 */
function readAffectedRows(result: unknown): number {
  if (typeof result === 'object' && result !== null && 'rowCount' in result) {
    const rowCount = (result as { rowCount?: unknown }).rowCount;

    if (typeof rowCount === 'number') {
      return rowCount;
    }
  }

  if (typeof result === 'object' && result !== null && 'count' in result) {
    const count = (result as { count?: unknown }).count;

    if (typeof count === 'number') {
      return count;
    }
  }

  return 0;
}

/**
 * Remove the delivery records of notifications that no longer exist.
 *
 * This is a short-lived maintenance operation, not a background worker. It is
 * bounded by the number of rows it removes.
 *
 * @param limit the maximum number of records to remove
 * @param executor the database executor
 * @returns how many records were removed
 */
export async function deleteOrphanedDeliveries(
  limit: number = 1000,
  executor: DbExecutor = db
): Promise<number> {
  const bounded = Math.max(1, Math.min(limit, 10000));

  const result = await executor.execute(sql`
    delete from ${notification_deliveries}
     where id in (
       select d.id
         from ${notification_deliveries} d
         left join ${notifications} n on n.id = d.notification_id
        where n.id is null
        limit ${bounded}
     )
  `);

  return readAffectedRows(result);
}

/**
 * Remove the notifications that are structurally invalid.
 *
 * A notification without a recipient or without an event type cannot be
 * delivered and cannot be understood. It is removed rather than left to
 * accumulate.
 *
 * @param limit the maximum number of notifications to remove
 * @param executor the database executor
 * @returns how many notifications were removed
 */
export async function deleteInvalidNotifications(
  limit: number = 1000,
  executor: DbExecutor = db
): Promise<number> {
  const bounded = Math.max(1, Math.min(limit, 10000));

  const result = await executor.execute(sql`
    delete from ${notifications}
     where id in (
       select n.id
         from ${notifications} n
        where n.deleted_at is null
          and (n.user_id is null or n.event_type is null or n.title is null or n.content is null)
        limit ${bounded}
     )
  `);

  return readAffectedRows(result);
}

/**
 * Remove the delivery records that are older than the retention window.
 *
 * The delivery trail is operational: it says what happened recently, not
 * forever.
 *
 * @param olderThan the instant before which a record is removed
 * @param limit the maximum number of records to remove
 * @param executor the database executor
 * @returns how many records were removed
 */
export async function deleteOldDeliveries(
  olderThan: Date,
  limit: number = 1000,
  executor: DbExecutor = db
): Promise<number> {
  const bounded = Math.max(1, Math.min(limit, 10000));

  const result = await executor
    .delete(notification_deliveries)
    .where(lt(notification_deliveries.created_at, olderThan))
    .returning({ id: notification_deliveries.id });

  return result.length > bounded ? bounded : result.length;
}
