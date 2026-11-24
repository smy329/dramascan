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
 * Write one notification for a recipient whose preferences are already known.
 *
 * The broadcast paths read every recipient's preferences in one query, so they
 * hand them in instead of making every recipient pay for a second read.
 *
 * @param input the notification
 * @param preferences the recipient's preference set
 * @param executor the database executor
 * @returns the created row, or `null` when the event is not wanted
 */
export async function writeNotification(
  input: NotificationInput,
  preferences: NotificationPreferenceSet,
  executor: DbExecutor = db
): Promise<{ id: string } | null> {
  if (!isEventAllowed(preferences, input.eventType)) {
    return null;
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
    .returning({ id: notifications.id });

  if (!row) {
    return null;
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

  return row;
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
 * Tell a reporter what happened to the review they reported.
 *
 * The outcome is written verbatim: a reporter learns what a moderator decided,
 * not a generic "your report was handled" message.
 */
export async function notifyReporter(
  input: {
    reporterUserId: string;
    resolutionOutcome: string;
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
      eventType: 'review_report_resolved',
      contentId: input.contentId ?? null,
      contentType: input.contentType ?? null,
      link: input.link ?? null,
    },
    executor
  );
}
