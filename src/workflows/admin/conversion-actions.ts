'use server';

import type { ActionResult } from '@/lib/contracts/common';
import type {
  ConversionActionPayloadDto,
  ConversionApplyResultDto,
  ConversionPlanDto,
  ConversionRequestDto,
} from '@/lib/contracts/drama-conversion';
import { resolveActor, requirePermission } from '@/modules/authorization';
import { AppError, InternalError } from '@/platform/errors';
import { mapErrorToActionResult } from '@/platform/Http';

import { applyConversion, previewConversion } from './conversion';

/**
 * Server Actions for the drama structure conversion page.
 *
 * They resolve the actor, enforce `drama.manage`, and delegate to the same
 * workflow the REST endpoint uses. Errors are mapped to the standard
 * `ActionResult` shape and never thrown across the client boundary.
 */

function withDramaId(dramaId: string, input: ConversionRequestDto): ConversionActionPayloadDto {
  return { ...input, dramaId };
}

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

export async function previewDramaConversion(
  dramaId: string,
  input: ConversionRequestDto
): Promise<ActionResult<ConversionPlanDto>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'drama.manage');

    const plan: ConversionPlanDto = await previewConversion(actor, withDramaId(dramaId, input));

    return { ok: true, data: plan };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

export async function applyDramaConversion(
  dramaId: string,
  input: ConversionRequestDto
): Promise<ActionResult<ConversionApplyResultDto>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'drama.manage');

    const result = await applyConversion(actor, withDramaId(dramaId, input));
    const data: ConversionApplyResultDto = result;

    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
