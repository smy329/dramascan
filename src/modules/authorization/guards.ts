/**
 * Reusable server-side authorization guards (owned by the `authorization`
 * module).
 *
 * Guards are the enforcement point for "what may this actor do?". They are
 * called from entrypoints (Server Actions, REST route handlers, protected pages)
 * and from services (service-level re-checks).
 *
 * Enforcement model (see architecture docs §9):
 * - Entrypoint guard: the Server Action / route handler / protected page resolves
 *   the actor and performs a coarse check (`requireUser`, `requireAdmin`,
 *   `requirePermission`).
 * - Service guard: the called service re-checks the specific permission and
 *   resource-level rules using the passed actor.
 *
 * Navigation is never treated as authorization; guards run independently of UI.
 */

import { AuthenticationError, AuthorizationError } from '@/platform/errors';
import { toPermissionKey, type PermissionKey } from './permissions';
import type { ActorContext } from './actors';

/** Does the actor hold the given permission? Anonymous actors never do. */
export function hasPermission(actor: ActorContext, permissionKey: PermissionKey): boolean {
  if (actor.userId === null) {
    return false;
  }
  if (actor.isSuperAdmin) {
    return true;
  }
  return actor.permissions.includes(permissionKey);
}

/**
 * Require that the actor is authenticated and holds the permission.
 * Throws `AuthenticationError` (401) when anonymous, `AuthorizationError` (403)
 * when the permission is missing.
 */
export function requirePermission(actor: ActorContext, permissionKey: PermissionKey): ActorContext {
  if (actor.userId === null) {
    throw new AuthenticationError('Authentication required.');
  }
  if (!hasPermission(actor, permissionKey)) {
    throw new AuthorizationError(`Missing permission: ${permissionKey}`);
  }
  return actor;
}

/**
 * Require that the actor holds at least one of the given permissions.
 * Throws `AuthorizationError` when none match.
 */
export function requireAnyPermission(
  actor: ActorContext,
  permissionKeys: readonly PermissionKey[]
): ActorContext {
  if (actor.userId === null) {
    throw new AuthenticationError('Authentication required.');
  }
  const allowed = permissionKeys.some((key) => hasPermission(actor, key));
  if (!allowed) {
    throw new AuthorizationError(`Missing permission: ${permissionKeys.join(', ')}`);
  }
  return actor;
}

/**
 * Require that the actor is authenticated. Throws `AuthenticationError` when
 * anonymous.
 */
export function requireUser(actor: ActorContext): ActorContext {
  if (actor.userId === null) {
    throw new AuthenticationError('Authentication required.');
  }
  return actor;
}

/**
 * Require that the actor is an administrator (Super Admin or holder of the
 * `admin.manage` permission). Throws `AuthenticationError` when anonymous,
 * `AuthorizationError` when not permitted.
 */
export function requireAdmin(actor: ActorContext): ActorContext {
  if (actor.userId === null) {
    throw new AuthenticationError('Authentication required.');
  }
  const isAdmin =
    actor.isSuperAdmin || actor.permissions.includes(toPermissionKey('admin', 'manage'));
  if (!isAdmin) {
    throw new AuthorizationError('Admin permission required.');
  }
  return actor;
}

/**
 * Require that the actor is the Super Admin. Throws `AuthenticationError` when
 * anonymous, `AuthorizationError` when authenticated but not Super Admin.
 *
 * This is not a permission check: `isSuperAdmin` is the authoritative
 * definition, so holding `admin.manage` (or any other permission) is never a
 * substitute.
 */
export function requireSuperAdmin(actor: ActorContext): ActorContext {
  if (actor.userId === null) {
    throw new AuthenticationError('Authentication required.');
  }
  if (!actor.isSuperAdmin) {
    throw new AuthorizationError('Super Admin permission required.');
  }
  return actor;
}

/**
 * Resource-level access check: the actor holds the permission and (optionally)
 * satisfies the resource scope (e.g. ownership).
 *
 * `resourceScope.ownerUserId` restricts management to the owner when provided;
 * otherwise the permission alone is evaluated.
 */
export function assertResourceAccess(
  actor: ActorContext,
  permissionKey: PermissionKey,
  resourceScope?: { ownerUserId?: string | null }
): boolean {
  if (!hasPermission(actor, permissionKey)) {
    return false;
  }
  if (resourceScope?.ownerUserId && actor.userId !== resourceScope.ownerUserId) {
    return false;
  }
  return true;
}
