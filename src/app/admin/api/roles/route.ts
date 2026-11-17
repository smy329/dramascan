import 'server-only';

import { resolveActor } from '@/modules/authorization';
import {
  assertSameOrigin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from '@/platform/Http';
import { createRoleForAdmin, listRolesForAdmin } from '@/workflows/admin/roles';

/**
 * Admin role API.
 *
 * `GET` reads the role collection and `POST` creates a role. The route is a
 * thin adapter: it resolves the actor, parses the body, calls one workflow,
 * and maps the result or the typed error to a response. Role and permission
 * management is Super Admin only, and the workflow checks that again.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** GET /admin/api/roles - list every role with its stored permission grants */
export async function GET(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'roles');

  try {
    const actor = await resolveActor();
    const roles = await listRolesForAdmin(actor);

    return jsonResponse({ data: roles, meta: { total: roles.length } }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger, 'roles');
  }
}

/** POST /admin/api/roles - create a role */
export async function POST(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'roles');

  try {
    const actor = await resolveActor();
    assertSameOrigin(request);

    const body = await readJsonBody(request);
    const created = await createRoleForAdmin(actor, body);

    return jsonResponse({ data: created }, 201, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger, 'roles');
  }
}
