/**
 * Callback URL validation shared by sign-in entrypoints.
 *
 * Post-sign-in destinations are untrusted input: they arrive from a query
 * string or a form field and must never allow an open redirect. This module is
 * framework-free so it can run in a Server Component, a Server Action, and a
 * unit test without any Next.js or database imports.
 *
 * Rules:
 * - Only same-origin, absolute *paths* are accepted. Absolute URLs,
 *   protocol-relative values (`//host`), backslashes, control characters, and
 *   whitespace-padded values are rejected.
 * - Values are parsed against a fixed base so dot segments are normalized
 *   before the result is trusted.
 */

const MAX_CALLBACK_LENGTH = 2048;
const BASE_ORIGIN = 'http://dramascan.local';
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
const ADMIN_PATH_PREFIX = '/admin';

export const DEFAULT_CALLBACK_URL = '/dashboard';

/**
 * Return a normalized same-origin path, or `null` when the value is unsafe.
 */
export function sanitizeLocalCallback(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  if (value.length === 0 || value.length > MAX_CALLBACK_LENGTH) {
    return null;
  }
  if (value !== value.trim()) {
    return null;
  }
  if (!value.startsWith('/') || value.startsWith('//')) {
    return null;
  }
  if (value.includes('\\') || CONTROL_CHARACTERS.test(value)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, BASE_ORIGIN);
  } catch {
    return null;
  }

  if (parsed.origin !== BASE_ORIGIN) {
    return null;
  }

  const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return normalized.startsWith('/') ? normalized : null;
}

/**
 * Return a safe local destination, falling back to `fallback` (then to the
 * dashboard) when either value is unsafe.
 */
export function sanitizeCallbackUrl(
  value: unknown,
  fallback: string = DEFAULT_CALLBACK_URL
): string {
  return sanitizeLocalCallback(value) ?? sanitizeLocalCallback(fallback) ?? DEFAULT_CALLBACK_URL;
}

/** Is this a path inside the admin area (not a lookalike such as `/adminish`)? */
export function isAdminPath(value: string): boolean {
  return (
    value === ADMIN_PATH_PREFIX ||
    value.startsWith(`${ADMIN_PATH_PREFIX}/`) ||
    value.startsWith(`${ADMIN_PATH_PREFIX}?`) ||
    value.startsWith(`${ADMIN_PATH_PREFIX}#`)
  );
}

/**
 * Build the sign-in URL that returns an anonymous visitor to the admin area
 * after authentication. Unsafe or non-admin requests fall back to `/admin`.
 */
export function buildAdminSignInUrl(requestedPath: unknown): string {
  const requested = sanitizeLocalCallback(requestedPath);
  const destination = requested !== null && isAdminPath(requested) ? requested : ADMIN_PATH_PREFIX;
  return `/auth/signin?callbackUrl=${encodeURIComponent(destination)}`;
}
