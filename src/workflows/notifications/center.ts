'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/contracts/common';
import { requireUserId, resolveActor } from '@/modules/authorization';
import {
  dismissNotification,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/modules/notifications';
import { toActionError } from '@/workflows/action-errors';

/**
 * The notification centre actions (Prompt 149).
 *
 * Every action is scoped to the signed-in viewer. The write is scoped by the
 * viewer's id in the database, so a guessed notification id cannot reach
 * somebody else's notification.
 */

const notificationIdSchema = z.string().uuid();

/**
 * Mark one notification as read.
 *
 * @param notificationId the notification
 * @returns whether the notification was marked
 */
export async function markNotificationReadAction(
  notificationId: unknown
): Promise<ActionResult<{ marked: boolean }>> {
  try {
    const actor = await resolveActor();
    const userId = requireUserId(actor);

    const parsed = notificationIdSchema.safeParse(notificationId);

    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'validation_error', message: 'The notification id is not valid.' },
      };
    }

    const marked = await markNotificationRead(userId, parsed.data);

    return { ok: true, data: { marked } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/**
 * Mark every one of the viewer's notifications as read.
 *
 * @returns how many notifications were marked
 */
export async function markAllNotificationsReadAction(): Promise<
  ActionResult<{ marked: number }>
> {
  try {
    const actor = await resolveActor();
    const userId = requireUserId(actor);

    const marked = await markAllNotificationsRead(userId);

    return { ok: true, data: { marked } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/**
 * Remove one of the viewer's notifications from the centre.
 *
 * @param notificationId the notification
 * @returns whether the notification was removed
 */
export async function dismissNotificationAction(
  notificationId: unknown
): Promise<ActionResult<{ dismissed: boolean }>> {
  try {
    const actor = await resolveActor();
    const userId = requireUserId(actor);

    const parsed = notificationIdSchema.safeParse(notificationId);

    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'validation_error', message: 'The notification id is not valid.' },
      };
    }

    const dismissed = await dismissNotification(userId, parsed.data);

    return { ok: true, data: { dismissed } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
