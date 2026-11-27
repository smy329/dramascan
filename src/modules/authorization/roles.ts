import 'server-only';

import { and, asc, count, eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { getUserAccount } from '@/modules/auth';
import { isUniqueViolation } from '@/platform/db/errors';
import { ConflictError, NotFoundError } from '@/platform/errors';

import type { ActorContext } from './actors';
import { requireAdmin, requirePermission, requireSuperAdmin } from './guards';
import { isPermissionKey, toPermissionKey, type PermissionKey } from './permissions';
import { permissions, roles, userRoles } from './schema';
import {
  assignUserRoleSchema,
  createRoleSchema,
  parseOrThrow,
  roleIdSchema,
  setRolePermissionsSchema,
  updateRoleSchema,
  userIdSchema,
} from './validation';

/**
 * Role, permission, and user-role persistence (owned by `authorization`).
 *
 * This module owns the `roles`, `permissions`, and `user_roles` tables, so every
 * write to them happens here and is exposed through the module's public API.
 * Callers never receive a Drizzle row: they receive the small projections the
 * administration area renders.
 *
 * Revocation is explicit. A permission that is removed from a role keeps its
 * row with `granted = false`, so the stored history shows what was withdrawn
 * instead of silently forgetting it.
 *
 * Authorization is re-checked here, not only at the entrypoint, because a
 * module service is reachable from more than one entrypoint:
 *
 * - Role and permission management is Super Admin only. Granting a permission
 *   can hand an administrator more power than the grantor holds, so it is not
 *   delegated to `admin.manage`.
 * - Reading one user's role assignments is ordinary user management and keeps
 *   the canonical `admin.manage` requirement (D-025).
 * - Reading the assignments for the admin user listing is part of that
 *   listing, so it keeps the canonical `user.read` requirement.
 */

export type RolePermission = {
  permissionKey: PermissionKey;
  granted: boolean;
};

export type RoleSummary = {
  id: string;
  name: string;
  description: string | null;
  permissions: RolePermission[];
  grantedPermissionKeys: PermissionKey[];
  userCount: number;
  createdAt: string;
};

export type UserRoleAssignment = {
  roleId: string;
  roleName: string;
  assignedAt: string;
};

/** The result of assigning a role, including whether the write changed state. */
export type AssignUserRoleResult = {
  assignments: UserRoleAssignment[];
  changed: boolean;
};

/** The result of revoking a role, including whether the write changed state. */
export type RevokeUserRoleResult = {
  assignments: UserRoleAssignment[];
  changed: boolean;
};

/** Role assignments for several users at once, keyed by user id. */
export type UserRoleAssignmentMap = Record<string, UserRoleAssignment[]>;

/** Compose a catalog key from a stored permission row, or `null` when it is unknown. */
function toCatalogPermissionKey(resource: string, action: string): PermissionKey | null {
  const key = `${resource}.${action}`;
  return isPermissionKey(key) ? key : null;
}

/** Read the stored assignments of one user. The caller has already authorized. */
async function readUserRoleAssignments(userId: string): Promise<UserRoleAssignment[]> {
  const rows = await db
    .select({
      roleId: roles.id,
      roleName: roles.name,
      assignedAt: userRoles.assigned_at,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.role_id, roles.id))
    .where(eq(userRoles.user_id, userId))
    .orderBy(asc(roles.name), asc(roles.id));

  return rows.map(row => ({
    roleId: row.roleId,
    roleName: row.roleName,
    assignedAt: row.assignedAt.toISOString(),
  }));
}

/**
 * Read every role with its stored permission rows and the number of assigned
 * users.
 *
 * The permission rows are read for all roles in one query. Reading them per
 * role would multiply the query count by the number of roles, and reading only
 * the first role's rows would silently hide every other role's grants.
 */
export async function listRoles(actor: ActorContext): Promise<RoleSummary[]> {
  requireSuperAdmin(actor);

  const roleRows = await db.select().from(roles).orderBy(asc(roles.name), asc(roles.id));
  const roleIds = roleRows.map(role => role.id);

  if (roleIds.length === 0) {
    return [];
  }

  const permissionRows = await db
    .select()
    .from(permissions)
    .where(inArray(permissions.role_id, roleIds))
    .orderBy(asc(permissions.resource), asc(permissions.action));

  const userCountRows = await db
    .select({ roleId: userRoles.role_id, total: count() })
    .from(userRoles)
    .groupBy(userRoles.role_id);

  const userCounts = new Map(userCountRows.map(row => [row.roleId, Number(row.total)]));
  const permissionsByRole = new Map<string, RolePermission[]>();

  for (const row of permissionRows) {
    const key = toCatalogPermissionKey(row.resource, row.action);
    if (key === null) continue;

    const list = permissionsByRole.get(row.role_id) ?? [];
    list.push({ permissionKey: key, granted: row.granted });
    permissionsByRole.set(row.role_id, list);
  }

  return roleRows.map(role => {
    const rolePermissions = permissionsByRole.get(role.id) ?? [];

    return {
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: rolePermissions,
      grantedPermissionKeys: rolePermissions
        .filter(permission => permission.granted)
        .map(permission => permission.permissionKey),
      userCount: userCounts.get(role.id) ?? 0,
      createdAt: role.created_at.toISOString(),
    };
  });
}

/** Read one role, or fail with a not-found error. */
export async function getRole(actor: ActorContext, roleId: string): Promise<RoleSummary> {
  requireSuperAdmin(actor);

  const id = parseOrThrow(roleIdSchema, roleId);
  const summary = (await listRoles(actor)).find(role => role.id === id);

  if (!summary) {
    throw new NotFoundError('Role not found.');
  }

  return summary;
}

/** Create a role with no permissions. Permissions are assigned explicitly. */
export async function createRole(actor: ActorContext, input: unknown): Promise<RoleSummary> {
  requireSuperAdmin(actor);

  const parsed = parseOrThrow(createRoleSchema, input);

  const [existing] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, parsed.name))
    .limit(1);

  if (existing) {
    throw new ConflictError('A role with this name already exists.');
  }

  try {
    await db.insert(roles).values({
      name: parsed.name,
      description: parsed.description ?? null,
    });
  } catch (error) {
    // Two administrators can create the same name at the same time; the unique
    // index is the authority, so the conflict is reported as a conflict.
    if (isUniqueViolation(error)) {
      throw new ConflictError('A role with this name already exists.');
    }

    throw error;
  }

  const [created] = await db.select().from(roles).where(eq(roles.name, parsed.name)).limit(1);

  if (!created) {
    throw new NotFoundError('Role not found.');
  }

  return {
    id: created.id,
    name: created.name,
    description: created.description,
    permissions: [],
    grantedPermissionKeys: [],
    userCount: 0,
    createdAt: created.created_at.toISOString(),
  };
}

