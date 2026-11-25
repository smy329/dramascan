import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { WARMUP_PATHS, WARMUP_PLACEHOLDER_ID } from '../../e2e/support/warmup.mjs';

/**
 * Warm-up coverage for the end-to-end suite.
 *
 * A development server compiles a route the first time it is requested. When a
 * test reaches an un-warmed route, that compile happens inside the test's own
 * assertion window, and a correct application is reported as a broken one:
 * the measured failures were a page navigation that ran out of time and an
 * administration request whose response arrived after the expectation had
 * expired.
 *
 * The warm-up list therefore has to cover **every** route module the
 * application exposes. This test derives the routes from the source tree, so a
 * route that is added later cannot silently escape the warm-up.
 */

const APP_ROOT = path.resolve(process.cwd(), 'src', 'app');

/** The route module file names that define an addressable route. */
const ROUTE_MODULE_NAMES = new Set(['page.tsx', 'route.ts']);

/**
 * Collect every route module under a directory.
 *
 * @param directory the directory to scan
 * @returns the absolute paths of the route modules
 */
function collectRouteModules(directory: string): string[] {
  const modules: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      modules.push(...collectRouteModules(full));
      continue;
    }

    if (ROUTE_MODULE_NAMES.has(entry.name)) {
      modules.push(full);
    }
  }

  return modules;
}

/**
 * The address of one route module.
 *
 * A route group — a folder in parentheses — is not part of the address, and a
 * dynamic segment is addressed by the placeholder identifier.
 *
 * @param module the absolute path of the route module
 * @returns the address the browser uses
 */
function addressOf(module: string): string {
  const relative = path.relative(APP_ROOT, path.dirname(module));
  const segments = relative
    .split(path.sep)
    .filter(segment => segment.length > 0)
    .filter(segment => !(segment.startsWith('(') && segment.endsWith(')')))
    .map(segment => (segment.startsWith('[') ? WARMUP_PLACEHOLDER_ID : segment));

  return `/${segments.join('/')}`;
}

describe('the end-to-end warm-up list', () => {
  it('covers every route module the application exposes', () => {
    const missing = collectRouteModules(APP_ROOT)
      .map(addressOf)
      .filter(address => !WARMUP_PATHS.includes(address))
      .sort();

    expect(missing).toEqual([]);
  });

  it('keeps the dynamic routes on the placeholder identifier', () => {
    // The placeholder cannot match a real row, so a warm-up request proves the
    // route compiles without touching the data.
    expect(WARMUP_PLACEHOLDER_ID).toBe('00000000-0000-4000-8000-000000000000');
    expect(
      WARMUP_PATHS.every(address => !/\[[^\]]+\]/.test(address))
    ).toBe(true);
  });
});
