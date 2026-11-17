import {
  assignUserRole,
  listUserRoleAssignments,
  revokeUserRole,
  type UserRoleAssignment,
} from '@/modules/authorization';
import {
  requireAdmin,
  requirePermission,
  requireSuperAdmin,
  toPermissionKey,
  type ActorContext,
} from '@/modules/authorization';
import { getUserAccount, setUserAccountActive, type UserAccountRecord } from '@/modules/auth';
import { NotFoundError } from '@/platform/errors';

/**
 * Administrator user account management workflows.
 *
 * These workflows coordinate two modules: `auth` owns the account status and
 * `authorization` owns the role assignments. The workflow owns the sequencing
 * and the authorization entry check; each module keeps its own rules.
 *
 * Authorization split:
 * - Inspecting a user's roles is ordinary user management and keeps the
 *   canonical `admin.manage` requirement (D-025).
 * - Assigning or revoking a role grants or removes access, so it is Super
 *   Admin only, like administrator authorization (D-025).
 * - Changing an account's status keeps the canonical `admin.manage`
 *   requirement, but a Super Admin account can only be changed by a Super
 *   Admin: an `admin.manage` holder must not be able to lock the root account
 *   out.
 *
 * The last-active-Super-Admin invariant is enforced inside the `auth` module,
 * not here, so it holds for every caller.
 *
 * This module must never carry the `'use server'` directive: that would turn
 * every export into an RPC endpoint whose actor arrives in the request body,
 * letting a caller assert Super Admin. Only the page and route handlers call
 * these functions, and they resolve the actor themselves (D-031).
 */

/** List the roles assigned to one user. */
export async function listUserRolesForAdmin(
  actor: ActorContext,
  userId: string
): Promise<UserRoleAssignment[]> {
  requireAdmin(actor);

  return listUserRoleAssignments(actor, userId);
}

/** Assign a role to a user. */
export async function assignUserRoleForAdmin(
  actor: ActorContext,
  userId: string,
  roleId: string
): Promise<UserRoleAssignment[]> {
  requireSuperAdmin(actor);

  return assignUserRole(actor, userId, roleId);
}

/** Remove one role from a user. */
export async function revokeUserRoleForAdmin(
  actor: ActorContext,
  userId: string,
  roleId: string
): Promise<UserRoleAssignment[]> {
  requireSuperAdmin(actor);

  return revokeUserRole(actor, userId, roleId);
}

/**
 * Activate or deactivate a user account.
 *
 * A Super Admin account is only ever changed by a Super Admin. The check reads
 * the account first, so the decision is made against the stored state and not
 * against anything the request supplied.
 */
export async function setUserAccountActiveForAdmin(
  actor: ActorContext,
  userId: string,
  isActive: boolean
): Promise<UserAccountRecord> {
  requirePermission(actor, toPermissionKey('admin', 'manage'));

  const account = await getUserAccount(userId);

  if (!account) {
    throw new NotFoundError('User account not found.');
  }

  if (account.isSuperAdmin) {
    requireSuperAdmin(actor);
  }

  return setUserAccountActive(userId, isActive);
}
