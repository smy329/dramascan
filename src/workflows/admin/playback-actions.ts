'use server';

import type { ActionError } from '@/lib/contracts/common';
import type { SubtitleTrackDto } from '@/lib/contracts/subtitle-track-form';
import { requirePermission, resolveActor } from '@/modules/authorization';

import { toActionError } from '../action-errors';
import {
  deleteSubtitleTrackWorkflow,
  upsertSubtitleTrackWorkflow,
} from './playback';

/**
 * Server Actions behind the subtitle-track management UI.
 *
 * The actor is resolved from the session and `episode.manage` is re-checked
 * here: the client is never the authority. The payload is parsed and the
 * episode is checked by the workflow, which owns the transaction that writes
 * the track.
 *
 * This file is an adapter only. It reads no table and writes no SQL: the
 * playback module owns its rows, and the workflow owns the transaction.
 *
 * The server never downloads, converts, or rehosts a subtitle file. It stores
 * the administrator-supplied direct HTTPS URL; the browser fetches it.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: ActionError };

/** Permission key for episode and subtitle management. */
const MANAGE_PERMISSION = 'episode.manage';

/**
 * Add a subtitle track to an episode, or replace the track of the same
 * language.
 */
export async function upsertSubtitleTrackAction(
  input: unknown
): Promise<Result<SubtitleTrackDto>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, MANAGE_PERMISSION);

    const track = await upsertSubtitleTrackWorkflow(actor, input);

    return { ok: true, data: track };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/** Remove one subtitle track of an episode. */
export async function deleteSubtitleTrackAction(
  input: unknown
): Promise<Result<{ id: string }>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, MANAGE_PERMISSION);

    const deleted = await deleteSubtitleTrackWorkflow(actor, input);

    return { ok: true, data: deleted };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
