'use server';

import type { ActionResult } from '@/lib/contracts/common';
import { dramaFormSchema, dramaSlugFromTitle } from '@/lib/contracts/drama-form';
import { resolveActor, requirePermission } from '@/modules/authorization';
import { parseOrThrow } from '@/modules/content/validation';

import { toActionError, withFieldError } from './action-errors';
import { createDrama } from './dramas';

/**
 * Server Action behind the admin drama create form.
 *
 * The action resolves the actor itself and re-checks `drama.manage`; the form
 * is never trusted to enforce access. The submitted values are re-validated
 * here and normalized into the domain payload, then `createDrama` performs the
 * authoritative validation, duplicate-slug check, association check, and the
 * transactional insert.
 */

/** Serializable result returned to the client on success. */
export type CreatedDramaDto = Readonly<{
  id: string;
  title: string;
  slug: string;
  structure_type: string;
}>;

export async function createDramaAction(input: unknown): Promise<ActionResult<CreatedDramaDto>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'drama.manage');

    const values = parseOrThrow(dramaFormSchema, input);

    const result = await createDrama(actor, {
      title: values.title,
      // The administrator never chooses the slug. Deriving it here from the
      // validated title keeps the Server Action authoritative; the form's
      // stricter schema has already rejected a title with no derivable slug.
      slug: dramaSlugFromTitle(values.title),
      description: values.description === '' ? undefined : values.description,
      status: values.status,
      structure_type: values.structure_type,
      poster: values.poster === '' ? null : values.poster,
      banner: values.banner === '' ? null : values.banner,
      categories: values.categories,
      platforms: values.platforms,
    });

    if (!result.ok) {
      return { ok: false, error: withFieldError(toActionError(result.error), 'slug', 'title') };
    }

    return {
      ok: true,
      data: {
        id: result.drama.id,
        title: result.drama.title,
        slug: result.drama.slug,
        structure_type: result.drama.structure_type,
      },
    };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
