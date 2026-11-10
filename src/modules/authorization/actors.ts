/**
 * Actor context and resolution for the authorization module.
 *
 * Actors are server-generated only. A request body, header, cookie value, or
 * client state can never assert a user id, role, or permission — the actor is
 * always resolved from the authenticated session server-side, and account
 * status / Super Admin state are read from the database (the authority), not
 * from client-supplied data or a stale session field.
 */

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { permissions, roles, userRoles } from '@/modules/authorization/schema';
import { auth } from '@/platform/auth/better-auth';
import {
  isPermissionKey,
  SUPER_ADMIN_PERMISSION_KEYS,
  type PermissionKey,
} from './permissions';
import { resolveEffectivePermissions, type RolePermissionAssignment } from './service';

/**
 * Server-side actor context carrying identity, resolved roles, and the
 * effective permission set used for authorization decisions.
 */
export type ActorContext = {
  /** Canonical auth user id; `null` for anonymous actors. */
  userId: string | null;
  /** Role names assigned to the user via `user_roles`. */
  roles: readonly string[];
  /** Super Admin flag; grants the complete catalog. */
  isSuperAdmin: boolean;
  /** Effective permission keys (union of granted permissions across assigned roles; full catalog for Super Admin). */
  permissions: readonly PermissionKey[];
};

/** Anonymous actor: no session, no permissions. Used for public reads. */
export function anonymousActor(): ActorContext {
  return { userId: null, roles: [], isSuperAdmin: false, permissions: [] };
}

type UserActorOptions = {
  /** Role names assigned to the user. */
  roles?: readonly string[];
  /** Super Admin flag; when true, resolves to the complete catalog. */
  isSuperAdmin?: boolean;
  /** Effective permission keys; when omitted and `isSuperAdmin` is true, resolves to the full catalog. */
  permissions?: readonly PermissionKey[];
};

/**
 * Build a user actor. Effective permissions default to the full catalog for
 * Super Admin, otherwise an empty set (resolution from role assignments is the
 * responsibility of the effective-permission service).
 */
export function userActor(userId: string, options: UserActorOptions = {}): ActorContext {
  const isSuperAdmin = options.isSuperAdmin ?? false;
  const permissions = options.permissions ?? (isSuperAdmin ? [...SUPER_ADMIN_PERMISSION_KEYS] : []);
  return {
    userId,
    roles: options.roles ?? [],
    isSuperAdmin,
    permissions,
  };
}

/**
 * Resolve the current actor from the server-side session.
 *
 * Flow: session → database user (`is_super_admin`, `is_active`, `deleted_at`)
 * → assigned roles → effective permission keys (union of granted permissions
 * across assigned roles; full catalog for Super Admin).
 *
 * Returns an anonymous actor when no valid session exists, or when the account
 * is deactivated or soft-deleted. Deactivated accounts lose access even if a
 * valid session cookie is still present.
 */
export async function resolveActor(): Promise<ActorContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  const sessionUserId = session?.user?.id;
  if (!sessionUserId) {
    return anonymousActor();
  }

  const [account] = await db
    .select({
      isSuperAdmin: users.is_super_admin,
      isActive: users.is_active,
      deletedAt: users.deleted_at,
    })
    .from(users)
    .where(eq(users.id, sessionUserId))
    .limit(1);

  if (!account || !account.isActive || account.deletedAt !== null) {
    return anonymousActor();
  }

  const effective = await resolveEffectivePermissionsForUser(sessionUserId);
  const permissionKeys = account.isSuperAdmin
    ? [...SUPER_ADMIN_PERMISSION_KEYS]
    : effective.permissions;

  return userActor(sessionUserId, {
    isSuperAdmin: account.isSuperAdmin,
    permissions: permissionKeys,
    roles: effective.roles,
  });
}

/**
 * Resolve effective permissions for a user: union of granted permissions across
 * all assigned roles. Only permissions present in the canonical catalog are
 * returned; unknown/stale database rows are ignored (deny by default).
 */
export async function resolveEffectivePermissionsForUser(userId: string): Promise<{
  roles: readonly string[];
  permissions: readonly PermissionKey[];
}> {
  const assignedRoles = await db
    .select({
      roleId: roles.id,
      roleName: roles.name,
      permissionResource: permissions.resource,
      permissionAction: permissions.action,
      granted: permissions.granted,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.role_id, roles.id))
    .leftJoin(permissions, eq(permissions.role_id, userRoles.role_id))
    .where(eq(userRoles.user_id, userId));

  const roleNames = new Set<string>();
  const assignmentsByRole = new Map<string, RolePermissionAssignment[]>();

  for (const row of assignedRoles) {
    roleNames.add(row.roleName);

    const assignments = assignmentsByRole.get(row.roleId) ?? [];
    assignmentsByRole.set(row.roleId, assignments);

    if (row.permissionResource === null || row.permissionAction === null) {
      continue;
    }

    const permissionKey = `${row.permissionResource}.${row.permissionAction}`;
    if (isPermissionKey(permissionKey)) {
      assignments.push({ permissionKey, granted: row.granted ?? false });
    }
  }

  const effective = resolveEffectivePermissions({
    roleAssignments: [...assignmentsByRole.entries()].map(([roleId, rolePermissions]) => ({
      roleId,
      permissions: rolePermissions,
    })),
  });

  return {
    roles: [...roleNames],
    permissions: effective.permissions,
  };
}
