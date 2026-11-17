import 'server-only';

import { resolveActor } from '@/modules/authorization';
import {
  assertSameOrigin,
  beginAdminRequest,
  emptyResponse,
  errorResponse,
} from '@/platform/Http';
import { revokeUserRoleForAdmin } from '@/workflows/admin/users';

/**
 * Admin user role API for one assignment.
 *
 * `DELETE` removes one role from one user. Revoking a role is Super Admin
 * only, because it removes access.
 */

type RouteContext = {
  params: Promise<{ id: string; roleId: string }>;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** DELETE /admin/api/users/[id]/roles/[roleId] - revoke the role (204, no body) */
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'users');

  try {
    const actor = await resolveActor();
    assertSameOrigin(request);

    const { id, roleId } = await context.params;
    await revokeUserRoleForAdmin(actor, id, roleId);

    return emptyResponse(requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger, 'users');
  }
}
