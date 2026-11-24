import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { AnnouncementAdmin } from '@/components/admin/notifications/announcement-admin';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { listAnnouncements } from '@/modules/notifications';

import { requireAdminPageAccess } from '../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/notifications';

/**
 * The announcement administration page (Prompt 153).
 *
 * The page lists the recent announcements and hands them to the administration
 * component, which creates drafts and publishes them. The permission is
 * checked on the server: the navigation is never the boundary.
 */
export default async function AdminNotificationsPage(): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  if (!hasPermission(actor, toPermissionKey('settings', 'manage'))) {
    notFound();
  }

  const announcements = await listAnnouncements();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Announcements are delivered to the viewers when you publish them. There is no scheduled
          publication.
        </p>
      </header>

      <AnnouncementAdmin announcements={announcements} />
    </div>
  );
}
