import { describe, expect, it } from 'vitest';

import { isUniqueViolation } from '@/platform/db/errors';

/**
 * Drizzle wraps every driver failure in a `DrizzleQueryError`, so the
 * PostgreSQL SQLSTATE code lives on the `cause` chain rather than on the thrown
 * value. Classifying only the thrown value silently downgrades a conflict to a
 * 500 response.
 */

function driverError(code: string): Error {
  return Object.assign(new Error('driver failure'), { code });
}

describe('isUniqueViolation', () => {
  it('detects a raw PostgreSQL unique violation', () => {
    expect(isUniqueViolation(driverError('23505'))).toBe(true);
  });

  it('detects the driver error Drizzle wraps in a query error', () => {
    const wrapped = new Error('Failed query: insert into "roles" ...', {
      cause: driverError('23505'),
    });

    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it('detects a unique violation several causes deep', () => {
    const nested = new Error('outer', {
      cause: new Error('inner', { cause: driverError('23505') }),
    });

    expect(isUniqueViolation(nested)).toBe(true);
  });

  it('ignores other PostgreSQL errors', () => {
    expect(isUniqueViolation(driverError('23503'))).toBe(false);
    expect(isUniqueViolation(new Error('something else'))).toBe(false);
  });

  it('ignores non-error input and a cyclic cause chain', () => {
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;

    expect(isUniqueViolation(cycle)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });
});
