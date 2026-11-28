'use server';

import type { ActionError } from '@/lib/contracts/common';

type Result<T> = { ok: true; data: T } | { ok: false; error: ActionError };
import {
  deleteEpisodeFormSchema,
  episodeFormSchema,
  renumberEpisodesFormSchema,
  reorderEpisodesFormSchema,
  replaceVideoSourceFormSchema,
  updateEpisodeFormSchema,
  type EpisodeDto,
} from '@/lib/contracts/episode-form';
import { resolveActor, requirePermission } from '@/modules/authorization';
import { parseOrThrow } from '@/modules/content/validation';
import { z } from 'zod';

import { toActionError } from '../action-errors';
import {
  createEpisode,
  deleteEpisode,
  renumberEpisodes,
  reorderEpisodes,
  replaceEpisodeVideoSource,
  updateEpisode,
} from './episodes';
import { updatePublication } from './publication';

/**
 * Server Actions behind the episode management UI.
 *
 * Resolves the actor and re-checks `episode.manage`. Payloads are re-validated
 * here before the workflow runs, and both a returned `ok:false` error and a
 * thrown value are mapped through the shared error adapter.
 */

export async function createEpisodeAction(
  input: unknown
): Promise<Result<EpisodeDto>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'episode.manage');

    const values = parseOrThrow(episodeFormSchema, input);

    const result = await createEpisode(actor, values.dramaId, {
      title: values.title,
      description: values.description,
      season_id: values.season_id,
      episode_number: values.episode_number,
      video_source: values.video_source,
      // The administrator's preview confirmation travels with the payload: the
      // content module refuses a source that was not verified in the browser.
      video_source_preview_confirmed: values.video_source_preview_confirmed,
    });

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: result.episode };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function updateEpisodeAction(
  input: unknown
): Promise<Result<EpisodeDto>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'episode.manage');

    const values = parseOrThrow(updateEpisodeFormSchema, input);

    const result = await updateEpisode(actor, values.id, {
      title: values.title,
      description: values.description,
      episode_number: values.episode_number,
      season_id: values.season_id,
      video_source: values.video_source,
    });

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: result.episode };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/**
 * Replace an episode's video source.
 *
 * The action is only reachable after the administrator has watched the new URL
 * play in the browser preview and confirmed the replacement. The server
 * re-validates the URL and performs the replacement, the viewer-progress
 * reset, and the operational record as one transaction.
 */
export async function replaceEpisodeVideoSourceAction(
  input: unknown
): Promise<Result<EpisodeDto>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'episode.manage');

    const values = parseOrThrow(replaceVideoSourceFormSchema, input);

    const result = await replaceEpisodeVideoSource(actor, values.episodeId, {
      videoSource: values.videoSource,
      previewConfirmed: values.previewConfirmed,
    });

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: result.episode };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function deleteEpisodeAction(
  input: unknown
): Promise<Result<{ id: string }>> {  try {
    const actor = await resolveActor();
    requirePermission(actor, 'episode.manage');

    const values = parseOrThrow(deleteEpisodeFormSchema, input);

    const result = await deleteEpisode(actor, values.id);

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: { id: values.id } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function reorderEpisodesAction(
  input: unknown
): Promise<Result<{ episodesReordered: number }>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'episode.manage');

    const values = parseOrThrow(reorderEpisodesFormSchema, input);

    const result = await reorderEpisodes(actor, values.drama_id, values.ids);

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: { episodesReordered: result.episodesReordered } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function renumberEpisodesAction(
  input: unknown
): Promise<Result<{ episodesModified: number }>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'episode.manage');

    const values = parseOrThrow(renumberEpisodesFormSchema, input);

    const result = await renumberEpisodes(actor, values.drama_id);

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: { episodesModified: result.episodesModified } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/**
 * Publish a single episode.
 *
 * Delegates to the shared publication workflow so eligibility rules
 * (video source present, valid format, not trashed) are enforced consistently.
 */
export async function publishEpisodeAction(
  input: unknown
): Promise<Result<{ id: string; publicationStatus: string; publiclyAvailable: boolean }>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'episode.manage');

    const values = parseOrThrow(z.object({ id: z.uuid() }), input);

    const result = await updatePublication(actor, {
      contentType: 'episode',
      action: 'publish',
      ids: [values.id],
    });

    const item = result.results[0];
    if (!item || item.status !== 'succeeded') {
      return {
        ok: false,
        error: toActionError({
          code: 'publication_failed',
          message: item?.message ?? 'Publication failed',
        } as ActionError),
      };
    }

    return { ok: true, data: { id: item.id, publicationStatus: item.publicationStatus ?? 'published', publiclyAvailable: item.publiclyAvailable ?? false } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/**
 * Unpublish a single episode.
 */
export async function unpublishEpisodeAction(
  input: unknown
): Promise<Result<{ id: string; publicationStatus: string; publiclyAvailable: boolean }>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'episode.manage');

    const values = parseOrThrow(z.object({ id: z.uuid() }), input);

    const result = await updatePublication(actor, {
      contentType: 'episode',
      action: 'unpublish',
      ids: [values.id],
    });

    const item = result.results[0];
    if (!item || item.status !== 'succeeded') {
      return {
        ok: false,
        error: toActionError({
          code: 'unpublication_failed',
          message: item?.message ?? 'Unpublication failed',
        } as ActionError),
      };
    }

    return { ok: true, data: { id: item.id, publicationStatus: item.publicationStatus ?? 'unpublished', publiclyAvailable: item.publiclyAvailable ?? false } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
