import { describe, expect, it } from 'vitest';

import { isUniqueViolation } from '@/platform/db/pg-errors';

describe('isUniqueViolation', () => {
  it('recognises a PostgreSQL unique violation', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error('duplicate key'), { code: '23505' }))).toBe(
      true
    );
  });

  it('ignores anything that is not a unique violation', () => {
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
  });
});
