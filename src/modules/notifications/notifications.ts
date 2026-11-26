import 'server-only';

import { sql } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import {
  isDeliveryAllowed,
  isEventAllowed,
  type NotificationPreferenceSet,
} from './delivery-rules';
import { recordDelivery } from './delivery-records';
import { getNotificationPreferences } from './preferences';
import { notifications } from './schema';

/**
 * In-app notifications.
 *
 * The module owns the notification rows. Callers pass a validated payload
 * snapshot — the recipient, the title, the body, and a deep link — and the
 * module decides whether the recipient wants to hear about it.
 *
 * Two decisions live here, and they are deliberately separate:
 *
 *   1. **The event preference** decides whether the event is wanted at all.
 *      When it is off, no row is written and nothing is delivered.
 *   2. **The global channel switches** decide how the event is delivered. The
 *      in-app switch governs the notification centre; the push switch governs
 *      browser push. A viewer who muted the centre can still receive push, so
 *      the row is written either way and the delivery records say honestly
 *      which channel carried it.
 *
 * Account/security notifications and moderation outcomes are mandatory: no
 * switch withholds them.
 */

/** The event types this module can record. */
export const NOTIFICATION_EVENT_TYPES = [
  'new_episode',
  'new_drama',
  'new_drama_season',
  'website_announcement',
  'account_security',
  'review_report_resolved',
  'content_report_resolved',
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

/** A notification to create. */
export type NotificationInput = {
  /** The recipient. */
  userId: string;
  title: string;
  content: string;
  eventType: NotificationEventType;
  /** The content the notification is about, when there is one. */
  contentId?: string | null;
  contentType?: string | null;
  /** A deep link into the site. */
  link?: string | null;
  priority?: 'normal' | 'high';
};

/**
 * Does the recipient want to receive this event?
 *
 * The answer is the event preference alone. The global channel switches do
 * not take part: they decide *where* a wanted event is delivered, not whether
 * the viewer wants to hear about it at all.
 *
 * @param userId the recipient
 * @param eventType the event
 * @param executor the database executor
 * @returns whether the event is wanted
 */
export async function acceptsNotification(
  userId: string,
  eventType: NotificationEventType,
  executor: DbExecutor = db
): Promise<boolean> {
  const preferences = await getNotificationPreferences(userId, executor);

  return isEventAllowed(preferences, eventType);
}

/**
 * Create one in-app notification.
 *
 * Returns the created row, or `null` when the recipient switched this event
 * off. The row is written inside the caller's executor, so a workflow can
 * create the notification in the same transaction as the state change it
 * announces.
 *
 * @param input the notification
 * @param executor the database executor
 * @returns the created row, or `null` when the event is not wanted
 */
export async function createNotification(
  input: NotificationInput,
  executor: DbExecutor = db
): Promise<{ id: string } | null> {
  const preferences = await getNotificationPreferences(input.userId, executor);

  return writeNotification(input, preferences, executor);
}

/**
 * What happened to a notification write.
 *
 * `duplicate` is distinct from `not_wanted` on purpose: a repeated publication
 * is not a viewer's preference, and the broadcast counters report them
 * separately. The distinction is only possible because the database, not a
 * read-then-write, decides whether the row is new.
 */
export type NotificationWriteOutcome =
  | Readonly<{ status: 'created'; id: string }>
  | Readonly<{ status: 'duplicate' }>
  | Readonly<{ status: 'not_wanted' }>;

/**
 * Write one notification for a recipient whose preferences are already known.
 *
 * The broadcast paths read every recipient's preferences in one query, so they
 * hand them in instead of making every recipient pay for a second read.
 *
 * @param input the notification
 * @param preferences the recipient's preference set
 * @param executor the database executor
 * @returns the created row, or `null` when the event is not wanted or already exists
 */
export async function writeNotification(
  input: NotificationInput,
  preferences: NotificationPreferenceSet,
  executor: DbExecutor = db
): Promise<{ id: string } | null> {
  const outcome = await writeNotificationOnce(input, preferences, executor);

  return outcome.status === 'created' ? { id: outcome.id } : null;
}

/**
 * Write one notification exactly once.
 *
 * The insert carries `ON CONFLICT DO NOTHING`, and the partial unique index
 * `uq_notifications_user_event_content` is the authority on whether a
 * notification already exists. Two concurrent publication retries therefore
 * cannot both write the same notification: one insert wins and the other
 * reports `duplicate`. A read-then-write check alone could not promise that.
 *
 * A notification without a content id (an account/security event) has no
 * natural de-duplication key and is never collapsed.
 *
 * @param input the notification
 * @param preferences the recipient's preference set
 * @param executor the database executor
 * @returns whether the row was created, already existed, or is not wanted
 */
export async function writeNotificationOnce(
  input: NotificationInput,
  preferences: NotificationPreferenceSet,
  executor: DbExecutor = db
): Promise<NotificationWriteOutcome> {
  if (!isEventAllowed(preferences, input.eventType)) {
    return { status: 'not_wanted' };
  }

  const inAppDelivered = isDeliveryAllowed(preferences, input.eventType, 'in_app');

  const [row] = await executor
    .insert(notifications)
    .values({
      user_id: input.userId,
      title: input.title,
      content: input.content,
      event_type: input.eventType,
      content_id: input.contentId ?? null,
      content_type: input.contentType ?? null,
      link: input.link ?? null,
      priority: input.priority ?? 'normal',
      is_read: false,
      delivered: inAppDelivered,
      delivery_timestamp: inAppDelivered ? sql`now()` : null,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });

  if (!row) {
    return { status: 'duplicate' };
  }

  if (inAppDelivered) {
    await recordDelivery(executor, {
      notificationId: row.id,
      userId: input.userId,
      channel: 'in_app',
      success: true,
      errorMessage: null,
    });
  }

  return { status: 'created', id: row.id };
}

/**
 * Tell a viewer about an account or security change.
 *
 * These notifications are mandatory (D-005): no preference switch withholds
 * them, and they are always delivered in the app. The wording comes from the
 * caller, because the platform only announces the events it actually
 * records — it never promises a Google-side security event it cannot detect.
 *
 * @param input the notification
 * @param executor the database executor
 * @returns the created row, or `null` when nothing was written
 */
export async function notifyAccountSecurity(
  input: {
    /** The account the event happened to. */
    userId: string;
    title: string;
    content: string;
    /** The deep link back to the account area, when there is one. */
    link?: string | null;
    contentId?: string | null;
    contentType?: string | null;
  },
  executor: DbExecutor = db
): Promise<{ id: string } | null> {
  return createNotification(
    {
      userId: input.userId,
      title: input.title,
      content: input.content,
      eventType: 'account_security',
      contentId: input.contentId ?? null,
      contentType: input.contentType ?? null,
      link: input.link ?? null,
      priority: 'high',
    },
    executor
  );
}

/**
 * Tell a reporter what happened to the report they filed.
 *
 * The outcome is written verbatim: a reporter learns what a moderator decided,
 * not a generic "your report was handled" message.
 *
 * A review report and a content report are two different promises, so they are
 * two different events. The event type is part of the de-duplication key, so a
 * report that is resolved twice cannot produce a second notification.
 *
 * @param input the reporter, the outcome, and the event
 * @param executor the database executor
 * @returns the created row, or `null` when nothing was written
 */
export async function notifyReporter(
  input: {
    reporterUserId: string;
    resolutionOutcome: string;
    /** Which promise the platform made: a review report or a content report. */
    eventType?: Extract<
      NotificationEventType,
      'review_report_resolved' | 'content_report_resolved'
    >;
    /** The deep link back to the reported item, when there is one. */
    link?: string | null;
    contentId?: string | null;
    contentType?: string | null;
  },
  executor: DbExecutor = db
): Promise<{ id: string } | null> {
  return createNotification(
    {
      userId: input.reporterUserId,
      title: 'Your report was reviewed',
      content: input.resolutionOutcome,
      eventType: input.eventType ?? 'review_report_resolved',
      contentId: input.contentId ?? null,
      contentType: input.contentType ?? null,
      link: input.link ?? null,
    },
    executor
  );
}
