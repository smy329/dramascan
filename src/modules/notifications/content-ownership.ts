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
  const [[notificationRow], [adminRow]] = await Promise.all([
    tx
      .select({ total: count() })
      .from(notifications)
      .where(
        and(eq(notifications.content_type, 'drama'), eq(notifications.content_id, dramaId))
      ),
    tx
      .select({ total: count() })
      .from(admin_notifications)
      .where(
        and(
          eq(admin_notifications.content_type, 'drama'),
          eq(admin_notifications.content_id, dramaId)
        )
      ),
  ]);

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
