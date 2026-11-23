'use server';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import type { ActionError } from '@/lib/contracts/common';
import {
  deleteSubtitleTrackFormSchema,
  subtitleTrackFormSchema,
  type SubtitleTrackDto,
} from '@/lib/contracts/subtitle-track-form';
import { requirePermission, resolveActor } from '@/modules/authorization';
import { episodes } from '@/modules/content/schema';
import { parseOrThrow } from '@/modules/content/validation';
import { deleteSubtitleTrack, upsertSubtitleTrack } from '@/modules/playback';
import { NotFoundError } from '@/platform/errors';

import { toActionError } from '../action-errors';

/**
 * Server Actions behind the subtitle-track management UI.
 *
 * The actor is resolved from the session and `episode.manage` is re-checked
 * here: the client is never the authority. The payload is validated against
 * the same rules the playback module enforces, and the episode has to exist
 * and must not be in the Trash, so a track cannot be attached to an episode
 * that is no longer active.
 *
 * The server never downloads, converts, or rehosts a subtitle file. It stores
 * the administrator-supplied direct HTTPS URL; the browser fetches it.
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: ActionError };

/** Permission key for episode and subtitle management. */
const MANAGE_PERMISSION = 'episode.manage';

/** True when the episode exists and is not in the Trash. */
async function isActiveEpisode(episodeId: string): Promise<boolean> {
  const [episode] = await db
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), isNull(episodes.deleted_at)))
    .limit(1);

  return episodeId === episode?.id;
}

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

    const values = parseOrThrow(subtitleTrackFormSchema, input);

    const active = await isActiveEpisode(values.episodeId);

    if (!active) {
      return {
        ok: false,
        error: toActionError(new NotFoundError('Episode not found.')),
      };
    }

    const track = await upsertSubtitleTrack({
      episodeId: values.episodeId,
      language: values.language,
      label: values.label,
      sourceUrl: values.sourceUrl,
      format: values.format,
      isDefault: values.isDefault,
    });

    return {
      ok: true,
      data: {
        id: track.id,
        episodeId: track.episodeId,
        language: track.language,
        label: track.label,
        sourceUrl: track.sourceUrl,
        format: track.format,
        isDefault: track.isDefault,
      },
    };
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

    const values = parseOrThrow(deleteSubtitleTrackFormSchema, input);

    const deleted = await deleteSubtitleTrack(values.episodeId, values.trackId);

    if (!deleted) {
      return {
        ok: false,
        error: toActionError(new NotFoundError('Subtitle track not found.')),
      };
    }

    return { ok: true, data: { id: values.trackId } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
