import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { AdminNotificationDetail } from '@/components/admin/notifications/admin-notification-detail';
import { toAdminNotificationViewer } from '@/lib/admin-notification-viewer';
import { getAdminNotification } from '@/modules/notifications';

import { requireAdminPageAccess } from '../../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/notifications';
const idSchema = z.string().uuid();

/**
 * One administrator alert (D-067).
 *
 * The audience rule is applied by `getAdminNotification`: an alert the viewer
 * may not see and an alert that does not exist produce the same 404.
 */
export default async function AdminNotificationDetailPage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);
  const viewer = toAdminNotificationViewer(actor);

  if (viewer === null) {
    notFound();
  }

  const { id } = await params;

  if (!idSchema.safeParse(id).success) {
    notFound();
  }

  const notification = await getAdminNotification(viewer, id);

  if (notification === null) {
    notFound();
  }

  return <AdminNotificationDetail notification={notification} />;
}
