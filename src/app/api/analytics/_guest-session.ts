import 'server-only';

import { cookies } from 'next/headers';

import {
  GUEST_SESSION_COOKIE,
  GUEST_SESSION_MAX_AGE_SECONDS,
  resolveGuestSessionId,
} from '@/modules/analytics';

/**
 * The anonymous guest session of an analytics request (D-057 §4).
 *
 * The route handler is the only place that may issue the cookie: Next.js
 * forbids `cookies().set()` while a Server Component renders, and the cookie
 * is the one identity an anonymous visitor has. The analytics module resolves
 * the identifier and never writes it.
 */

/**
 * Resolve the anonymous session of the request and issue its cookie.
 *
 * The cookie is written only when the request carries none, so an existing
 * visitor keeps the identifier their history was counted under.
 *
 * @returns the anonymous session identifier of the request
 */
export async function issueGuestSession(): Promise<{ sessionId: string }> {
  const store = await cookies();
  const existing = store.get(GUEST_SESSION_COOKIE)?.value ?? null;
  const resolution = resolveGuestSessionId(existing);

  if (resolution.isNew) {
    store.set(GUEST_SESSION_COOKIE, resolution.sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: GUEST_SESSION_MAX_AGE_SECONDS,
    });
  }

  return { sessionId: resolution.sessionId };
}
