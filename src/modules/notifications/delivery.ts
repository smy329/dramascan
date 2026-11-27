import 'server-only';

import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { notification_deliveries, notifications, push_subscriptions } from './schema';
import { getNotificationPreferences, isDeliveryAllowed } from './preferences';
import { listDeliverableSubscriptions, retireExpiredSubscription } from './subscriptions';
import { resolvePushProvider, type PushMessage } from './push-provider';
import {
  countPushAttempts,
  hasSuccessfulPushDelivery,
  recordDelivery,
  listDeliveries,
} from './delivery-records';
import type { NotificationEventType } from './notifications';
import type { NotificationPreferenceSet } from './delivery-rules';
import {
  DELIVERY_LEASE_SECONDS,
  DELIVERY_RETENTION_DAYS,
  MAX_DELIVERY_ATTEMPTS,
  MAX_PUSH_RETRY_ATTEMPTS,
  PUSH_RETRY_WINDOW_DAYS,
} from './delivery-limits';

export {
  DELIVERY_LEASE_SECONDS,
  DELIVERY_RETENTION_DAYS,
  MAX_DELIVERY_ATTEMPTS,
  MAX_PUSH_RETRY_ATTEMPTS,
  PUSH_RETRY_WINDOW_DAYS,
} from './delivery-limits';

/**
 * Notification delivery safety and cleanup (Prompt 154).
 *
 * The rules this module enforces:
 *
 *   - **No uncontrolled retries.** Nothing retries itself. A short-lived
 *     maintenance command may retry a notification that has no successful push
 *     and fewer than `MAX_PUSH_RETRY_ATTEMPTS` recorded attempts, and it never
 *     re-sends a notification that already reached a browser.
 *   - **No duplicate notifications.** A notification row is written once; the
 *     database's partial unique index is the authority.
 *   - **Expired subscriptions are retired.** A provider that reports the
 *     endpoint is gone causes the subscription to be soft-deleted, so the next
 *     delivery does not try it again.
 *   - **Invalid records are cleaned up.** A short-lived maintenance command
 *     removes notifications with no recipient or no event type, and deliveries
 *     that point at a notification that no longer exists.
 */

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

  if (subscriptions.length === 0) {
    // The viewer enabled push but has no live subscription (for example, the
    // browser subscription expired between the preference write and this
    // notification). Recording the attempt keeps the maintenance bounded: the
    // notification is not re-examined forever.
    await recordDelivery(executor, {
      notificationId: notification.id,
      userId: notification.userId,
      channel: 'push',
      success: false,
      errorMessage: 'The viewer has no active browser push subscription.',
    });

    return outcome;
  }

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

  // The bound is enforced by the statement, not by the caller's reading of the
  // result: a delete that removes every expired row and then reports `bounded`
  // would be a lie about how much work it did.
  const result = await executor.execute(sql`
    delete from ${notification_deliveries}
     where id in (
       select d.id
         from ${notification_deliveries} d
        where d.created_at < ${olderThan}
        limit ${bounded}
     )
  `);

  return readAffectedRows(result);
}

/** The outcome of one delivery-maintenance retry round. */
export type NotificationRetryResult = Readonly<{
  /** How many notifications the bounded query examined. */
  considered: number;
  /** How many notifications were attempted again. */
  retried: number;
  /** How many subscriptions accepted a retried message. */
  delivered: number;
}>;

/** One notification claimed by a delivery-maintenance round. */
type PushRetryCandidate = Readonly<{
  id: string;
  user_id: string;
  event_type: string;
}>;

/**
 * Retry the push delivery of notifications that never reached a browser.
 *
 * This is the recovery path for a crash between writing the notification row
 * and delivering its push. It is not a worker and it does not run on its own:
 * a short-lived maintenance command calls it.
 *
 * Four rules keep it bounded and honest:
 *
 *   - It only considers notifications from the last `PUSH_RETRY_WINDOW_DAYS`.
 *   - It never touches a notification that already has a successful push.
 *   - It stops after `MAX_PUSH_RETRY_ATTEMPTS` recorded push attempts.
 *   - It claims its candidates exclusively, so overlapping runs cannot send the
 *     same notification twice.
 *
 * A notification whose recipient has switched push off is skipped without
 * writing an attempt: the viewer's choice is not a failure.
 *
 * @param limit the maximum number of notifications to examine
 * @param executor the database executor
 * @returns what the round did
 */
