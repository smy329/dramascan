import 'server-only';

import { parsePermissionKeysBody, resolveActor } from '@/modules/authorization';
import {
  assertSameOrigin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from '@/platform/Http';
import { setRolePermissionsForAdmin } from '@/workflows/admin/roles';

/**
 * Admin role permission API.
 *
 * `PUT` replaces the whole granted permission set of a role in one request.
 * The replacement is atomic, so a role never has a half-applied permission
 * set: a permission that leaves the set is recorded as revoked instead of
 * being forgotten.
 */

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** PUT /admin/api/roles/[id]/permissions - replace the granted permission set */
export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'roles');

  try {
    const actor = await resolveActor();
    assertSameOrigin(request);

    const { id } = await context.params;
    const permissionKeys = parsePermissionKeysBody(await readJsonBody(request));
    const updated = await setRolePermissionsForAdmin(actor, id, permissionKeys);

    return jsonResponse({ data: updated }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger, 'roles');
  }
}