/** Rename a role or change its description. */
export async function updateRole(
  actor: ActorContext,
  roleId: string,
  input: unknown
): Promise<RoleSummary> {
  requireSuperAdmin(actor);

  const id = parseOrThrow(roleIdSchema, roleId);
  const parsed = parseOrThrow(updateRoleSchema, input);

  const [existing] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);

  if (!existing) {
    throw new NotFoundError('Role not found.');
  }

  const updates: Partial<typeof roles.$inferInsert> = {};

  if (parsed.name !== undefined) {
    const [conflict] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, parsed.name))
      .limit(1);

    if (conflict && conflict.id !== id) {
      throw new ConflictError('A role with this name already exists.');
    }

    updates.name = parsed.name;
  }

  if (parsed.description !== undefined) {
    updates.description = parsed.description;
  }

  try {
    await db.update(roles).set(updates).where(eq(roles.id, id));
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('A role with this name already exists.');
    }

    throw error;
  }

  return getRole(actor, id);
}

/**
 * Delete a role that is not assigned to any user.
 *
 * A role with user assignments is refused: the assignment is real access, and
 * removing the role underneath it would silently change what those users can
 * do. The role's permission rows are removed with it.
 */
export async function deleteRole(actor: ActorContext, roleId: string): Promise<void> {
  requireSuperAdmin(actor);

  const id = parseOrThrow(roleIdSchema, roleId);

  await db.transaction(async tx => {
    const [existing] = await tx.select().from(roles).where(eq(roles.id, id)).limit(1);

    if (!existing) {
      throw new NotFoundError('Role not found.');
    }

    const [assigned] = await tx
      .select({ total: count() })
      .from(userRoles)
      .where(eq(userRoles.role_id, id));

    const assignedCount = Number(assigned?.total ?? 0);

    if (assignedCount > 0) {
      throw new ConflictError(
        'This role is still assigned to users. Remove the assignments before deleting it.'
      );
    }

    await tx.delete(permissions).where(eq(permissions.role_id, id));
    await tx.delete(roles).where(eq(roles.id, id));
  });
}

/**
 * Replace the granted permission set of a role.
 *
 * The whole replacement runs in one transaction: a permission that stays is
 * marked granted, a permission that leaves is marked revoked, and a permission
 * that is new is inserted. The role never has a half-applied permission set.
 */
