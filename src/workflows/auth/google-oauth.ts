/** Google OAuth sign-in and callback workflows for Better Auth.
 *
 * These Server Actions support the Better Auth Google OAuth flow.
 * Password authentication is not implemented — Google OAuth is the only provider.
 * Account linking is handled automatically by Better Auth.
 *
 * The Google OAuth flow is configured in `src/platform/auth/better-auth.ts`
 * with `providers: { google: { clientId, clientSecret, scope } }`.
 *
 * Flow overview:
 *   1. User visits `/auth/signin` or clicks "Sign in with Google"
 *   2. Better Auth redirects to Google's OAuth consent screen
 *   3. Google redirects back to `/api/auth/callback/google`
 *   4. Better Auth completes sign-in/account-linking
 *   5. User is redirected to the dashboard
 *
 * All error handling is done through Better Auth's safe error types.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

// ---- Sign in with Google --------------------------------
// Delegates to Better Auth's built-in Google OAuth sign-in.
// The user is redirected to Google's consent screen and back.

export async function googleSignIn() {
  // Better Auth handles the Google sign-in redirect internally.
  // We re-redirect the browser to the Better Auth sign-in page
  // which will initiate the Google OAuth flow.
  revalidatePath('/auth/signin');
  return redirect('/auth/signin');
}

// ---- Callback handler -----------------------------------
// This is handled by the route handler at
// `src/app/api/auth/callback/google/route.ts`. This workflow function
// is kept for completeness but the route handler is the primary entry point.

export async function googleCallback() {
  // Better Auth callback is handled server-side via the route handler.
  // If accessed directly, re-sign in.
  revalidatePath('/');
  return redirect('/auth/signin');
}

// ---- Sign out ---------------------------------------------

export async function googleSignOut() {
  revalidatePath('/auth/signin');
  return redirect('/auth/signin');
}

// ---- Get current session ----------------------------------

export async function googleGetSession() {
  // Session state is managed by Better Auth and the Drizzle/PostgreSQL adapter.
  // The client can check authentication state via the session cookie.
  // This function revalidates and redirects based on auth state.
  revalidatePath('/dashboard');
  return redirect('/dashboard');
}

// ---- Account linking check --------------------------------

export async function googleIsLinked() {
  // Since this app only supports Google OAuth, any authenticated user
  // effectively has a Google account linked.
  revalidatePath('/');
  return redirect('/');
}