import type { JSX } from 'react';
import Link from 'next/link';
import { LogIn, Settings } from 'lucide-react';

import { EmptyState, PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { NotificationPreferencesForm } from '@/components/notifications/notification-preferences-form';
import { PushNotificationOptIn } from '@/components/notifications/push-notification-opt-in';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { resolveActor } from '@/modules/authorization';
import {
  getBrowserPushPublicKey,
  getNotificationPreferences,
  listSubscriptions,
} from '@/modules/notifications';

export const dynamic = 'force-dynamic';

/**
 * The notification preferences page (Prompt 150).
 *
 * The page shows the viewer's own preferences, the viewer's own browser push
 * subscriptions, and the push opt-in. The account/security notifications have
 * no switch: they are mandatory, so the page says so rather than offering a
 * control that would do nothing.
 */
export default async function NotificationPreferencesPage(): Promise<JSX.Element> {
  const actor = await resolveActor();

  if (actor.userId === null) {
    return (
      <PublicPageLayout title="Notification preferences">
        <div className="space-y-10">
          <PageHeader
            eyebrow="Your account"
            title="Notification preferences"
            description="Choose which events reach you, and which channels may carry them. Your choices follow your account."
          />

          <EmptyState
            icon={Settings}
            title="Sign in to change your notification preferences"
            description="Notification preferences belong to your account, so they are available on any device you sign in from."
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

  const [preferences, subscriptions] = await Promise.all([
    getNotificationPreferences(actor.userId),
    listSubscriptions(actor.userId),
  ]);

  return (
    <PublicPageLayout title="Notification preferences">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Your account"
          title="Notification preferences"
          description="Choose which events reach you, and which channels may carry them. Your choices follow your account."
        />

        <NotificationPreferencesForm preferences={preferences} />

        <PushNotificationOptIn
          publicKey={getBrowserPushPublicKey()}
          subscriptions={subscriptions}
        />
      </div>
    </PublicPageLayout>
  );
}
