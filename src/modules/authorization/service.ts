/**
 * Effective permission resolution for the authorization module.
 *
 * Effective permissions are the union of the granted permissions across all
 * roles assigned to a user. Super Admin resolves to the complete catalog
 * centrally; no code special-cases a role name.
 */

import { SUPER_ADMIN_PERMISSION_KEYS, type PermissionKey } from './permissions';

export type RolePermissionAssignment = {
  /** Canonical permission key, e.g. `drama.update`. */
  permissionKey: PermissionKey;
  /** Whether the permission is granted to the role. */
  granted: boolean;
};

export type EffectivePermissionsInput = {
  /** Super Admin flag; when true, resolves to the complete catalog. */
  isSuperAdmin?: boolean;
  /** Assigned roles with their permission assignments. */
  roleAssignments?: ReadonlyArray<{
    roleId: string;
    permissions: ReadonlyArray<RolePermissionAssignment>;
  }>;
};

export type EffectivePermissions = {
  /** Effective permission keys (granted only; full catalog for Super Admin). */
  permissions: readonly PermissionKey[];
  /** Whether the actor resolves to the complete catalog (Super Admin). */
  isSuperAdmin: boolean;
};

/**
 * Compute the effective permission set for an actor.
 *
 * - Super Admin → complete catalog (all permissions).
 * - Otherwise → union of granted permissions across all assigned roles.
 */
export function resolveEffectivePermissions(input: EffectivePermissionsInput): EffectivePermissions {
  const isSuperAdmin = input.isSuperAdmin ?? false;

  if (isSuperAdmin) {
    return { permissions: [...SUPER_ADMIN_PERMISSION_KEYS], isSuperAdmin: true };
  }

  const grantedKeys = new Set<PermissionKey>();
  for (const roleAssignment of input.roleAssignments ?? []) {
    for (const assignment of roleAssignment.permissions) {
      if (assignment.granted) {
        grantedKeys.add(assignment.permissionKey);
      }
    }
  }

  return { permissions: [...grantedKeys], isSuperAdmin: false };
}
