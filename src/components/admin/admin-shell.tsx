'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { Dialog } from '@/components/ui/dialog';
import { AdminHeader } from './admin-header';
import { AdminSidebar } from './admin-sidebar';
import type { AdminBreadcrumb } from './breadcrumbs';
import type { AdminNavGroup } from './navigation';

export type AdminShellUser = Readonly<{
  name: string;
  email: string;
}>;

type AdminShellProps = Readonly<{
  navigation: readonly AdminNavGroup[];
  breadcrumbs: readonly AdminBreadcrumb[];
  user: AdminShellUser;
  children: ReactNode;
}>;

/**
 * Client-side admin chrome.
 *
 * This component performs no authorization: it renders only the navigation the
 * server already permitted. It owns the mobile drawer state and closes the
 * drawer whenever the route changes.
 */
export function AdminShell({ navigation, breadcrumbs, user, children }: AdminShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
      <div className="min-h-screen bg-background">
        <AdminSidebar navigation={navigation} pathname={pathname} />
        <div className="lg:pl-64">
          <AdminHeader breadcrumbs={breadcrumbs} user={user} />
          <main id="main-content" className="p-4 sm:p-6 lg:p-8">
            {children}
          </main>
        </div>
      </div>
    </Dialog>
  );
}
