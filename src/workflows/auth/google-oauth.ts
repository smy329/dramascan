/**
 * Google OAuth Server Actions.
 *
 * Google is the only sign-in provider. Better Auth owns the OAuth redirect,
 * callback, account linking, and session cookie. The catch-all route at
 * `/api/auth/[...all]` completes the provider callback.
 */

'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/platform/auth/better-auth';

/** Start Google sign-in and follow Better Auth's authorization URL. */
export async function googleSignIn(): Promise<void> {
  const { url } = await auth.api.signInSocial({
    body: {
      provider: 'google',
      callbackURL: '/dashboard',
      errorCallbackURL: '/auth/signin',
    },
    headers: await headers(),
  });

  if (!url) {
    throw new Error('Google sign-in could not be started.');
  }

  redirect(url);
}

/** End the current session and return to the sign-in page. */
export async function googleSignOut(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect('/auth/signin');
}
