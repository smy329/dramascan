import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The alert locators of the end-to-end suite.
 *
 * Next.js renders a route announcer that carries `role="alert"` and an
 * `aria-live="assertive"` region (`next/dist/client/route-announcer.js`). It
 * is a client component: it is absent from the server-rendered HTML and
 * appears when the page hydrates. A locator of `getByRole('alert')` therefore
 * resolves to one element before hydration and to two elements after it, and
 * the assertion fails with a strict-mode violation — depending on how fast the
 * browser hydrates the page, not on what the application rendered.
 *
 * The observed failure was exactly that: the drama-conversion test passed in
 * isolation (the assertion ran before hydration) and failed in the full suite
 * (the assertion ran after it).
 *
 * An alert locator therefore has to be narrowed to the alert the test means.
 * This test derives the rule from the spec files, so a new ambiguous locator
 * cannot enter the suite unnoticed.
 */

const E2E_ROOT = path.resolve(process.cwd(), 'tests', 'e2e');

/**
 * Collect every end-to-end spec file.
 *
 * @param directory the directory to scan
 * @returns the absolute paths of the spec files
 */
function collectSpecs(directory: string): string[] {
  const specs: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      specs.push(...collectSpecs(full));
      continue;
    }

    if (entry.name.endsWith('.spec.ts')) {
      specs.push(full);
    }
  }

  return specs;
}

/**
 * The line number of a position in a source file.
 *
 * @param source the file content
 * @param index the character offset
 * @returns the one-based line number
 */
function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

describe('the alert locators of the end-to-end suite', () => {
  it('never uses an alert locator that the route announcer can also match', () => {
    const ambiguous: string[] = [];

    for (const spec of collectSpecs(E2E_ROOT)) {
      const source = readFileSync(spec, 'utf8');
      const pattern = /getByRole\((['"])alert\1\)/g;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(source)) !== null) {
        const after = source.slice(match.index + match[0].length);

        // A narrowed locator keeps only the alert the test means.
        if (after.trimStart().startsWith('.filter(')) {
          continue;
        }

        ambiguous.push(`${path.relative(process.cwd(), spec)}:${lineOf(source, match.index)}`);
      }
    }

    expect(ambiguous).toEqual([]);
  });
});
