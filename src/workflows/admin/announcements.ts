'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/contracts/common';
import { hasPermission, requireUserId, resolveActor, toPermissionKey } from '@/modules/authorization';
import {
  createAnnouncement,
  publishAnnouncement,
  type AnnouncementPublicationResult,
  type AnnouncementView,
} from '@/modules/notifications';
import { toActionError } from '@/workflows/action-errors';

/**
 * The announcement administration actions (Prompt 153).
 *
 * An authorized administrator writes an announcement and publishes it by hand.
 * There is no scheduled publication and no recurring announcement: the
 * announcement is delivered when the administrator publishes it, and never
 * again.
 */

const announcementInputSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(5000),
});

/**
 * Create a draft announcement.
 *
 * @param input the announcement
 * @returns the created announcement
 */
export async function createAnnouncementAction(
  input: unknown
): Promise<ActionResult<AnnouncementView>> {
  try {
    const actor = await resolveActor();
    const userId = requireUserId(actor);

    if (!hasPermission(actor, toPermissionKey('settings', 'manage'))) {
      return {
        ok: false,
        error: { code: 'forbidden', message: 'You may not create announcements.' },
      };
    }

    const parsed = announcementInputSchema.safeParse(input);

    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'validation_error',
          message: 'The announcement is not valid.',
          fieldErrors: {
            body: parsed.error.issues.map(issue => issue.message),
          },
        },
      };
    }

    const announcement = await createAnnouncement({
      title: parsed.data.title,
      content: parsed.data.content,
      authorId: userId,
    });

    return { ok: true, data: announcement };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/**
 * Publish an announcement and notify the eligible viewers.
 *
 * @param announcementId the announcement
 * @returns what the publication did
 */
export async function publishAnnouncementAction(
  announcementId: unknown
): Promise<ActionResult<AnnouncementPublicationResult>> {
  try {
    const actor = await resolveActor();
    requireUserId(actor);

    if (!hasPermission(actor, toPermissionKey('settings', 'manage'))) {
      return {
        ok: false,
        error: { code: 'forbidden', message: 'You may not publish announcements.' },
      };
    }

    const parsed = z.string().uuid().safeParse(announcementId);

    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'validation_error', message: 'The announcement id is not valid.' },
      };
    }

    return { ok: true, data: await publishAnnouncement(parsed.data) };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
