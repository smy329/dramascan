import { describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy } from '@/platform/security/csp';

/** Read one directive's value out of a single-line policy. */
function directive(policy: string, name: string): string {
  const match = policy.match(new RegExp(`(?:^|;\\s*)${name}\\s+([^;]+)`));

  return match?.[1]?.trim() ?? '';
}

/**
 * The Content Security Policy is the only browser-side boundary the viewer
 * has: the application server never fetches or proxies media, so the browser
 * is the component that decides which external origins may serve video and
 * subtitle files.
 *
 * These tests pin the properties the prompt requires: no wildcard media
 * permission, image/script/style/media policies kept separate, and a
 * documented way to add a trusted media host.
 */
describe('buildContentSecurityPolicy', () => {
  function build(overrides: Partial<Parameters<typeof buildContentSecurityPolicy>[0]> = {}) {
    return buildContentSecurityPolicy({
      nonce: 'test-nonce',
      isDevelopment: false,
      allowedMediaOrigins: [],
      ...overrides,
    });
  }

  it('never grants a wildcard media permission', () => {
    const policy = build();

    expect(policy).not.toContain('media-src *');
    expect(policy).not.toMatch(/media-src[^;]*\*/);
  });

  it('keeps image, script, style, and media policies separate', () => {
    const policy = build();

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self' 'nonce-test-nonce' 'strict-dynamic'");
    expect(policy).toContain("style-src 'self' 'nonce-test-nonce'");
    expect(policy).toContain("img-src 'self' data: blob: https:");
    expect(policy).toContain("media-src 'self' https:");
    expect(policy).toContain("connect-src 'self' https:");
    expect(policy).toContain("font-src 'self' data:");
  });

  it('allows any HTTPS origin for media when no host allowlist is configured', () => {
    const policy = build();

    expect(policy).toContain("media-src 'self' https:");
  });

  it('restricts media to the configured trusted origins when an allowlist is set', () => {
    const policy = build({ allowedMediaOrigins: ['https://cdn.example.com'] });

    expect(directive(policy, 'media-src')).toBe("'self' https://cdn.example.com");
    expect(directive(policy, 'media-src').split(' ')).not.toContain('https:');
  });

  it('permits the trusted media origins to serve subtitle files as well', () => {
    const policy = build({ allowedMediaOrigins: ['https://cdn.example.com'] });

    expect(directive(policy, 'connect-src')).toBe("'self' https://cdn.example.com");
  });

  it('locks down framing, objects, and form targets', () => {
    const policy = build();

    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("base-uri 'self'");
  });

  it('allows eval only in development', () => {
    expect(build({ isDevelopment: true })).toContain("'unsafe-eval'");
    expect(build({ isDevelopment: false })).not.toContain("'unsafe-eval'");
  });

  it('keeps inline style elements nonce-only in production', () => {
    const policy = build({ isDevelopment: false });

    expect(directive(policy, 'style-src')).toBe("'self' 'nonce-test-nonce'");
    expect(policy).not.toContain('style-src-elem');
  });

  it('allows the development overlay to inject inline style elements', () => {
    // The Next.js development overlay injects inline `<style>` elements at
    // runtime and cannot carry the request nonce. Without this the browser
    // reports a policy violation for every one of them, which drowns out the
    // real console errors the end-to-end suite watches for.
    //
    // `'self'` has to stay in the directive: `style-src-elem` governs
    // external stylesheets too, and the application's own stylesheet comes
    // from the same origin.
    expect(directive(build({ isDevelopment: true }), 'style-src-elem')).toBe(
      "'self' 'unsafe-inline'"
    );
  });

  it('produces a single-line header value', () => {
    const policy = build();

    expect(policy).not.toContain('\n');
  });
});
