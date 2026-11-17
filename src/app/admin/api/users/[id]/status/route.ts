import 'server-only';

import { z } from 'zod';

import { resolveActor } from '@/modules/authorization';
import { ValidationError } from '@/platform/errors';
import {
  assertSameOrigin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from '@/platform/Http';
import { setUserAccountActiveForAdmin } from '@/workflows/admin/users';

/**
 * Admin account status API.
 *
 * `POST` activates or deactivates one account. The last active Super Admin
 * cannot be deactivated: the invariant is enforced inside the auth module, so
 * it holds no matter which caller asks.
 */

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const statusBodySchema = z.strictObject({
  isActive: z.boolean(),
});

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

function parseStatusBody(body: unknown): { isActive: boolean } {
  const parsed = statusBodySchema.safeParse(body);

  if (!parsed.success) {
    throw new ValidationError('The request contains invalid fields.');
  }

  return parsed.data;
}

/** POST /admin/api/users/[id]/status - activate or deactivate the account */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'users');

  try {
    const actor = await resolveActor();
    assertSameOrigin(request);

    const { id: rawId } = await context.params;
    const id = parseAccountId(rawId);
    const body = parseStatusBody(await readJsonBody(request));
    const account = await setUserAccountActiveForAdmin(actor, id, body.isActive);

    return jsonResponse(
      {
        data: {
          id: account.id,
          name: account.name,
          email: account.email,
          isActive: account.isActive,
          isSuperAdmin: account.isSuperAdmin,
          createdAt: account.createdAt.toISOString(),
          updatedAt: account.updatedAt.toISOString(),
          deletedAt: account.deletedAt?.toISOString() ?? null,
        },
      },
      200,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger, 'users');
  }
}
