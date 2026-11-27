/**
 * The notification preference contract (Prompt 150 / D-085).
 *
 * The switches are edited in the browser and saved by a Server Action. The
 * schema is the single definition of a valid switch set: the form validates
 * against it, and the action re-validates against the same schema. Two
 * definitions would let the browser accept something the server rejects.
 *
 * The account/security notification is mandatory, so it has no field: a
 * payload that tries to switch it off is rejected rather than silently
 * ignored. The schema is strict for the same reason — an unknown switch is a
 * client that speaks a contract the server does not know.
 */

import { z } from 'zod';

/**
 * The switches a viewer may change.
 *
 * Every switch is optional, because the form sends only the switches the
 * viewer changed: two devices cannot silently reset each other. A payload
 * with no switch at all is a valid no-op — the viewer saved nothing.
 */
export const notificationPreferencesSchema = z.strictObject({
  newEpisode: z.boolean().optional(),
  newDrama: z.boolean().optional(),
  newDramaSeason: z.boolean().optional(),
  websiteAnnouncement: z.boolean().optional(),
  globalInApp: z.boolean().optional(),
  globalPush: z.boolean().optional(),
});

/** The values the notification preference form holds. */
export type NotificationPreferencesValues = z.infer<typeof notificationPreferencesSchema>;
