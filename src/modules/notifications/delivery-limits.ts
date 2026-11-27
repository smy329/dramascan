/**
 * The delivery limits of the notification module (Prompt 154).
 *
 * These numbers are the rules the application and the short-lived maintenance
 * command both apply. The command is a plain `.mjs` script that mirrors the
 * application's delivery rules in SQL, because it runs on bare Node without a
 * build step and cannot import the module index (which is `server-only` and
 * pulls in the database client).
 *
 * The *numbers* are therefore shared, so a limit that exists in only one of
 * the two places cannot make the command and the application disagree: the
 * command would retry a notification the application had abandoned, or keep a
 * delivery record the application had removed.
 *
 * The file is pure: no import, no `server-only` marker, no alias. Node can run
 * it directly.
 */

/** The maximum number of delivery attempts one call makes. */
export const MAX_DELIVERY_ATTEMPTS = 10;

/** How long one maintenance run owns a delivery candidate, in seconds. */
export const DELIVERY_LEASE_SECONDS = 300;

/** The maximum number of push attempts one notification ever receives. */
export const MAX_PUSH_RETRY_ATTEMPTS = 3;

/** How far back the delivery maintenance looks for an undelivered notification. */
export const PUSH_RETRY_WINDOW_DAYS = 7;

/** The retention window of the delivery trail, in days. */
export const DELIVERY_RETENTION_DAYS = 30;
