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
import { assignUserRoleForAdmin, listUserRolesForAdmin } from '@/workflows/admin/users';

/**
 * Admin user role API.
 *
 * `GET` reads the roles assigned to one user and `POST` assigns a role.
 * Assigning a role grants access, so it is Super Admin only; reading the
 * assignments is ordinary user management and keeps the canonical
 * `admin.manage` requirement (D-025).
 */

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const assignBodySchema = z.strictObject({
  roleId: z.uuid(),
});

function parseAssignBody(body: unknown): { roleId: string } {
  const parsed = assignBodySchema.safeParse(body);

  if (!parsed.success) {
    throw new ValidationError('The request contains invalid fields.');
  }

  return parsed.data;
}

/** GET /admin/api/users/[id]/roles - list the roles assigned to the user */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'users');

  try {
    const actor = await resolveActor();
    const { id } = await context.params;
    const assignments = await listUserRolesForAdmin(actor, id);

    return jsonResponse(
      { data: assignments, meta: { total: assignments.length } },
      200,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger, 'users');
  }
}

/** POST /admin/api/users/[id]/roles - assign a role to the user */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'users');

  try {
    const actor = await resolveActor();
    assertSameOrigin(request);

    const { id } = await context.params;
    const body = parseAssignBody(await readJsonBody(request));
    const assignments = await assignUserRoleForAdmin(actor, id, body.roleId);

    return jsonResponse({ data: assignments }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger, 'users');
  }
}
