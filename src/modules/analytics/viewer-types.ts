/**
 * The viewer classification of an analytics event (D-074).
 *
 * The event tables carry no personal identifier, so they cannot answer "was
 * this viewer signed in?" on their own. The `guest_sessions.user_id` column
 * cannot answer it either: the row is linked to the account when the viewer
 * signs in, so a later join reclassifies the events that were recorded before
 * the sign-in.
 *
 * The classification is therefore taken from the request and written on the
 * event row: it says what the viewer was *when the event happened*.
 *
 * The rule is pure, so it can be unit-tested without a database.
 */

/**
 * How a viewer was classified when the event happened.
 *
 * The classification names the kind of viewer, never the account: the event
 * tables stay free of personal identifiers.
 */
export const ANALYTICS_VIEWER_TYPES = ['guest', 'authenticated'] as const;

/** One viewer classification. */
export type AnalyticsViewerType = (typeof ANALYTICS_VIEWER_TYPES)[number];

/**
 * Classify the viewer of a request.
 *
 * The answer comes from the request, not from the resolved session row: a
 * visitor who signed out keeps the linked session row, and a request that
 * arrives without a session is a guest even when the row still names an
 * account.
 *
 * @param userId the account of the request, when it has one
 * @returns the classification of the request
 */
export function analyticsViewerType(userId: string | null): AnalyticsViewerType {
  return userId === null ? 'guest' : 'authenticated';
}
