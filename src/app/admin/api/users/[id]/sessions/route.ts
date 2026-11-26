import 'server-only';

import { z } from 'zod';

import { resolveActor } from '@/modules/authorization';
import { ValidationError } from '@/platform/errors';
import {
  assertSameOrigin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
} from '@/platform/Http';
import { terminateUserSessionsForAdmin } from '@/workflows/admin/users';

/**
 * Admin session termination API.
 *
 * `POST` ends every session of one account. Signing an administrator out of
 * every device is a security operation, so it is Super Admin only; the
 * workflow enforces that rule, and the route only adapts the request.
 */

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The path parameter reaches a `uuid` column. Validating it here turns a
 * malformed id into the documented `400` instead of a PostgreSQL
 * `invalid input syntax for type uuid` surfaced as `500`.
 */
function parseAccountId(value: string): string {
  const parsed = z.uuid().safeParse(value);

  if (!parsed.success) {
    throw new ValidationError('The request contains invalid fields.', {
      id: ['Invalid user id.'],
    });
  }

  return parsed.data;
}

/** POST /admin/api/users/[id]/sessions - terminate every session of the account */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'users');

  try {
    const actor = await resolveActor();
    assertSameOrigin(request);

    const { id: rawId } = await context.params;
    const id = parseAccountId(rawId);

    await terminateUserSessionsForAdmin(actor, id);

    return jsonResponse({ data: { id } }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger, 'users');
  }
}
