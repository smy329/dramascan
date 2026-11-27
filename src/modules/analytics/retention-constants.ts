/**
 * Analytics retention constants.
 *
 * These constants are shared between the application-side implementation
 * (`src/modules/analytics/retention.ts`) and the maintenance script
 * (`scripts/analytics-retention.mjs`). They are kept in a separate file
 * without `server-only` so the CLI script can import them at runtime.
 */

/** How long the raw analytics events are kept, in days. */
export const ANALYTICS_EVENT_RETENTION_DAYS = 400;

/** How long a guest-session row is kept, in days. */
export const GUEST_SESSION_RETENTION_DAYS = 400;

/** The default number of rows one run removes from one table. */
export const ANALYTICS_RETENTION_BATCH_SIZE = 1000;

/** The largest batch one run may remove from one table. */
export const ANALYTICS_RETENTION_MAX_BATCH_SIZE = 10_000;

/** One day in milliseconds. */
export const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
