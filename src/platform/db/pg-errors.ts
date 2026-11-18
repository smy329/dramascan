/**
 * PostgreSQL error inspection helpers.
 *
 * The database driver surfaces constraint violations as errors carrying a
 * five-character SQLSTATE in `code`. Reading that property keeps the workflows
 * independent of the driver's error classes and avoids importing `pg` types
 * into modules that must stay portable.
 */

/** SQLSTATE for `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/**
 * Whether an error is a PostgreSQL unique-constraint violation.
 *
 * Workflows use this to convert a race that slipped past the friendly
 * duplicate check into the same field error, instead of surfacing a 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  return (error as { code?: unknown }).code === UNIQUE_VIOLATION;
}
