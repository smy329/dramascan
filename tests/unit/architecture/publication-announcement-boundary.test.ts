import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The announcement boundary of the publication workflow (D-076).
 *
 * A workflow coordinates modules; it does not query them. The announcement
 * helper therefore reads the content rows through the content module's public
 * API, and the workflow holds no query of its own
 * (ARCHITECTURE §5.2).
 *
 * The guard reads the source, because the property is about *where* the query
 * runs: a query inside the helper is a query the workflow owns.
 */

const WORKFLOW = join(process.cwd(), 'src/workflows/admin/publication.ts');

/** The body of the `announceContent` helper. */
function readAnnouncementHelper(): string {
  const source = readFileSync(WORKFLOW, 'utf8');
  const start = source.indexOf('async function announceContent(');

  if (start === -1) {
    return '';
  }

  const openingBrace = source.indexOf('{', start);
  let depth = 0;

  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1;
    } else if (source[index] === '}') {
      depth -= 1;

      if (depth === 0) {
        return source.slice(openingBrace, index + 1);
      }
    }
  }

  return '';
}

describe('the publication announcement boundary', () => {
  it('runs no query of its own', () => {
    const helper = readAnnouncementHelper();

    expect(helper.length).toBeGreaterThan(0);
    expect(helper).not.toContain('.select(');
    expect(helper).not.toContain('.from(');
    expect(helper).not.toContain('.innerJoin(');
    expect(helper).not.toContain('.leftJoin(');
  });

  it('reads the content rows through the content module', () => {
    const helper = readAnnouncementHelper();

    expect(helper).toContain('listPublishedDramaReferences');
    expect(helper).toContain('listPublishedSeasonReferences');
    expect(helper).toContain('listPublishedEpisodeReferences');
  });
});
