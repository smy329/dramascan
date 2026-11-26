import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The unsafe-assertion rule (CONVENTIONS §4.2, rule 2).
 *
 * `as` is allowed only at a validated boundary or for a documented
 * third-party limitation, with a comment. The notification module carries the
 * platform's only outbound HTTP call, so an unexplained assertion in it is an
 * assertion a reviewer cannot check.
 *
 * The guard reads the source, because the property is about the *form* of the
 * assertion: an assertion without a comment next to it is what the rule
 * forbids.
 */

const SOURCES = [
  'src/modules/notifications/push-transport.ts',
  'src/modules/notifications/audience.ts',
  'src/modules/notifications/announcements.ts',
  'src/modules/notifications/events.ts',
];

describe('the unsafe assertions of the notification module', () => {
  it('documents every unsafe assertion next to it', () => {
    const offenders: string[] = [];

    for (const relativePath of SOURCES) {
      const lines = readFileSync(join(process.cwd(), relativePath), 'utf8').split('\n');

      lines.forEach((line, index) => {
        if (!/\bas\s+(never|unknown|any)\b/.test(line)) {
          return;
        }

        // The comment has to be the line right above the assertion: a comment
        // further up may describe something else.
        const previous = lines[index - 1]?.trim() ?? '';

        if (!previous.startsWith('//')) {
          offenders.push(`${relativePath}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
