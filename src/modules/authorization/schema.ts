/**
 * Authorization schema fragment (owned by `authorization`).
 *
 * RBAC tables and the canonical permission catalog for the authorization
 * domain. The canonical permission identifier is the `resource.action` key
 * (e.g. `drama.update`) owned by `modules/authorization/permissions.ts`.
 *
 * Tables:
 * - `roles` — role definitions (super_admin, content_manager, moderator,
 *   analyst, viewer, plus custom roles created via the Super Admin console).
 * - `permissions` — (resource, action) → granted mappings scoped to a role.
 *   The stored pair composes to one canonical `resource.action` key. The
 *   resource/action CHECK constraints are derived from the canonical catalog,
 *   so invalid pairs cannot be stored even by out-of-band SQL.
 * - `user_roles` — many-to-many user ↔ role assignments. A user may hold
 *   multiple roles; effective permissions are the union of all assigned roles.
 *
 * Reconciliation rules:
 * - The database stores the same canonical pair split across `resource` and
 *   `action`; no second catalog is introduced. The code catalog in
 *   `permissions.ts` remains the single source of truth.
 * - `permissions` has one row per (role, resource, action); the unique
 *   constraint makes duplicate grants impossible. `granted = false` is the
 *   explicit revocation state (rows are not deleted).
 * - Foreign keys protect role assignments: a role with permission or user
 *   assignments cannot be deleted (NO ACTION).
 * - `user_roles.user_id` is a cross-module reference to the `auth` user table;
 *   per the project convention it is enforced by the SQL migration, not by a
 *   Drizzle-level reference.
 *
 * Only the `authorization` module may write these tables.
 * `src/db/schema.ts` assembles this namespace; no other module imports this
 * file directly.
 */

import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import {
  checkConstraint,
  foreignKeyConstraint,
  indexOn,
  primaryKeyConstraint,
  uniqueConstraint,
  uuidPrimaryKey,
} from '@/platform/db/schema-helpers';
import { ALL_PERMISSION_KEYS } from './permissions';

// ---- Role name values (string literals for the roles table) ------------

export const RoleName = {
  SUPER_ADMIN: 'super_admin' as const,
  CONTENT_MANAGER: 'content_manager' as const,
  MODERATOR: 'moderator' as const,
  ANALYST: 'analyst' as const,
  VIEWER: 'viewer' as const,
} as const;

export type RoleName = (typeof RoleName)[keyof typeof RoleName];

// ---- Roles table -------------------------------------------------------

export const roles = pgTable(
  'roles',
  {
    id: uuidPrimaryKey(),
    name: text('name').notNull(), // e.g. super_admin, content_manager, or a custom role name
    description: text('description'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueConstraint('roles', table.name)]
);

// ---- Permissions table -------------------------------------------------

// Fine-grained permissions assigned to roles at the action/resource level.
// `resource` + `action` compose to one canonical `resource.action` key.
// The CHECK constraint is generated from the canonical catalog keys, so the
// database cannot store an invalid pair or a non-catalog combination — even
// through out-of-band SQL. The catalog remains the single source of truth.
const allowedPermissionKeys = sql.raw(
  ALL_PERMISSION_KEYS.map((value) => `'${value}'`).join(', ')
);

export const permissions = pgTable(
  'permissions',
  {
    id: uuidPrimaryKey(),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    role_id: uuid('role_id').notNull(),
    granted: boolean('granted').notNull().default(true),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One entry per (role, canonical permission). `granted` toggles it.
    uniqueConstraint('permissions', table.role_id, table.resource, table.action),
    foreignKeyConstraint('permissions', table.role_id, roles.id),
    checkConstraint(
      'permissions',
      'permission_key',
      sql`(${table.resource} || '.' || ${table.action}) in (${allowedPermissionKeys})`
    ),
  ]
);

// ---- User-Roles junction table (many-to-many) -------------------------

// Maps users to their assigned roles. A user can have multiple roles.
// Effective permissions = union of permissions from all assigned roles.
export const userRoles = pgTable(
  'user_roles',
  {
    user_id: uuid('user_id').notNull(),
    role_id: uuid('role_id').notNull(),
    assigned_at: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One assignment per user/role pair; the composite key is the identity.
    primaryKeyConstraint('user_roles', [table.user_id, table.role_id]),
    // Every foreign key column is indexed; this supports "users in a role".
    indexOn('user_roles', table.role_id),
    foreignKeyConstraint('user_roles', table.role_id, roles.id),
  ]
);

// ---- Export types ------------------------------------------------------

export type AuthorizationTables = typeof roles & typeof permissions & typeof userRoles;
export type AuthorizationSchema = typeof roles | typeof permissions | typeof userRoles;
