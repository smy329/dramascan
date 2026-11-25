import type { NextConfig } from 'next';

/**
 * Application configuration.
 *
 * The Content Security Policy is **not** configured here. It needs a
 * per-request nonce, so it is built by `src/proxy.ts` and applied to both the
 * request and the response. A static policy in this file would have no nonce
 * and would block Next.js's own inline bootstrap scripts.
 *
 * The headers configured here are the ones that do not need a nonce.
 *
 * See `docs/architecture/SECURITY.md` for the operator-facing description of
 * the Content Security Policy and of the trusted media host list.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep the project's authoritative AGENTS.md free of generated content.
  agentRules: false,
  // `web-push` is a Node package that reads its own runtime dependencies and
  // must not be bundled by the server compiler. It is imported lazily by the
  // push provider, so a deployment without push never loads it.
  serverExternalPackages: ['web-push'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Prevent MIME-type sniffing.
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // Referrer policy — avoid leaking sensitive URLs.
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          // Defence in depth for the `frame-ancestors 'none'` CSP directive.
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          // Production HSTS — enable only when serving over HTTPS in prod.
          // {
          //   key: 'Strict-Transport-Security',
          //   value: 'max-age=31536000; includeSubDomains; preload',
          // },
        ],
      },
    ];
  },
};

export default nextConfig;
