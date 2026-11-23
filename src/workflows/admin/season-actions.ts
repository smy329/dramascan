'use server';

import type { ActionError } from '@/lib/contracts/common';

type Result<T> = { ok: true; data: T } | { ok: false; error: ActionError };
import {
  deleteSeasonFormSchema,
  reorderSeasonsFormSchema,
  seasonFormSchema,
  updateSeasonFormSchema,
  type SeasonDto,
} from '@/lib/contracts/season-form';
import { resolveActor, requirePermission } from '@/modules/authorization';
import { parseOrThrow } from '@/modules/content/validation';

import { toActionError } from '../action-errors';
import { createSeason, deleteSeason, reorderSeasons, updateSeason } from './seasons';

/**
 * Server Actions behind the season management UI.
 *
 * Resolves the actor and re-checks `season.manage`. Payloads are re-validated
 * here before the workflow runs, and both a returned `ok:false` error and a
 * thrown value are mapped through the shared error adapter.
 */

export async function createSeasonAction(
  input: unknown
): Promise<Result<SeasonDto>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'season.manage');

    const values = parseOrThrow(seasonFormSchema, input);

    const result = await createSeason(actor, values.dramaId, {
      title: values.title,
      position: values.position,
    });

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: { ...result.season, episodeCount: 0 } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function updateSeasonAction(
  input: unknown
): Promise<Result<SeasonDto>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'season.manage');

    const values = parseOrThrow(updateSeasonFormSchema, input);

    const result = await updateSeason(actor, values.id, {
      title: values.title,
      position: values.position,
    });

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: { ...result.season, episodeCount: 0 } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function deleteSeasonAction(
  input: unknown
): Promise<Result<{ affectedEpisodes: number }>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'season.manage');

    const values = parseOrThrow(deleteSeasonFormSchema, input);

    const result = await deleteSeason(actor, values.id);

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: { affectedEpisodes: result.affectedEpisodes } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function reorderSeasonsAction(
  input: unknown
): Promise<Result<{ reordered: number }>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'season.manage');

    const values = parseOrThrow(reorderSeasonsFormSchema, input);

    const result = await reorderSeasons(actor, values.drama_id, values.ids);

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return { ok: true, data: { reordered: result.reordered } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

