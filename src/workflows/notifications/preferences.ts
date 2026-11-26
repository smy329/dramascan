'use server';

import type { ActionResult } from '@/lib/contracts/common';
import {
  notificationPreferencesSchema,
} from '@/lib/contracts/notification-preferences';
import { requireUserId, resolveActor } from '@/modules/authorization';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationPreferenceSet,
} from '@/modules/notifications';
import { toActionError } from '@/workflows/action-errors';

/**
 * The notification preference action (Prompt 150).
 *
 * The switches belong to the signed-in viewer. The action resolves the viewer
 * from the server-side session — a client can never assert whose preferences
 * it is changing — and writes only the switches the form actually changed.
 *
 * The action validates with the same schema the form validates with, so the
 * browser cannot submit a shape the server does not accept (D-085).
 */

/**
 * Save the viewer's notification preferences.
 *
 * @param input the changed switches
 * @returns the saved preference set
 */
export async function saveNotificationPreferences(
  input: unknown
): Promise<ActionResult<NotificationPreferenceSet>> {
  try {
    const actor = await resolveActor();
    const userId = requireUserId(actor);

    const parsed = notificationPreferencesSchema.safeParse(input);

    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'validation_error',
          message: 'The notification preferences are not valid.',
          fieldErrors: {
            body: parsed.error.issues.map(issue => issue.message),
          },
        },
      };
    }

    const saved = await updateNotificationPreferences(userId, parsed.data);

    return { ok: true, data: saved };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/**
 * Read the viewer's notification preferences.
 *
 * @returns the preference set
 */
export async function readNotificationPreferences(): Promise<
  ActionResult<NotificationPreferenceSet>
> {
  try {
    const actor = await resolveActor();
    const userId = requireUserId(actor);

    return { ok: true, data: await getNotificationPreferences(userId) };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
