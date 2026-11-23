import 'server-only';

import { z } from 'zod';

import { db } from '@/db/client';
import {
  deleteSubtitleTrackFormSchema,
  subtitleTrackFormSchema,
  type SubtitleTrackDto,
} from '@/lib/contracts/subtitle-track-form';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import {
  deleteSubtitleTrack,
  upsertSubtitleTrack,
} from '@/modules/playback';
import { NotFoundError, ValidationError } from '@/platform/errors';

/**
 * Administrative playback workflows.
 *
 * These workflows own the transaction boundary for the subtitle tracks. The
 * module services take an optional executor, so the whole operation runs on
 * one transaction handle: demoting the previous default track and writing the
 * new one is a single unit of work. An episode therefore never ends up with
 * two default tracks, or with none.
 *
 * The workflow does not read or write the episode table itself. It asks the
 * content module, through its public API, whether the episode is still
 * active — the content module owns the episode hierarchy, and a playback
 * workflow has no business reaching into another module's tables.
 */

/** Permission key for episode and subtitle management. */
const MANAGE_PERMISSION = 'episode.manage';

/**
 * Parse a form payload, throwing a validation error on failure.
 *
 * The form contract is the client-safe shape of the payload; the module
 * applies its own domain rules to the parsed value afterwards, so the client
 * and the server never disagree about what a valid track is.
 */
function parseForm<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};

    for (const issue of parsed.error.issues) {
      const field = issue.path.length > 0 ? String(issue.path[0]) : 'form';
      const messages = fieldErrors[field] ?? [];
      messages.push(issue.message);
      fieldErrors[field] = messages;
    }

    throw new ValidationError('The request contains invalid fields.', fieldErrors);
  }

  return parsed.data;
}

/**
 * Add a subtitle track to an episode, or replace the track of the same
 * language.
 *
 * The track and the episode's previous default are written in one
 * transaction, so a failure never leaves the episode without a default track.
 */
export async function upsertSubtitleTrackWorkflow(
  actor: ActorContext,
  input: unknown
): Promise<SubtitleTrackDto> {
  requirePermission(actor, MANAGE_PERMISSION);

  const values = parseForm(subtitleTrackFormSchema, input);

  const track = await db.transaction(tx => upsertSubtitleTrack(actor, values, tx));

  return {
    id: track.id,
    episodeId: track.episodeId,
    language: track.language,
    label: track.label,
    sourceUrl: track.sourceUrl,
    format: track.format,
    isDefault: track.isDefault,
  };
}

/** Remove one subtitle track of an episode. */
export async function deleteSubtitleTrackWorkflow(
  actor: ActorContext,
  input: unknown
): Promise<{ id: string }> {
  requirePermission(actor, MANAGE_PERMISSION);

  const values = parseForm(deleteSubtitleTrackFormSchema, input);

  const deleted = await db.transaction(tx =>
    deleteSubtitleTrack(actor, values.episodeId, values.trackId, tx)
  );

  if (!deleted) {
    throw new NotFoundError('Subtitle track not found.');
  }

  return { id: values.trackId };
}
