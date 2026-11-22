import 'server-only';

import { and, count, eq } from 'drizzle-orm';

import { db } from '@/db/client';

import { admin_notifications, notifications } from './schema';

/**
 * Notifications that reference a content item follow the item when it changes
 * type. Only rows explicitly typed as `drama` are migrated; a `NULL` type is
 * never guessed.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = Tx | typeof db;

export type NotificationContentReferenceCounts = {
  notifications: number;
  adminNotifications: number;
};

/** Count notification rows that point at a drama. */
export async function countContentReferences(
  tx: DbOrTx,
  dramaId: string
): Promise<NotificationContentReferenceCounts> {
  // The queries run one after the other: a transaction uses a single
  // PostgreSQL connection, and the driver does not accept two queries on the
  // same connection at the same time.
  const [notificationRow] = await tx
    .select({ total: count() })
    .from(notifications)
    .where(
      and(eq(notifications.content_type, 'drama'), eq(notifications.content_id, dramaId))
    );
  const [adminRow] = await tx
    .select({ total: count() })
    .from(admin_notifications)
    .where(
      and(
        eq(admin_notifications.content_type, 'drama'),
        eq(admin_notifications.content_id, dramaId)
      )
    );

  return {
    notifications: Number(notificationRow?.total ?? 0),
    adminNotifications: Number(adminRow?.total ?? 0),
  };
}

/** Move notification references from the drama to the movie. */
export async function moveContentReferences(
  tx: Tx,
  dramaId: string,
  movieId: string
): Promise<void> {
  await tx
    .update(notifications)
    .set({ content_type: 'movie', content_id: movieId })
    .where(and(eq(notifications.content_type, 'drama'), eq(notifications.content_id, dramaId)));

  await tx
    .update(admin_notifications)
    .set({ content_type: 'movie', content_id: movieId })
    .where(
      and(
        eq(admin_notifications.content_type, 'drama'),
        eq(admin_notifications.content_id, dramaId)
      )
    );
}

/**
 * Remove the notifications that point at content that is being permanently
 * deleted.
 *
 * A notification about a content item that no longer exists can only mislead a
 * reader, so it is removed with the content. Notifications with no content
 * type are never guessed and are left alone.
 */
export async function purgeContentReferences(
  tx: Tx,
  type: 'drama' | 'movie',
  id: string
): Promise<NotificationContentReferenceCounts> {
  const notificationRows = await tx
    .delete(notifications)
    .where(and(eq(notifications.content_type, type), eq(notifications.content_id, id)))
    .returning({ id: notifications.id });

  const adminRows = await tx
    .delete(admin_notifications)
    .where(and(eq(admin_notifications.content_type, type), eq(admin_notifications.content_id, id)))
    .returning({ id: admin_notifications.id });

  return {
    notifications: notificationRows.length,
    adminNotifications: adminRows.length,
  };
}

/**
 * Count the notifications that point at one content item.
 *
 * Used by the Trash surface to show the consequences of a permanent deletion
 * before the administrator confirms it.
 */
export async function countPurgeImpact(
  tx: DbOrTx,
  type: 'drama' | 'movie',
  id: string
): Promise<NotificationContentReferenceCounts> {
  // The queries run one after the other: a transaction uses a single
  // PostgreSQL connection, and the driver does not accept two queries on the
  // same connection at the same time.
  const [notificationRow] = await tx
    .select({ total: count() })
    .from(notifications)
    .where(and(eq(notifications.content_type, type), eq(notifications.content_id, id)));
  const [adminRow] = await tx
    .select({ total: count() })
    .from(admin_notifications)
    .where(
      and(eq(admin_notifications.content_type, type), eq(admin_notifications.content_id, id))
    );

  return {
    notifications: Number(notificationRow?.total ?? 0),
    adminNotifications: Number(adminRow?.total ?? 0),
  };
}
