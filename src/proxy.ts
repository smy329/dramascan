import { NextResponse, type NextRequest } from 'next/server';

import { serverConfig } from '@/platform/config';
import { buildContentSecurityPolicy } from '@/platform/security/csp';

/**
 * Per-request Content Security Policy.
 *
 * The policy carries a nonce, so it cannot be a static header in
 * `next.config.ts`: a static policy has no nonce and would block Next.js's own
 * inline bootstrap scripts, which breaks hydration. The proxy generates a fresh
 * nonce for every document request, hands it to Next.js through the `x-nonce`
 * request header, and repeats it in the response header.
 *
 * Next.js reads the nonce out of the *request* `Content-Security-Policy`
 * header and attaches it to the framework scripts, the page bundles, and the
 * inline styles and scripts it generates. A page therefore has to be rendered
 * per request; the root layout opts the whole application into dynamic
 * rendering with `connection()` so that no page is ever served as a
 * prerendered document without a matching nonce.
 *
 * See `docs/architecture/SECURITY.md` for the operator-facing description of
 * the trusted media host list.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDevelopment = process.env.NODE_ENV === 'development';

  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    isDevelopment,
    allowedMediaOrigins: serverConfig.allowedMediaOrigins,
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set('Content-Security-Policy', contentSecurityPolicy);

  return response;
}

export const config = {
  matcher: [
    /*
     * Every document request. Static assets do not need the policy: they are
     * served without inline scripts, and a CSP header on them only costs
     * bytes. Prefetch requests are excluded because they are not rendered.
     */
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
