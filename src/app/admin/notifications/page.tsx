import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { AdminNotificationList } from '@/components/admin/notifications/admin-notification-list';
import { AnnouncementAdmin } from '@/components/admin/notifications/announcement-admin';
import { toAdminNotificationViewer } from '@/lib/admin-notification-viewer';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import {
  ADMIN_NOTIFICATION_CATEGORIES,
  countUnreadAdminNotifications,
  listAdminNotifications,
  listAnnouncements,
} from '@/modules/notifications';

import { requireAdminPageAccess } from '../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/notifications';

/**
 * The administrator notification centre (Prompts 153 / D-067).
 *
 * Two surfaces share this page, and they are authorized separately:
 *
 *   - **Alerts** (content reports, failed announcements, security events) are
 *     read by an administrator with `admin.manage`. Every read is filtered by
 *     the alert's audience on the server.
 *   - **Announcements** are written and published by an administrator with
 *     `settings.manage`.
 *
 * Either permission opens the page; neither permission opens the other's
 * surface. A layout bypass cannot leave either surface open, because the page
 * checks the canonical permission itself.
 */
export default async function AdminNotificationsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  const viewer = toAdminNotificationViewer(actor);
  const canManageAnnouncements = hasPermission(actor, toPermissionKey('settings', 'manage'));

  if (viewer === null && !canManageAnnouncements) {
    notFound();
  }

  const raw = await searchParams;
  const rawCategory = typeof raw.category === 'string' ? raw.category : null;
  const category =
    rawCategory !== null &&
    (ADMIN_NOTIFICATION_CATEGORIES as readonly string[]).includes(rawCategory)
      ? rawCategory
      : null;

  const requestedPage = typeof raw.page === 'string' ? Number.parseInt(raw.page, 10) : 1;
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const alertPage =
    viewer === null
      ? null
      : await listAdminNotifications(viewer, { category, page });
  const unread = viewer === null ? 0 : await countUnreadAdminNotifications(viewer);
  const announcements = canManageAnnouncements ? await listAnnouncements() : [];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Alerts are addressed to the administrators who need to act on them. Announcements are
          delivered to the viewers when you publish them; there is no scheduled publication.
        </p>
      </header>

      {alertPage !== null ? (
        <section aria-labelledby="admin-alerts-heading" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="admin-alerts-heading" className="text-base font-medium text-foreground">
              Alerts
            </h2>
            <p className="text-sm text-muted-foreground">
              {unread === 0 ? 'Nothing unread.' : `${unread} unread.`}
            </p>
          </div>

          <AdminNotificationList
            page={alertPage}
            category={category}
            categories={ADMIN_NOTIFICATION_CATEGORIES}
          />
        </section>
      ) : null}

      {canManageAnnouncements ? (
        <section aria-labelledby="admin-announcements-heading" className="space-y-3">
          <h2 id="admin-announcements-heading" className="text-base font-medium text-foreground">
            Announcements
          </h2>
          <AnnouncementAdmin announcements={announcements} />
        </section>
      ) : null}
    </div>
  );
}
