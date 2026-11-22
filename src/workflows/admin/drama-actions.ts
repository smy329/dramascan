'use server';

import type { ActionResult } from '@/lib/contracts/common';
import {
  dramaFormSchema,
  dramaSlugFromTitle,
  type DramaFormValues,
} from '@/lib/contracts/drama-form';
import { resolveActor, requirePermission } from '@/modules/authorization';
import { parseOrThrow } from '@/modules/content/validation';

import { toActionError, withFieldError } from './action-errors';
import { createDrama, deleteDrama, updateDrama } from './dramas';

/**
 * Server Actions behind the admin drama forms.
 *
 * The client schema mirrors the domain schema but has no slug input: the slug is
 * always derived from the title, both here and in the form. The domain workflow
 * re-validates with `createDramaSchema`/`updateDramaSchema`, which stays the
 * authoritative contract.
 */

export type DramaActionData = {
  id: string;
  title: string;
  slug: string;
  structure_type: string;
};

/** Normalize the transport-only blanks into domain values. */
function toDomainInput(values: DramaFormValues): Record<string, unknown> {
  return {
    title: values.title,
    slug: dramaSlugFromTitle(values.title),
    description: values.description?.trim() ? values.description : undefined,
    status: values.status,
    structure_type: values.structure_type,
    visibility: values.visibility,
    poster: values.poster === '' || values.poster === undefined ? null : values.poster,
    banner: values.banner === '' || values.banner === undefined ? null : values.banner,
    categories: values.categories,
    platforms: values.platforms,
  };
}

function toData(drama: {
  id: string;
  title: string;
  slug: string;
  structure_type: string;
}): DramaActionData {
  return {
    id: drama.id,
    title: drama.title,
    slug: drama.slug,
    structure_type: drama.structure_type,
  };
}

/** Create a drama from the admin create form. */
export async function createDramaAction(_payload: unknown): Promise<ActionResult<DramaActionData>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'drama.manage');

    const values = parseOrThrow(dramaFormSchema, _payload);
    const result = await createDrama(actor, toDomainInput(values));

    if (!result.ok) {
      return { ok: false, error: withFieldError(toActionError(result.error), 'slug', 'title') };
    }

    return { ok: true, data: toData(result.drama) };
  } catch (error) {
    return { ok: false, error: withFieldError(toActionError(error), 'slug', 'title') };
  }
}

/** Update an existing drama's metadata from the admin edit form. */
export async function updateDramaAction(
  dramaId: string,
  _payload: unknown
): Promise<ActionResult<DramaActionData>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'drama.manage');

    const values = parseOrThrow(dramaFormSchema, _payload);
    const result = await updateDrama(actor, dramaId, toDomainInput(values));

    if (!result.ok) {
      return { ok: false, error: withFieldError(toActionError(result.error), 'slug', 'title') };
    }

    return { ok: true, data: toData(result.drama) };
  } catch (error) {
    return { ok: false, error: withFieldError(toActionError(error), 'slug', 'title') };
  }
}

/** The result of moving a drama to Trash. */
export type TrashDramaData = {
  id: string;
  affectedSeasons: number;
  affectedEpisodes: number;
};

/**
 * Move a drama to Trash.
 *
 * The action reports the affected child records so the confirmation dialog can
 * tell the administrator exactly what goes into the Trash with the drama.
 */
export async function deleteDramaAction(dramaId: string): Promise<ActionResult<TrashDramaData>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'drama.manage');

    const result = await deleteDrama(actor, dramaId);

    if (!result.ok) {
      return { ok: false, error: toActionError(result.error) };
    }

    return {
      ok: true,
      data: {
        id: dramaId,
        affectedSeasons: result.affectedSeasons,
        affectedEpisodes: result.affectedEpisodes,
      },
    };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
