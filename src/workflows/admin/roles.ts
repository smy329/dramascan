import {
  createRole,
  deleteRole,
  listRoles,
  setRolePermissions,
  updateRole,
  type RoleSummary,
} from '@/modules/authorization';
import { requireSuperAdmin, type ActorContext, type PermissionKey } from '@/modules/authorization';

/**
 * Super Admin role management workflows.
 *
 * Role and permission management can grant or remove privileges, so it stays
 * Super-Admin-only (D-025). The guard is applied here at the entrypoint and
 * again inside the authorization module's service, because a service is
 * reachable from more than one entrypoint.
 *
 * The actor is always the first argument and is resolved server-side by the
 * caller. A client can never assert an actor: the workflows throw typed
 * application errors that the REST layer maps to HTTP statuses.
 *
 * This module must never carry the `'use server'` directive: that would turn
 * every export into an RPC endpoint whose actor arrives in the request body,
 * letting a caller assert Super Admin. Only the page and route handlers call
 * these functions, and they resolve the actor themselves (D-031).
 */

/** List every role with its stored permission grants. */
export async function listRolesForAdmin(actor: ActorContext): Promise<RoleSummary[]> {
  requireSuperAdmin(actor);

  return listRoles(actor);
}

/** Create a role with no permissions. */
export async function createRoleForAdmin(
  actor: ActorContext,
  input: unknown
): Promise<RoleSummary> {
  requireSuperAdmin(actor);

  return createRole(actor, input);
}

/** Rename a role or change its description. */
export async function updateRoleForAdmin(
  actor: ActorContext,
  roleId: string,
  input: unknown
): Promise<RoleSummary> {
  requireSuperAdmin(actor);

  return updateRole(actor, roleId, input);
}

/** Delete a role that is not assigned to any user. */
export async function deleteRoleForAdmin(actor: ActorContext, roleId: string): Promise<void> {
  requireSuperAdmin(actor);

  await deleteRole(actor, roleId);
}

/** Replace the granted permission set of a role. */
export async function setRolePermissionsForAdmin(
  actor: ActorContext,
  roleId: string,
  permissionKeys: readonly PermissionKey[]
): Promise<RoleSummary> {
  requireSuperAdmin(actor);

  return setRolePermissions(actor, roleId, permissionKeys);
}
