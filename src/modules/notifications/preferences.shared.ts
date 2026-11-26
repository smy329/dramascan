/**
 * The notification preference contract (Prompts 150, 151).
 *
 * This file is pure: it holds the shape of a viewer's preference set and the
 * default set, and nothing else. It carries no `server-only` marker and no
 * database import, so a client island may import it directly (D-049).
 *
 * The preference set is the contract between the server, which decides what a
 * viewer may be told, and the browser, which shows the switches. One
 * definition keeps the two from drifting.
 */

/** A viewer's complete preference set. */
export type NotificationPreferenceSet = {
  newEpisode: boolean;
  newDrama: boolean;
  newDramaSeason: boolean;
  websiteAnnouncement: boolean;
  /** Always `true`: the column exists for completeness, but it cannot be switched off. */
  accountSecurity: boolean;
  globalInApp: boolean;
  globalPush: boolean;
};

/** The default preference set: everything on. */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferenceSet = {
  newEpisode: true,
  newDrama: true,
  newDramaSeason: true,
  websiteAnnouncement: true,
  accountSecurity: true,
  globalInApp: true,
  globalPush: true,
};
