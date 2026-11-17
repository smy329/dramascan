/**
 * PostgreSQL error classification for Drizzle query failures.
 *
 * Drizzle wraps every driver failure in a `DrizzleQueryError` whose `cause`
 * chain holds the `pg` error. The SQLSTATE code is therefore not reliably on
 * the thrown value: a check that only inspects the outer error silently turns
 * a documented `409 Conflict` into a `500`.
 *
 * The helpers walk a bounded number of causes so a cyclic `cause` chain cannot
 * loop forever.
 */

const UNIQUE_VIOLATION_CODE = '23505';

const MAX_CAUSE_DEPTH = 5;

/** Walk the `cause` chain of a thrown query error, bounded by depth. */
function hasPostgresErrorCode(error: unknown, code: string): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }

    if ('code' in current && (current as { code?: unknown }).code === code) {
      return true;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

/** True when the failure is a PostgreSQL unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return hasPostgresErrorCode(error, UNIQUE_VIOLATION_CODE);
}
