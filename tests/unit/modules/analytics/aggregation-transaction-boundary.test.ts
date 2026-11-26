import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The aggregation transaction boundary (D-059).
 *
 * D-059 requires the aggregation to "read the raw events, compute the rows,
 * and replace the scoped rows inside one transaction". The read therefore
 * happens on the transaction handle, after the scope lock is taken: a refresh
 * that reads on the pool can compute its rows from a state another refresh is
 * replacing, and then write a stale result.
 *
 * The compute also runs on one connection, so the reads inside it are
 * serialised (CONVENTIONS §5.6): a transaction is bound to one PostgreSQL
 * connection and may run one query at a time.
 *
 * The guard is a source check, like the other architecture guards in this
 * repository: the property is about *where* a statement runs, which a unit
 * test cannot observe from the outside.
 */

const SOURCE = join(process.cwd(), 'src/modules/analytics/aggregation-workflow.ts');

function readSource(): string {
  return readFileSync(SOURCE, 'utf8');
}

describe('the aggregation transaction boundary', () => {
  it('computes the aggregate rows on the transaction handle', () => {
    const source = readSource();

    expect(source).toContain('computeAggregateRows(scope, start, end, tx)');
    expect(source).not.toContain('computeAggregateRows(scope, start, end, db)');
  });

  it('runs no queries concurrently while it aggregates', () => {
    expect(readSource()).not.toContain('Promise.all');
  });

  it('takes the scope lock before it reads the raw events', () => {
    const source = readSource();

    expect(source.indexOf('lockScope(tx, scope)')).toBeGreaterThan(-1);
    expect(source.indexOf('lockScope(tx, scope)')).toBeLessThan(
      source.indexOf('computeAggregateRows(scope, start, end, tx)')
    );
  });
});
