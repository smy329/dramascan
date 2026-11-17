import 'server-only';

import { resolveActor } from '@/modules/authorization';
import {
  assertSameOrigin,
  beginAdminRequest,
  emptyResponse,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from '@/platform/Http';
import { deleteRoleForAdmin, updateRoleForAdmin } from '@/workflows/admin/roles';

/**
 * Admin role API for one role.
 *
 * `PATCH` updates the role and `DELETE` removes it. A role that is still
 * assigned to a user is refused with a conflict, so an administrator cannot
 * silently change what those users can do.
 */

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** PATCH /admin/api/roles/[id] - rename the role or change its description */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'roles');

  try {
    const actor = await resolveActor();
    assertSameOrigin(request);

    const { id } = await context.params;
    const body = await readJsonBody(request);
    const updated = await updateRoleForAdmin(actor, id, body);

    return jsonResponse({ data: updated }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger, 'roles');
  }
}

/** DELETE /admin/api/roles/[id] - remove the role (204, no body) */
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'roles');

  try {
    const actor = await resolveActor();
    assertSameOrigin(request);

    const { id } = await context.params;
    await deleteRoleForAdmin(actor, id);

    return emptyResponse(requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger, 'roles');
  }
}
