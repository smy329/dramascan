import 'server-only';

import { resolveActor } from '@/modules/authorization';
import { ValidationError } from '@/platform/errors';
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

export async function POST(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    assertSameOrigin(request);

    const actor = await resolveActor();
    authorizeDramaAdmin(actor);

    const body = await readJsonBody(request);
    const mode = requestMode(body);
    const result =
      mode === 'apply'
        ? await applyConversion(actor, body)
        : await previewConversion(actor, body);

    return jsonResponse({ data: result }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}
