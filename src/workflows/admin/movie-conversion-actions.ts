'use server';

import type { ActionResult } from '@/lib/contracts/common';
import type {
  MovieConversionApplyResultDto,
  MovieConversionPreviewDto,
} from '@/lib/contracts/drama-movie-conversion';
import { resolveActor, requirePermission } from '@/modules/authorization';
import { AppError, InternalError } from '@/platform/errors';
import { mapErrorToActionResult } from '@/platform/Http';

import { applyMovieConversion, previewMovieConversion } from './movie-conversion';

/**
 * Server Actions for the drama → movie conversion page.
 *
 * They resolve the actor, enforce `drama.manage`, and delegate to the same
 * workflow the REST endpoint uses. Errors are mapped to the standard
 * `ActionResult` shape and never thrown across the client boundary.
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

  return mapErrorToActionResult(
    new InternalError('An unexpected error occurred.', error instanceof Error ? error : undefined)
  ).error;
}

export async function previewDramaMovieConversion(
  dramaId: string
): Promise<ActionResult<MovieConversionPreviewDto>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'drama.manage');

    const plan: MovieConversionPreviewDto = await previewMovieConversion(actor, {
      dramaId,
      mode: 'preview',
    });

    return { ok: true, data: plan };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function applyDramaMovieConversion(
  dramaId: string,
  fingerprint: string
): Promise<ActionResult<MovieConversionApplyResultDto>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'drama.manage');

    const result: MovieConversionApplyResultDto = await applyMovieConversion(actor, {
      dramaId,
      mode: 'apply',
      fingerprint,
    });

    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
