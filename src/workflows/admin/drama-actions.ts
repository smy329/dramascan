'use server';

import type { ActionResult } from '@/lib/contracts/common';
import { dramaFormSchema, dramaSlugFromTitle } from '@/lib/contracts/drama-form';
import { resolveActor, requirePermission } from '@/modules/authorization';
import { parseOrThrow } from '@/modules/content/validation';
import { AppError, InternalError } from '@/platform/errors';
import { mapErrorToActionResult } from '@/platform/Http';

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

/**
 * Convert a workflow error into the standard `ActionResult` error shape.
 *
 * `createDrama` reports the duplicate-slug case as a plain serializable object
 * (not an `AppError`), so both shapes are accepted. Anything unrecognized is
 * wrapped as an internal error rather than leaked to the client.
 */
function toActionError(error: unknown): {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  requestId?: string;
} {
  if (error instanceof AppError) {
    return mapErrorToActionResult(error).error;
  }

  if (isActionErrorLike(error)) {
    return error;
  }

  return mapErrorToActionResult(
    new InternalError('An unexpected error occurred.', error instanceof Error ? error : undefined)
  ).error;
}

function isActionErrorLike(
  error: unknown
): error is { code: string; message: string; fieldErrors?: Record<string, string[]> } {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown; fieldErrors?: unknown };

  if (typeof candidate.code !== 'string' || typeof candidate.message !== 'string') {
    return false;
  }

  const fieldErrors = candidate.fieldErrors;

  if (fieldErrors === undefined) {
    return true;
  }

  return typeof fieldErrors === 'object' && fieldErrors !== null;
}

/**
 * Move a slug conflict onto the Title field.
 *
 * The form has no slug input, so a `slug` field error would render nowhere and
 * the administrator would only see the alert. The conflict is still caused by
 * the title they typed, so the message belongs on that field.
 */
function withSlugErrorOnTitle(error: {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  requestId?: string;
}): {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  requestId?: string;
} {
  const fieldErrors: Record<string, string[]> = { ...error.fieldErrors };
  const slugMessages = fieldErrors.slug;

  if (!slugMessages) {
    return error;
  }

  delete fieldErrors.slug;
  fieldErrors.title = slugMessages;

  return { ...error, fieldErrors };
}

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
      return { ok: false, error: withSlugErrorOnTitle(toActionError(result.error)) };
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
