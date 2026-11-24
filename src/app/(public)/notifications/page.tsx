import type { JSX } from 'react';
import Link from 'next/link';
import { BellOff, LogIn } from 'lucide-react';

import { EmptyState, PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { NotificationCenterList } from '@/components/notifications/notification-center-list';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { resolveActor } from '@/modules/authorization';
import { getNotificationCenter } from '@/modules/notifications';

export const dynamic = 'force-dynamic';

/**
 * The notification centre (Prompt 149).
 *
 * The page shows one viewer their own notifications and nothing else. The read
 * is scoped to the viewer's account id on the server, so the page cannot be
 * pointed at somebody else's history.
 */
export default async function NotificationsPage(): Promise<JSX.Element> {
  const actor = await resolveActor();

  if (actor.userId === null) {
    return (
      <PublicPageLayout title="Notifications">
        <div className="space-y-10">
          <PageHeader
            eyebrow="Your account"
            title="Notifications"
            description="New episodes of the dramas you follow, newly published titles, and website announcements appear here."
          />

          <EmptyState
            icon={BellOff}
            title="Sign in to see your notifications"
            description="Notifications follow your account, so they are available on any device you sign in from."
          >
            <Link
              href="/auth/signin"
              className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'gap-2')}
            >
              <LogIn className="size-3.5" aria-hidden="true" />
              Sign in
            </Link>
          </EmptyState>
        </div>
      </PublicPageLayout>
    );
  }

  const center = await getNotificationCenter(actor.userId);

  return (
    <PublicPageLayout title="Notifications">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Your account"
          title="Notifications"
          description="New episodes of the dramas you follow, newly published titles, and website announcements appear here."
        />

        <NotificationCenterList
          notifications={center.notifications}
          unreadCount={center.unreadCount}
          totalCount={center.totalCount}
        />
      </div>
    </PublicPageLayout>
  );
}
