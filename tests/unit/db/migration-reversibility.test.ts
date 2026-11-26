import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every migration states its rollback plan.
 *
 * Drizzle Kit does not generate down migrations by default, so the rollback
 * plan of a migration exists only as a comment in the file (CONVENTIONS
 * §10.3). Without it, an operator who has to undo a deployment reads the
 * statements to find out what they would destroy.
 *
 * The guard reads the migration files, because the statement is part of the
 * migration itself.
 */

const MIGRATIONS_DIRECTORY = join(process.cwd(), 'drizzle');

const REVERSIBILITY_STATEMENT = /Reversib(?:ility|le)\s*:/;

describe('the migrations', () => {
  it('state whether they are reversible or forward-fix-only', () => {
    const offenders = readdirSync(MIGRATIONS_DIRECTORY)
      .filter(name => name.endsWith('.sql'))
      .filter(name => !REVERSIBILITY_STATEMENT.test(readFileSync(join(MIGRATIONS_DIRECTORY, name), 'utf8')))
      .sort();

    expect(offenders).toEqual([]);
  });
});
