import 'server-only';

import { and, count, eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { notification_deliveries } from './schema';

/**
 * The delivery record writer (Prompt 154).
 *
 * Every delivery attempt leaves a record: which notification it was for, who
 * it was for, which channel it used, and whether it worked. The record is the
 * platform's honest account of what happened — a failed attempt is recorded as
 * a failure, never as a delivery.
 *
 * This lives in its own file so that the notification writer and the push
 * delivery path can both record a delivery without importing each other.
 */

/** The delivery channels a record can name. */
export type DeliveryChannel = 'in_app' | 'push';

/** One delivery record to write. */
export type DeliveryRecordInput = {
  /** The notification the delivery was for. */
  notificationId: string;
  /** The recipient. Always a real account identifier. */
  userId: string;
  /** The channel the delivery used. */
  channel: DeliveryChannel;
  /** Whether the delivery succeeded. */
  success: boolean;
  /** A short, credential-free description of a failure. */
  errorMessage: string | null;
  /** The subscription the push went to, when there was one. */
  subscriptionId?: string | null;
};

/**
 * Write one delivery record.
 *
 * @param executor the database executor
 * @param input the delivery record
 */
export async function recordDelivery(
  executor: DbExecutor,
  input: DeliveryRecordInput
): Promise<void> {
  await executor.insert(notification_deliveries).values({
    notification_id: input.notificationId,
    user_id: input.userId,
    channel: input.channel,
    success: input.success,
    error_message: input.errorMessage,
    subscription_id: input.subscriptionId ?? null,
    delivered_at: sql`now()`,
  });
}

/**
 * Has this notification already been pushed successfully?
 *
 * The delivery maintenance uses this to keep its promise: a notification that
 * reached a browser once is never pushed again, no matter how many times the
 * maintenance command runs.
 *
 * @param notificationId the notification
 * @param executor the database executor
 * @returns whether a successful push delivery exists
 */
export async function hasSuccessfulPushDelivery(
  notificationId: string,
  executor: DbExecutor = db
): Promise<boolean> {
  const [row] = await executor
    .select({ id: notification_deliveries.id })
    .from(notification_deliveries)
    .where(
      and(
        eq(notification_deliveries.notification_id, notificationId),
        eq(notification_deliveries.channel, 'push'),
        eq(notification_deliveries.success, true)
      )
    )
    .limit(1);

  return row !== undefined;
}

/**
 * How many push attempts this notification has had.
 *
 * The count bounds the delivery maintenance: a notification that failed three
 * times is not attempted a fourth time.
 *
 * @param notificationId the notification
 * @param executor the database executor
 * @returns the number of recorded push attempts
 */
export async function countPushAttempts(
  notificationId: string,
  executor: DbExecutor = db
): Promise<number> {
  const [row] = await executor
    .select({ total: count() })
    .from(notification_deliveries)
    .where(
      and(
        eq(notification_deliveries.notification_id, notificationId),
        eq(notification_deliveries.channel, 'push')
      )
    );

  return Number(row?.total ?? 0);
}

/**
 * The delivery history of one notification.
 *
 * The error detail is useful but bounded: a message that grew without limit
 * would turn the table into a log file.
 *
 * @param notificationId the notification
 * @param executor the database executor
 * @returns the delivery records, newest first
 */
export async function listDeliveries(
  notificationId: string,
  executor: DbExecutor = db
): Promise<
  Array<{
    id: string;
    channel: string;
    success: boolean;
    errorMessage: string | null;
    deliveredAt: Date | null;
    createdAt: Date;
  }>
> {
  const rows = await executor
    .select({
      id: notification_deliveries.id,
      channel: notification_deliveries.channel,
      success: notification_deliveries.success,
      errorMessage: notification_deliveries.error_message,
      deliveredAt: notification_deliveries.delivered_at,
      createdAt: notification_deliveries.created_at,
    })
    .from(notification_deliveries)
    .where(eq(notification_deliveries.notification_id, notificationId))
    .orderBy(sql`${notification_deliveries.created_at} desc`);

  return rows.map(row => ({
    ...row,
    success: row.success === true,
    errorMessage: row.errorMessage === null ? null : row.errorMessage.slice(0, 500),
  }));
}
