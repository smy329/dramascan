import 'server-only';

import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { MANDATORY_EVENT_TYPES } from './delivery-rules';
import type { NotificationCenter } from './notification-center.shared';
import { getNotificationPreferences } from './preferences';
import { notifications } from './schema';

/**
 * The in-app notification center (Prompt 149).
 *
 * Every read is scoped to one viewer. A notification is private to the person
 * it was written for: the bell icon shows the viewer's own unread count, and
 * the history shows the viewer's own notifications. There is no path that
 * returns another viewer's notifications.
 */

/** The maximum number of notifications one page may return. */
export const NOTIFICATION_PAGE_SIZE = 50;

export type { NotificationCenter, NotificationView } from './notification-center.shared';

/**
 * Read a viewer's notification center.
 *
 * @param userId the viewer
 * @param limit the maximum number of notifications to return
 * @param executor the database executor
 * @returns the notification center
 */
export async function getNotificationCenter(
  userId: string,
  limit: number = NOTIFICATION_PAGE_SIZE,
  executor: DbExecutor = db
): Promise<NotificationCenter> {
  const bounded = Math.max(1, Math.min(limit, NOTIFICATION_PAGE_SIZE));
  const visible = await visibleNotificationFilter(userId, executor);

  const rows = await executor
    .select({
      id: notifications.id,
      title: notifications.title,
      content: notifications.content,
      eventType: notifications.event_type,
      contentId: notifications.content_id,
      contentType: notifications.content_type,
      link: notifications.link,
      priority: notifications.priority,
      isRead: notifications.is_read,
      readAt: notifications.read_at,
      createdAt: notifications.created_at,
    })
    .from(notifications)
    .where(
      and(
        eq(notifications.user_id, userId),
        isNull(notifications.deleted_at),
        visible
      )
    )
    .orderBy(desc(notifications.created_at), desc(notifications.id))
    .limit(bounded);

  const [unread] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.user_id, userId),
        eq(notifications.is_read, false),
        isNull(notifications.deleted_at),
        visible
      )
    );

  const [total] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.user_id, userId),
        isNull(notifications.deleted_at),
        visible
      )
    );

  return {
    notifications: rows.map(row => ({
      ...row,
      priority: row.priority ?? 'normal',
      isRead: row.isRead === true,
    })),
    unreadCount: Number(unread?.count ?? 0),
    totalCount: Number(total?.count ?? 0),
  };
}

/**
 * The filter that decides which of the viewer's notifications the centre
 * shows.
 *
 * The global in-app switch governs the centre. When it is off, only the
 * mandatory notifications stay visible: an account/security notification or a
 * moderation outcome is never withheld by a switch.
 *
 * @param userId the viewer
 * @param executor the database executor
 * @returns the filter, or `undefined` when every notification is visible
 */
async function visibleNotificationFilter(
  userId: string,
  executor: DbExecutor
): Promise<SQL | undefined> {
  const preferences = await getNotificationPreferences(userId, executor);

  if (preferences.globalInApp) {
    return undefined;
  }

  return inArray(notifications.event_type, [...MANDATORY_EVENT_TYPES]);
}

/**
 * How many notifications the viewer has not read.
 *
 * The bell icon reads this one number. It is a `count(*)` over an indexed
 * filter, so it stays cheap even for a viewer with a long history.
 *
 * @param userId the viewer
 * @param executor the database executor
 * @returns the unread count
 */
export async function getUnreadNotificationCount(
  userId: string,
  executor: DbExecutor = db
): Promise<number> {
  const visible = await visibleNotificationFilter(userId, executor);

  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(
      and(
        eq(notifications.user_id, userId),
        eq(notifications.is_read, false),
        isNull(notifications.deleted_at),
        visible
      )
    );

  return Number(row?.count ?? 0);
}

/**
 * Mark one notification as read.
 *
 * The notification must belong to the viewer: the write is scoped by
 * `user_id`, so a guessed identifier cannot mark somebody else's notification.
 *
 * @param userId the viewer
 * @param notificationId the notification
 * @param executor the database executor
 * @returns whether the notification was marked
 */
export async function markNotificationRead(
  userId: string,
  notificationId: string,
  executor: DbExecutor = db
): Promise<boolean> {
  const result = await executor
    .update(notifications)
    .set({ is_read: true, read_at: sql`now()`, updated_at: sql`now()` })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.user_id, userId),
        isNull(notifications.deleted_at)
      )
    )
    .returning({ id: notifications.id });

  return result.length > 0;
}

/**
 * Mark every one of the viewer's notifications as read.
 *
 * @param userId the viewer
 * @param executor the database executor
 * @returns how many notifications were marked
 */
export async function markAllNotificationsRead(
  userId: string,
  executor: DbExecutor = db
): Promise<number> {
  const result = await executor
    .update(notifications)
    .set({ is_read: true, read_at: sql`now()`, updated_at: sql`now()` })
    .where(
      and(
        eq(notifications.user_id, userId),
        eq(notifications.is_read, false),
        isNull(notifications.deleted_at)
      )
    )
    .returning({ id: notifications.id });

  return result.length;
}

/**
 * Remove one of the viewer's notifications from the center.
 *
 * @param userId the viewer
 * @param notificationId the notification
 * @param executor the database executor
 * @returns whether the notification was removed
 */
export async function dismissNotification(
  userId: string,
  notificationId: string,
  executor: DbExecutor = db
): Promise<boolean> {
  const result = await executor
    .update(notifications)
    .set({ deleted_at: sql`now()`, updated_at: sql`now()` })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.user_id, userId),
        isNull(notifications.deleted_at)
      )
    )
    .returning({ id: notifications.id });

  return result.length > 0;
}

/**
 * Does a notification already exist for this viewer and this subject?
 *
 * The check is what keeps a repeated publication request from producing a
 * second notification (Prompts 152, 154).
 *
 * @param userId the recipient
 * @param eventType the event type
 * @param contentId the content the notification is about
 * @param executor the database executor
 * @returns whether such a notification already exists
 */
export async function hasNotificationFor(
  userId: string,
  eventType: string,
  contentId: string | null,
  executor: DbExecutor = db
): Promise<boolean> {
  if (contentId === null) {
    const [row] = await executor
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.user_id, userId),
          eq(notifications.event_type, eventType),
          isNull(notifications.content_id),
          isNull(notifications.deleted_at)
        )
      )
      .limit(1);

    return row !== undefined;
  }

  const [row] = await executor
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.user_id, userId),
        eq(notifications.event_type, eventType),
        eq(notifications.content_id, contentId),
        isNull(notifications.deleted_at)
      )
    )
    .limit(1);

  return row !== undefined;
}

/**
 * The identifiers of the notifications a viewer has already received for a
 * set of content items.
 *
 * This is the bulk form of `hasNotificationFor`: one query answers "who has
 * already been told about this?" for a whole audience.
 *
 * @param userIds the recipients
 * @param eventType the event type
 * @param contentId the content the notification is about
 * @param executor the database executor
 * @returns the identifiers of the viewers who already have the notification
 */
export async function listAlreadyNotifiedUsers(
  userIds: readonly string[],
  eventType: string,
  contentId: string,
  executor: DbExecutor = db
): Promise<Set<string>> {
  if (userIds.length === 0) {
    return new Set();
  }

  const rows = await executor
    .select({ userId: notifications.user_id })
    .from(notifications)
    .where(
      and(
        inArray(notifications.user_id, [...userIds]),
        eq(notifications.event_type, eventType),
        eq(notifications.content_id, contentId),
        isNull(notifications.deleted_at)
      )
    );

  return new Set(rows.map(row => row.userId));
}