export async function retryFailedPushDeliveries(
  limit: number = 50,
  executor: DbExecutor = db
): Promise<NotificationRetryResult> {
  const bounded = Math.max(1, Math.min(limit, 200));
  const leaseToken = randomUUID();

  // The claim is one short transaction. The row locks are held while the
  // selected rows receive this run's lease, and `skip locked` lets an
  // overlapping run continue with the other candidates instead of waiting.
  const candidates = await db.transaction(async tx => {
    const result = await tx.execute(sql`
      select n.id, n.user_id, n.event_type
        from ${notifications} n
       where n.deleted_at is null
         and n.created_at >= now() - make_interval(days => ${PUSH_RETRY_WINDOW_DAYS})
         and (n.delivery_lease_until is null or n.delivery_lease_until <= now())
         and exists (
           select 1
             from ${push_subscriptions} s
            where s.user_id = n.user_id
              and s.deleted_at is null
         )
         and not exists (
           select 1
             from ${notification_deliveries} d
            where d.notification_id = n.id
              and d.channel = 'push'
              and d.success = true
         )
         and (
           select count(*)
             from ${notification_deliveries} d
            where d.notification_id = n.id
              and d.channel = 'push'
         ) < ${MAX_PUSH_RETRY_ATTEMPTS}
       order by n.created_at desc
       limit ${bounded}
       for update skip locked
    `);

    const selected = ((result as { rows?: unknown }).rows ?? []) as PushRetryCandidate[];

    if (selected.length > 0) {
      await tx
        .update(notifications)
        .set({
          delivery_lease_until: sql`now() + make_interval(secs => ${DELIVERY_LEASE_SECONDS})`,
          delivery_lease_token: leaseToken,
          updated_at: sql`now()`,
        })
        .where(
          inArray(
            notifications.id,
            selected.map(candidate => candidate.id)
          )
        );
    }

    return selected;
  });

  const outcome: { considered: number; retried: number; delivered: number } = {
    considered: candidates.length,
    retried: 0,
    delivered: 0,
  };

  for (const candidate of candidates) {
    try {
      // The claim and the delivery are separate statements, so another path may
      // have delivered the notification or consumed an attempt after the
      // candidate query. Repeat both rules immediately before sending.
      if (await hasSuccessfulPushDelivery(candidate.id, executor)) {
        continue;
      }

      if (await countPushAttempts(candidate.id, executor) >= MAX_PUSH_RETRY_ATTEMPTS) {
        continue;
      }

      const preferences = await getNotificationPreferences(candidate.user_id, executor);

      if (
        !isDeliveryAllowed(
          preferences,
          candidate.event_type as NotificationEventType,
          'push'
        )
      ) {
        continue;
      }

      outcome.retried += 1;

      const delivery = await deliverPush(candidate.id, executor, preferences);

      outcome.delivered += delivery.delivered;
    } finally {
      // Only the owner releases the claim. If this run's lease expired and
      // another run took the row, the other token stays untouched.
      await executor
        .update(notifications)
        .set({
          delivery_lease_until: null,
          delivery_lease_token: null,
          updated_at: sql`now()`,
        })
        .where(
          and(
            eq(notifications.id, candidate.id),
            eq(notifications.delivery_lease_token, leaseToken)
          )
        );
    }
  }

  return outcome;
}

/** The outcome of one notification-maintenance run. */
export type NotificationMaintenanceResult = Readonly<{
  /** Notifications whose push delivery was attempted again. */
  retried: number;
  /** Subscriptions that accepted a retried message. */
  redelivered: number;
  /** Structurally invalid notifications that were removed. */
  invalidNotifications: number;
  /** Delivery records whose notification no longer exists. */
  orphanedDeliveries: number;
  /** Delivery records older than the retention window. */
  oldDeliveries: number;
}>;

/**
 * Run the notification maintenance once.
 *
 * This is the single entry point of the short-lived maintenance command. It
 * retries undelivered pushes first, then removes the records the policy no
 * longer keeps. Every step is bounded, and the command exits when it is done.
 *
 * @param options the retention cutoff and the per-step bound
 * @param executor the database executor
 * @returns what the run did
 */
export async function runNotificationMaintenance(
  options: { olderThan?: Date; limit?: number } = {},
  executor: DbExecutor = db
): Promise<NotificationMaintenanceResult> {
  const limit = options.limit ?? 1000;
  const olderThan =
    options.olderThan ?? new Date(Date.now() - DELIVERY_RETENTION_DAYS * 86_400_000);

  const retry = await retryFailedPushDeliveries(Math.min(limit, 200), executor);
  const invalidNotifications = await deleteInvalidNotifications(limit, executor);
  const orphanedDeliveries = await deleteOrphanedDeliveries(limit, executor);
  const oldDeliveries = await deleteOldDeliveries(olderThan, limit, executor);

  return {
    retried: retry.retried,
    redelivered: retry.delivered,
    invalidNotifications,
    orphanedDeliveries,
    oldDeliveries,
  };
}
