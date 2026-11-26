/**
 * The anonymous guest session (Prompt 139).
 *
 * A guest session is the only identity an unauthenticated visitor has. It is
 * an opaque random identifier stored in an HTTP-only cookie: no IP address, no
 * user-agent fingerprint, no device identifier. The identifier is random, so
 * it cannot be derived from anything about the visitor.
 *
 * The module never touches the cookie jar. It resolves the identifier and the
 * route handler issues it, because the route handler is the only place that
 * may write a cookie: Next.js forbids `cookies().set()` while a Server
 * Component renders, and a Server Component that silently failed to set the
 * cookie would count every refresh as a new visitor (D-057 §4).
 */

/** The cookie that carries the anonymous guest session identifier. */
export const GUEST_SESSION_COOKIE = 'dramascan_guest';

/** How long the anonymous guest session lives: 180 days. */
export const GUEST_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

/** The resolved anonymous session of a request. */
export type GuestSessionResolution = Readonly<{
  /** The anonymous session identifier. */
  sessionId: string;
  /** Whether the identifier was created for this request. */
  isNew: boolean;
}>;

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
 * Resolve the anonymous session identifier of a request.
 *
 * The function is pure: it never writes a cookie. The caller — the analytics
 * route handler — issues the identifier when the resolution is new.
 *
 * @param existing the identifier the request already carries, if any
 * @returns the identifier, and whether it was created for this request
 */
export function resolveGuestSessionId(existing: string | null): GuestSessionResolution {
  if (typeof existing === 'string' && existing.length > 0) {
    return { sessionId: existing, isNew: false };
  }

  return { sessionId: generateGuestSessionId(), isNew: true };
}
