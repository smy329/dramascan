import { describe, expect, it } from 'vitest';

import { formatReport } from '../../../scripts/data-integrity.mjs';

/**
 * The operator report is the only view an operator has of the legacy data the
 * migration could not accept. A truncated report looks like a complete one, so
 * every row must be printed.
 */
describe('integrity report formatting', () => {
  it('prints every row of a section', () => {
    const rows = Array.from({ length: 25 }, (_unused, index) => ({ id: `row-${index}` }));

    const output = formatReport([
      { key: 'demo-section', description: 'A section with many rows.', rows },
    ]).join('\n');

    for (const row of rows) {
      expect(output).toContain(JSON.stringify(row));
    }

    expect(output).toContain('== demo-section (25) ==');
    expect(output).not.toContain('more');
  });

  it('prints a section without rows', () => {
    const output = formatReport([
      { key: 'empty-section', description: 'A section without findings.', rows: [] },
    ]).join('\n');

    expect(output).toContain('== empty-section (0) ==');
    expect(output).toContain('Read-only report complete.');
  });
});
