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
import { DEFAULT_CALLBACK_URL, sanitizeCallbackUrl } from '@/lib/redirects';

/**
 * Start Google sign-in and follow Better Auth's authorization URL.
 *
 * The destination arrives from a form field, so it is sanitized again here
 * before it reaches Better Auth. This is the only place the post-sign-in
 * callback is trusted.
 */
export async function googleSignIn(formData: FormData): Promise<void> {
  const callbackUrl = sanitizeCallbackUrl(formData.get('callbackUrl'));
  const errorCallbackURL =
    callbackUrl === DEFAULT_CALLBACK_URL
      ? '/auth/signin'
      : `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;

  const { url } = await auth.api.signInSocial({
    body: {
      provider: 'google',
      callbackURL: callbackUrl,
      errorCallbackURL,
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
