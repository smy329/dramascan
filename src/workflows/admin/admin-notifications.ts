'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/contracts/common';
import { resolveActor } from '@/modules/authorization';
import { setAdminNotificationRead } from '@/modules/notifications';
import { NotFoundError } from '@/platform/errors';
import { toActionError } from '@/workflows/action-errors';

import { toAdminNotificationViewer } from './admin-notification-viewer';

/**
 * The administrator notification-centre actions (D-067).
 *
 * Reading an alert is authorized by `admin.manage`. Announcement management is
 * a different permission and lives in `workflows/admin/announcements.ts`; the
 * two surfaces share a page but not a permission.
 */

const readInputSchema = z.object({
  id: z.string().uuid(),
  read: z.boolean(),
});

/**
 * Mark one visible alert read or unread for the signed-in administrator.
 *
 * The alert is re-checked against the audience on the server: a client cannot
 * write read state for an alert it may not see.
 *
 * @param input the alert id and the desired read state
 * @returns the alert id and the state that was written
 */
export async function setAdminNotificationReadAction(
  input: unknown
): Promise<ActionResult<{ id: string; read: boolean }>> {
  try {
    const actor = await resolveActor();
    const viewer = toAdminNotificationViewer(actor);

    if (!viewer) {
      return {
        ok: false,
        error: { code: 'forbidden', message: 'You may not read administrator alerts.' },
      };
    }

    const parsed = readInputSchema.safeParse(input);

    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'validation_error', message: 'The alert id is not valid.' },
      };
    }

    const changed = await setAdminNotificationRead(
      viewer,
      parsed.data.id,
      parsed.data.read
    );

    if (!changed) {
      throw new NotFoundError('Alert not found.');
    }

    return { ok: true, data: parsed.data };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
