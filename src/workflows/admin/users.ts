import {
  assignUserRole,
  invalidateUserSessions,
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
import { notifyAccountSecurity } from '@/modules/notifications';
import { NotFoundError } from '@/platform/errors';
import { createRequestLogger } from '@/platform/logging';

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

/** The deep link a security notification points the viewer at. */
const ACCOUNT_LINK = '/profile';

/**
 * Record a mandatory account/security notification.
 *
 * The notification is written after the state change has already committed, so
 * a failed write must not fail the administrator's action: the account really
 * was changed, and reporting the action as failed would be a lie. The failure
 * is logged instead, and the platform does not claim a delivery it did not
 * make.
 */
async function notifySecurityEvent(input: {
  userId: string;
  title: string;
  content: string;
}): Promise<void> {
  try {
    await notifyAccountSecurity({
      userId: input.userId,
      title: input.title,
      content: input.content,
      link: ACCOUNT_LINK,
    });
  } catch (error) {
    const { logger } = createRequestLogger({ module: 'notifications' });
    logger.warn(
      { err: error, event: 'account_security_notification_failed' },
      'The account change was committed but its security notification was not written'
    );
  }
}

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

  // Assigning a role is idempotent: the assignment either exists or it does
  // not. The write reports whether it inserted the assignment, and the
  // notification follows that report rather than the request (D-064, D-080).
  const { assignments, changed } = await assignUserRole(actor, userId, roleId);
  const roleName = assignments.find(row => row.roleId === roleId)?.roleName ?? null;

  if (changed) {
    await notifySecurityEvent({
      userId,
      title: 'Your account role was added',
      content: roleName
        ? `The role "${roleName}" was added to your account.`
        : 'A role was added to your account.',
    });
  }

  return assignments;
}

/** Remove one role from a user. */
export async function revokeUserRoleForAdmin(
  actor: ActorContext,
  userId: string,
  roleId: string
): Promise<UserRoleAssignment[]> {
  requireSuperAdmin(actor);

  // The role name is read before the removal, because the assignment is gone
  // by the time the module answers.
  const roleName =
    (await listUserRoleAssignments(actor, userId)).find(row => row.roleId === roleId)
      ?.roleName ?? null;

  const { assignments, changed } = await revokeUserRole(actor, userId, roleId);

  if (changed) {
    await notifySecurityEvent({
      userId,
      title: 'Your account role was removed',
      content: roleName
        ? `The role "${roleName}" was removed from your account.`
        : 'A role was removed from your account.',
    });
  }

  return assignments;
}

/**
 * Terminate every session of one account.
 *
 * A Super Admin may end an administrator's sessions at any time. The
 * termination is a security event the account owner has to hear about, so it
 * is announced like every other mandatory security notification.
 */
export async function terminateUserSessionsForAdmin(
  actor: ActorContext,
  userId: string
): Promise<void> {
  requireSuperAdmin(actor);

  await invalidateUserSessions(userId, actor.userId ?? '');

  await notifySecurityEvent({
    userId,
    title: 'Your sessions were terminated',
    content: 'An administrator signed you out of every device. Sign in again to continue.',
  });
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

  const { account: updated, changed } = await setUserAccountActive(userId, isActive);

  // The status write reports whether it changed the stored status. The
  // notification follows that report, so a repeated request does not tell the
  // account owner about a state it was already in (D-064, D-080).
  if (changed) {
    await notifySecurityEvent({
      userId,
      title: isActive ? 'Your account was reactivated' : 'Your account was deactivated',
      content: isActive
        ? 'An administrator reactivated your account. You can sign in again.'
        : 'An administrator deactivated your account. Your bookmarks and watch history were kept.',
    });
  }

  return updated;
}
