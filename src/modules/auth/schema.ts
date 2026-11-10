/**
 * Authentication schema fragment (owned by `auth`).
 *
 * Tables are added by the authentication and account data-model prompts.
 * Planned tables: `users`, `accounts`, `sessions`, `verifications`.
 * Only the `auth` module may write these tables. `src/db/schema.ts` assembles
 * this namespace; no module may import this file directly.
 *
 * Better Auth manages its own ID type for these tables (see D-013). Foreign keys
 * referencing the auth user table use the same ID type.
 *
 * Google OAuth only: the `password` column is kept nullable; no password hash is
 * stored. No additional OAuth providers are configured.
 *
 * Table conventions follow CONVENTIONS.md §5: snake_case columns, plural tables,
 * timestamptz timestamps, `deleted_at` for soft delete.
 *
 * RBAC system: roles and permissions tables for the role-based access control model.
 * Defines fine-grained permissions at action/resource level.
 * The canonical permission identifier is the `resource.action` key
 * (e.g. `drama.update`), owned by the `authorization` module's canonical
 * permission catalog; the composed key is stored via the `resource` + `action`
 * columns and must exist in that catalog.
 * Supports multiple roles per user — effective permissions are the combined
 * permissions of all assigned roles.
 * Roles and permissions are stored in the database (not hardcoded), allowing
 * Super Admin to create, edit, and customise roles without code changes.
 * The `is_super_admin` boolean flag on the user record still grants complete
 * access regardless of role assignments.
 */

import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid, boolean } from 'drizzle-orm/pg-core';
import { uniqueConstraint } from '@/platform/db/schema-helpers';

// ---- Role name values (string literals for the roles table) ------------

export const RoleName = {
  SUPER_ADMIN: 'super_admin' as const,
  CONTENT_MANAGER: 'content_manager' as const,
  MODERATOR: 'moderator' as const,
  ANALYST: 'analyst' as const,
  VIEWER: 'viewer' as const,
} as const;

export type RoleName = typeof RoleName[keyof typeof RoleName];

// ---- Users table -------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').notNull(),
  name: text('name'),
  email: text('email').notNull(),
  email_verified: timestamp('email_verified', { withTimezone: true }).default(sql`now()`),
  image: text('image'),
  password: text('password'),
  is_active: boolean('is_active').notNull().default(true),
  is_super_admin: boolean('is_super_admin').notNull().default(false),
  // Many-to-many: user's assigned roles are in the user_roles junction table.
  // This column is kept for backward compatibility; new code should query
  // user_roles instead of relying on a single role string.
  role: text('role').default('viewer'), // deprecated: use user_roles table
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
});

// ---- Accounts table ----------------------------------------------------

export const accounts = pgTable('accounts', {
  id: uuid('id').notNull(),
  user_id: uuid('user_id').notNull(),
  type: text('type').notNull(),
  provider: text('provider').notNull(),
  provider_account_id: text('provider_account_id').notNull(),
  access_token: text('access_token'),
  refresh_token: text('refresh_token'),
  access_token_expires_at: timestamp('access_token_expires_at', { withTimezone: true }),
  refresh_token_expires_at: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Sessions table ----------------------------------------------------

export const sessions = pgTable('sessions', {
  id: uuid('id').notNull(),
  user_id: uuid('user_id').notNull(),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
  session_token: text('session_token').notNull().unique(),
  access_token: text('access_token'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Verifications table -----------------------------------------------

export const verifications = pgTable('verifications', {
  id: uuid('id').notNull(),
  identifier: text('identifier').notNull(),
  token: text('token').notNull(),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Roles table -------------------------------------------------------

export const roles = pgTable('roles', {
  id: uuid('id').notNull(),
  name: text('name').notNull(), // e.g. super_admin, content_manager, moderator, analyst, viewer, or custom name
  description: text('description'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- User-Roles junction table (many-to-many) -----------------------

// Maps users to their assigned roles. A user can have multiple roles.
// Effective permissions = union of permissions from all assigned roles.
// Unique constraint on (user_id, role_id) prevents duplicate assignments.
export const userRoles = pgTable(
  'user_roles',
  {
    user_id: uuid('user_id').notNull(),
    role_id: uuid('role_id').notNull(),
    assigned_at: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueConstraint('user_roles', table.user_id, table.role_id),
  ]
);

// ---- Permissions table -------------------------------------------------

// Fine-grained permissions assigned to roles at the action/resource level.
// The canonical permission identifier is the `${resource}.${action}` key
// (e.g. `drama.update`), owned by the `authorization` module's canonical
// permission catalog. The `action` + `resource` columns are the physical
// columns that compose to that canonical key.

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').notNull(),
    action: text('action').notNull(), // create, read, update, delete, manage
    resource: text('resource').notNull(), // drama, movie, episode, etc.
    role_id: uuid('role_id').notNull(),
    granted: boolean('granted').notNull().default(true),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One granted/revoked entry per (role, permission). The `granted` flag
    // toggles the single canonical permission for a role.
    uniqueConstraint('permissions', table.role_id, table.resource, table.action),
  ]
);

// ---- Export types ------------------------------------------------------

export type AuthTables = typeof users & typeof accounts & typeof sessions & typeof verifications & typeof roles & typeof permissions & typeof userRoles;
export type AuthSchema = typeof users | typeof accounts | typeof sessions | typeof verifications | typeof roles | typeof permissions | typeof userRoles;

export {};
