import type { ReactNode } from 'react';

import { AdminShell } from '@/components/admin/admin-shell';
import { ADMIN_NAVIGATION, filterAdminNavigation } from '@/components/admin/navigation';
import { requireAdminPageAccess } from './_access';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { actor, user } = await requireAdminPageAccess('/admin');
  const navigation = filterAdminNavigation(ADMIN_NAVIGATION, actor);

  return (
    <AdminShell navigation={navigation} user={user}>
      {children}
    </AdminShell>
  );
}
