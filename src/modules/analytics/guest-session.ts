import 'server-only';

import { cookies } from 'next/headers';

/**
 * The anonymous guest session (Prompt 139).
 *
 * A guest session is the only identity an unauthenticated visitor has. It is
 * an opaque random identifier stored in an HTTP-only cookie: no IP address, no
 * user-agent fingerprint, no device identifier. The identifier is random, so
 * it cannot be derived from anything about the visitor.
 *
 * The cookie is written by the view-tracking route handler, never by a Server
 * Component: Next.js refuses `cookies().set()` while rendering, and a server
 * component that silently failed to set the cookie would count every refresh
 * as a new visitor.
 */

/** The cookie that carries the anonymous guest session identifier. */
export const GUEST_SESSION_COOKIE = 'dramascan_guest';

/** How long the anonymous guest session lives: 180 days. */
export const GUEST_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

/**
 * Create a fresh anonymous session identifier.
 *
 * The identifier is a random UUID. It carries no information about the
 * visitor, which is the whole point: the platform must be able to tell two
 * visits apart without being able to tell who made them.
 *
 * @returns the new identifier
 */
export function generateGuestSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Read the anonymous session identifier of the current request.
 *
 * @returns the identifier, or `null` when the request carries no cookie
 */
export async function readGuestSessionId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(GUEST_SESSION_COOKIE)?.value;

  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Return the anonymous session identifier of the current request, creating and
 * storing one when the request carries none.
 *
 * Only a Route Handler or a Server Action may call this: writing a cookie is
 * forbidden while a Server Component renders.
 *
 * @returns the identifier
 */
export async function ensureGuestSessionId(): Promise<string> {
  const existing = await readGuestSessionId();

  if (existing !== null) {
    return existing;
  }

  const created = generateGuestSessionId();
  const store = await cookies();

  store.set(GUEST_SESSION_COOKIE, created, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: GUEST_SESSION_MAX_AGE_SECONDS,
  });

  return created;
}
