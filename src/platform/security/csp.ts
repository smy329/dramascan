/**
 * Content Security Policy construction.
 *
 * The browser is the only component that ever contacts an external media
 * host: the application server never fetches, proxies, relays, or rehosts a
 * video or subtitle file. The policy therefore has to describe, precisely,
 * which external origins the browser may talk to.
 *
 * Directive separation is deliberate. `script-src`, `style-src`, `img-src`,
 * and `media-src` are independent policies: allowing a host to serve a video
 * does not allow it to serve an image, a stylesheet, or a script.
 *
 * Trusted media hosts
 * -------------------
 * `allowedMediaOrigins` is the operator's allowlist. When it is empty the
 * policy allows any HTTPS origin, which is the default for a deployment that
 * has not yet pinned its media hosts. When it is not empty, only the listed
 * origins may serve media or subtitle files. Adding a host is an operator
 * action: set `MEDIA_ALLOWED_HOSTS` to a comma-separated list of origins
 * (for example `https://cdn.example.com,https://subs.example.com`) and
 * restart the application. There is no wildcard option.
 *
 * This module is deliberately free of `server-only` so it can be unit tested
 * and imported by `src/proxy.ts`.
 */

export type ContentSecurityPolicyInput = {
  /** Per-request nonce. Next.js copies it onto its own inline script and style tags. */
  nonce: string;
  /** Development needs `unsafe-eval` for React's enhanced stack traces. */
  isDevelopment: boolean;
  /** Operator-configured trusted media origins. Empty means "any HTTPS origin". */
  allowedMediaOrigins: readonly string[];
};

/** Media and subtitle sources the browser may reach. */
function externalSourceList(allowedMediaOrigins: readonly string[]): string {
  if (allowedMediaOrigins.length === 0) {
    return 'https:';
  }

  return allowedMediaOrigins.join(' ');
}

/**
 * Build the policy.
 *
 * The returned value is a single line so it can be used directly as a header
 * value without further formatting.
 */
export function buildContentSecurityPolicy(input: ContentSecurityPolicyInput): string {
  const { nonce, isDevelopment, allowedMediaOrigins } = input;
  const externalSources = externalSourceList(allowedMediaOrigins);

  const directives: string[] = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // Style *attributes* are governed separately from style elements. React
    // renders `style` props as attributes, and a policy without this
    // directive would silently drop them. The nonce still protects style
    // elements, which is where an injected stylesheet would live.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `media-src 'self' ${externalSources}`,
    // The player fetches subtitle files over `fetch`, which `media-src` does
    // not cover, so the same trusted origins are allowed here.
    `connect-src 'self' ${externalSources}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  if (isDevelopment) {
    // The Next.js development overlay injects inline `<style>` elements at
    // runtime. Those elements cannot carry the request nonce, so the
    // nonce-only element policy blocks them and the browser reports a
    // Content Security Policy violation for every one of them.
    //
    // The relaxation is development-only: in production the element policy
    // stays nonce-only, so an injected stylesheet still needs the nonce.
    // `'unsafe-inline'` cannot simply be added to `style-src` — a nonce in
    // the same directive makes the browser ignore it — so the element policy
    // is set separately.
    //
    // `'self'` stays in the directive because `style-src-elem` governs
    // external stylesheets as well as inline ones: without it the
    // application's own stylesheet would be blocked.
    directives.splice(4, 0, "style-src-elem 'self' 'unsafe-inline'");
  }

  if (!isDevelopment) {
    // Plain HTTP sub-resources are upgraded in production only; doing it in
    // development would break the local HTTP origin.
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}
