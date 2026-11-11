/**
 * Authorization module public API (server-only).
 *
 * The single public surface for the authorization domain. Everything else in
 * this module is private to it.
 */

export { PERMISSIONS, ALL_PERMISSION_KEYS, SUPER_ADMIN_PERMISSION_KEYS, isPermissionKey, toPermissionKey, PERMISSION_RESOURCES, PERMISSION_ACTIONS } from './permissions';
export type { PermissionKey, PermissionResource, PermissionAction, PermissionDefinition } from './permissions';
export { anonymousActor, userActor, resolveActor, resolveEffectivePermissionsForUser } from './actors';
export type { ActorContext } from './actors';
export { resolveEffectivePermissions } from './service';
export type { EffectivePermissions, EffectivePermissionsInput, RolePermissionAssignment } from './service';
export { hasPermission, requirePermission, requireAnyPermission, requireUser, requireAdmin, assertResourceAccess } from './guards';
export { refreshSessionActivity, listUserSessions, invalidateUserSessions, forceReauthenticateUser, enrichSession } from './session-management';
export { recordLoginAttempt, countFailedAttempts, isUserLockedOut, resetFailedAttempts, getUserLoginAttempts, getAllLoginAttempts, getLoginStatistics, checkGoogleSecurityChange } from './login-monitoring';
export type { SessionInfo } from './session-management';
