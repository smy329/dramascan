/**
 * Super Admin email/password sign-in.
 *
 * The only credential account is created by `npm run db:seed:super-admin`.
 * Public sign-up is disabled in the Better Auth configuration, so this action
 * cannot create an account — it can only authenticate an existing one.
 *
 * Every failure (unknown email, wrong password, deactivated account) returns
 * the same message: the form must not reveal whether an account exists.
 */

'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { sanitizeAdminCallback } from '@/lib/redirects';
import { auth } from '@/platform/auth/better-auth';
import { superAdminCredentialsSchema } from './super-admin-credentials';

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';

export type SuperAdminSignInResult = { ok: false; message: string };

/**
 * Authenticate the Super Admin and continue into the requested admin path.
 * Better Auth writes the session cookie through the `nextCookies` plugin;
 * `redirect` then returns the browser to the admin area.
 *
 * The credentials arrive as `FormData` rather than a plain object so Next.js's
 * development Server Action logging does not serialize the password.
 */
export async function signInSuperAdmin(formData: FormData): Promise<SuperAdminSignInResult> {
  const parsed = superAdminCredentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { ok: false, message: INVALID_CREDENTIALS_MESSAGE };
  }

  try {
    await auth.api.signInEmail({
      body: { email: parsed.data.email, password: parsed.data.password },
      headers: await headers(),
    });
  } catch {
    return { ok: false, message: INVALID_CREDENTIALS_MESSAGE };
  }

  return redirect(sanitizeAdminCallback(formData.get('callbackUrl')));
}