export async function setRolePermissions(
  actor: ActorContext,
  roleId: string,
  permissionKeys: readonly PermissionKey[]
): Promise<RoleSummary> {
  requireSuperAdmin(actor);

  const id = parseOrThrow(roleIdSchema, roleId);
  const parsed = parseOrThrow(setRolePermissionsSchema, { permissionKeys });

  await db.transaction(async tx => {
    // Serialize full replacements of the same role. Without this row lock two
    // concurrent replacements each read the old permission set and the last
    // writer per row wins, so the stored set becomes a union of both requests
    // instead of exactly one of them.
    const [existing] = await tx.select().from(roles).where(eq(roles.id, id)).for('update').limit(1);

    if (!existing) {
      throw new NotFoundError('Role not found.');
    }

    const desired = new Map<string, { resource: string; action: string }>();

    for (const key of parsed.permissionKeys) {
      const [resource, action] = key.split('.');
      if (resource === undefined || action === undefined) continue;
      desired.set(key, { resource, action });
    }

    const stored = await tx.select().from(permissions).where(eq(permissions.role_id, id));

    for (const row of stored) {
      const key = `${row.resource}.${row.action}`;
      const shouldGrant = desired.has(key);

      if (row.granted !== shouldGrant) {
        await tx
          .update(permissions)
          .set({ granted: shouldGrant })
          .where(eq(permissions.id, row.id));
      }
    }

    for (const value of desired.values()) {
      const exists = stored.some(
        row => row.resource === value.resource && row.action === value.action
      );

      if (exists) continue;

      await tx.insert(permissions).values({
        resource: value.resource,
        action: value.action,
        role_id: id,
        granted: true,
      });
    }
  });

  return getRole(actor, id);
}

/** Read the roles assigned to one user. */
export async function listUserRoleAssignments(
  actor: ActorContext,
  userId: string
): Promise<UserRoleAssignment[]> {
  requireAdmin(actor);

  const id = parseOrThrow(userIdSchema, userId);

  return readUserRoleAssignments(id);
}

/**
 * Read the role assignments of several users at once.
 *
 * The admin user listing needs the assignments of every row on the page, and
 * reading them one user at a time would issue one query per row.
 */
export async function listRoleAssignmentsForUsers(
  actor: ActorContext,
  userIds: readonly string[]
): Promise<UserRoleAssignmentMap> {
  requirePermission(actor, toPermissionKey('user', 'read'));

  if (userIds.length === 0) {
    return {};
  }

  const rows = await db
    .select({
      userId: userRoles.user_id,
      roleId: roles.id,
      roleName: roles.name,
      assignedAt: userRoles.assigned_at,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.role_id, roles.id))
    .where(inArray(userRoles.user_id, [...userIds]))
    .orderBy(asc(roles.name), asc(roles.id));

  const assignments: UserRoleAssignmentMap = {};

  for (const row of rows) {
    const list = assignments[row.userId] ?? [];
    list.push({
      roleId: row.roleId,
      roleName: row.roleName,
      assignedAt: row.assignedAt.toISOString(),
    });
    assignments[row.userId] = list;
  }

  return assignments;
}

/** Assign a role to a user. A user may hold several roles at the same time. */
export async function assignUserRole(
  actor: ActorContext,
  userId: string,
  roleId: string
): Promise<AssignUserRoleResult> {
  requireSuperAdmin(actor);

  const parsed = parseOrThrow(assignUserRoleSchema, { roleId });
  const id = parseOrThrow(userIdSchema, userId);

  const [role] = await db.select().from(roles).where(eq(roles.id, parsed.roleId)).limit(1);

  if (!role) {
    throw new NotFoundError('Role not found.');
  }

  const account = await getUserAccount(id);

  if (!account) {
    throw new NotFoundError('User account not found.');
  }

  const inserted = await db
    .insert(userRoles)
    .values({ user_id: id, role_id: parsed.roleId })
    .onConflictDoNothing()
    .returning({ id: userRoles.user_id });

  const assignments = await readUserRoleAssignments(id);

  return { assignments, changed: inserted.length > 0 };
}

/** Remove one role from a user. */
export async function revokeUserRole(
  actor: ActorContext,
  userId: string,
  roleId: string
): Promise<RevokeUserRoleResult> {
  requireSuperAdmin(actor);

  const id = parseOrThrow(userIdSchema, userId);
  const parsed = parseOrThrow(assignUserRoleSchema, { roleId });

  const deleted = await db
    .delete(userRoles)
    .where(and(eq(userRoles.user_id, id), eq(userRoles.role_id, parsed.roleId)))
    .returning({ roleId: userRoles.role_id });

  if (deleted.length === 0) {
    throw new NotFoundError('Role assignment not found.');
  }

  const assignments = await readUserRoleAssignments(id);

  return { assignments, changed: deleted.length > 0 };
}
