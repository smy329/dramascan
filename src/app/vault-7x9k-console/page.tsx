import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { sanitizeAdminCallback } from '@/lib/redirects';
import { resolveActor } from '@/modules/authorization';
import { SuperAdminSignInForm } from './super-admin-sign-in-form';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Super Admin sign in',
  robots: { index: false, follow: false },
};

type SuperAdminSignInPageProps = {
  searchParams: Promise<{ callbackUrl?: string }>;
};

/**
 * Dedicated Super Admin email/password entry point.
 *
 * Deliberately not linked from public or admin navigation, and not indexable.
 * Session validation is server-side: an existing Super Admin is forwarded into
 * the admin area, and any other signed-in account returns to its dashboard.
 */
export default async function SuperAdminSignInPage({
  searchParams,
}: SuperAdminSignInPageProps) {
  const { callbackUrl } = await searchParams;
  const destination = sanitizeAdminCallback(callbackUrl);

  const actor = await resolveActor();
  if (actor.userId !== null) {
    redirect(actor.isSuperAdmin ? destination : '/dashboard');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            Super Admin sign in
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Email and password access for the platform administrator.
          </p>
        </div>

        <SuperAdminSignInForm callbackUrl={destination} />
      </div>
    </div>
  );
}
