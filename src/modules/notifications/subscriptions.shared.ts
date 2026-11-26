/**
 * The browser push subscription contract (Prompt 154).
 *
 * This file is pure: it holds the shape of one stored subscription, and
 * nothing else. It carries no `server-only` marker and no database import, so
 * a client island may import it directly (D-049).
 */

/** One stored subscription. */
export type PushSubscription = {
  id: string;
  userId: string;
  endpoint: string;
  browser: string | null;
  createdAt: Date;
};
