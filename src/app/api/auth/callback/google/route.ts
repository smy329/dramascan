import { googleCallback } from '@/workflows/auth/google-oauth';

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_request: Request) {
  // Better Auth expects the callback at /api/auth/callback/google to process
  // the OAuth response from Google and complete the sign-in/account-linking.
  // The workflow function handles the redirect internally.

  // Delegate to the workflow; it will redirect as needed.
  await googleCallback();

  // After the workflow completes (or redirects), redirect to dashboard.
  // If the user was successfully signed in, they'll see the dashboard.
  // If not, they'll be redirected back to sign-in.
  return redirect('/dashboard');
}
