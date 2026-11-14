import 'server-only';

import { resolveActor } from '@/modules/authorization';
import { InternalError, ValidationError } from '@/platform/errors';
import { applyConversion, previewConversion } from '@/workflows/admin/conversion';

import {
  assertSameOrigin,
  authorizeDramaAdmin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from '../_shared';

/**
 * Admin drama structure conversion API.
 *
 * `POST` with `mode: "preview"` returns the planned structure and fingerprint.
 * `POST` with `mode: "apply"` requires that fingerprint and applies the
 * conversion transactionally. Authorization is enforced server-side here and
 * again inside the workflow.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function requestMode(body: unknown): 'preview' | 'apply' {
  if (typeof body === 'object' && body !== null && 'mode' in body) {
    const mode = (body as { mode?: unknown }).mode;
    if (mode === 'preview' || mode === 'apply') {
      return mode;
    }
  }

  throw new ValidationError('The mode field must be "preview" or "apply".', {
    mode: ['The mode field must be "preview" or "apply".'],
  });
}

/** The drama id of a request body, for error context only. */
function requestDramaId(body: unknown): string | undefined {
  if (typeof body === 'object' && body !== null && 'dramaId' in body) {
    const dramaId = (body as { dramaId?: unknown }).dramaId;
    return typeof dramaId === 'string' ? dramaId : undefined;
  }

  return undefined;
}

export async function POST(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);
  let body: unknown;

  try {
    assertSameOrigin(request);

    const actor = await resolveActor();
    authorizeDramaAdmin(actor);

    body = await readJsonBody(request);
    const mode = requestMode(body);
    const result =
      mode === 'apply'
        ? await applyConversion(actor, body)
        : await previewConversion(actor, body);

    return jsonResponse({ data: result }, 200, requestId);
  } catch (error) {
    // A corrupted stored snapshot is a server failure, not a client mistake:
    // log it with the drama context before the generic 500 is returned.
    if (error instanceof InternalError) {
      logger.error(
        { err: error, event: 'dramas.conversion_internal_error', dramaId: requestDramaId(body) },
        'Admin conversion request failed'
      );
    }

    return errorResponse(error, requestId, logger);
  }
}
