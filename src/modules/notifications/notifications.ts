import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { notification_preferences, notifications } from './schema';

/**
 * In-app notifications.
 *
 * The module owns the notification rows. Callers pass a validated payload
 * snapshot — the recipient, the title, the body, and a deep link — and the
 * module decides whether the recipient wants to hear about it.
 */

/** The event types this module can record. */
export const NOTIFICATION_EVENT_TYPES = [
  'new_episode',
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
 * The event types a viewer can switch off.
 *
 * Moderation outcomes are deliberately absent: the platform promised to tell a
 * reporter what happened to their report, and a preference switch must not be
 * able to swallow that answer.
 */
const PREFERENCE_GATED_EVENT_TYPES: ReadonlySet<NotificationEventType> = new Set([
  'new_episode',
  'new_drama_season',
  'website_announcement',
]);

/**
 * Does the recipient want to receive this event?
 *
 * The global switch and the event preference both have to be on. A missing
 * preference row means the default: on.
 */
export async function acceptsNotification(
  userId: string,
  eventType: NotificationEventType,
  executor: DbExecutor = db
): Promise<boolean> {
  if (!PREFERENCE_GATED_EVENT_TYPES.has(eventType)) {
    return true;
  }

  const [preference] = await executor
    .select({
      globalInApp: notification_preferences.global_in_app,
      newEpisode: notification_preferences.new_episode,
      newDramaSeason: notification_preferences.new_drama_season,
      websiteAnnouncement: notification_preferences.website_announcement,
    })
    .from(notification_preferences)
    .where(eq(notification_preferences.user_id, userId))
    .limit(1);

  if (!preference) {
    return true;
  }

  if (preference.globalInApp === false) {
    return false;
  }

  if (eventType === 'new_episode') {
    return preference.newEpisode !== false;
  }

  if (eventType === 'new_drama_season') {
    return preference.newDramaSeason !== false;
  }

  return preference.websiteAnnouncement !== false;
}

/**
 * Create one in-app notification.
 *
 * Returns the created row, or `null` when the recipient switched this event
 * off. The row is written inside the caller's executor, so a workflow can
 * create the notification in the same transaction as the state change it
 * announces.
 */
export async function createNotification(
  input: NotificationInput,
  executor: DbExecutor = db
): Promise<{ id: string } | null> {
  if (!await acceptsNotification(input.userId, input.eventType, executor)) {
    return null;
  }

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
      delivered: false,
    })
    .returning({ id: notifications.id });

  return row ?? null;
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
