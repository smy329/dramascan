import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The anonymous guest-session cookie is issued by the route handler (D-057 §4).
 *
 * The cookie is the only identity an anonymous visitor has, and Next.js
 * forbids `cookies().set()` while a Server Component renders. The analytics
 * module therefore resolves the identifier and never writes it: the analytics
 * route handler is the only place that may issue the cookie.
 *
 * The guard reads the source, because the property is about *where* the cookie
 * is written.
 */

const SOURCE_ROOT = join(process.cwd(), 'src');
const MODULE_ROOT = join(SOURCE_ROOT, 'modules');
const ANALYTICS_ROUTE_ROOT = join(SOURCE_ROOT, 'app', 'api', 'analytics');
const GUEST_SESSION_HELPER = join(ANALYTICS_ROUTE_ROOT, '_guest-session.ts');

function listTypeScriptFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory).flatMap((entry: string) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return listTypeScriptFiles(path);
    }

    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : [];
  });
}

function relativePath(file: string): string {
  return relative(process.cwd(), file).split('\\').join('/');
}

describe('the anonymous guest-session cookie', () => {
  it('is never written by a module', () => {
    const offenders = listTypeScriptFiles(MODULE_ROOT)
      .filter(file => /import\s*\{[^}]*\bcookies\b[^}]*\}\s*from\s*'next\/headers'/.test(readFileSync(file, 'utf8')))
      .map(relativePath);

    expect(offenders).toEqual([]);
  });

  it('is issued by the analytics route layer', () => {
    expect(existsSync(GUEST_SESSION_HELPER)).toBe(true);

    const helper = readFileSync(GUEST_SESSION_HELPER, 'utf8');

    expect(helper).toContain('next/headers');
    expect(helper).toMatch(/\.set\(/);
  });

  it('is issued by both analytics routes', () => {
    for (const route of ['view', 'playback']) {
      const file = join(ANALYTICS_ROUTE_ROOT, route, 'route.ts');

      expect(existsSync(file), route).toBe(true);
      expect(readFileSync(file, 'utf8'), route).toContain('issueGuestSession');
    }
  });

  it('is never accepted from the client', () => {
    // The identifier reaches the workflow as an argument, so the workflow must
    // not be a Server Action: a Server Action argument arrives from the
    // request body (D-031, D-083).
    for (const workflow of ['record-view.ts', 'record-playback.ts']) {
      const file = join(SOURCE_ROOT, 'workflows', 'analytics', workflow);
      const source = readFileSync(file, 'utf8');

      expect(source, workflow).not.toMatch(/^\s*['"]use server['"];/);
    }
  });
});
