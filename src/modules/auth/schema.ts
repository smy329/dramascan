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
 * Initial roles: super_admin, content_manager, moderator, analyst, viewer.
 */

import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid, boolean } from 'drizzle-orm/pg-core';

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
  role: text('role').default('viewer'), // viewer, user, admin, super_admin
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
  name: text('name').notNull(), // super_admin, content_manager, moderator, analyst, viewer
  description: text('description'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Permissions table -------------------------------------------------

// Permission action/resource constants
// These define the RBAC fine-grained permissions
export const permissionAction = {
  CREATE: 'create' as const,
  READ: 'read' as const,
  UPDATE: 'update' as const,
  DELETE: 'delete' as const,
  MANAGE: 'manage' as const,
} as const;

export type PermissionAction = keyof typeof permissionAction;

export const permissionResource = {
  DRAMA: 'drama' as const,
  MOVIE: 'movie' as const,
  EPISODE: 'episode' as const,
  CATEGORY: 'category' as const,
  PLATFORM: 'platform' as const,
  USER: 'user' as const,
  REVIEW: 'review' as const,
  RATING: 'rating' as const,
  ANALYTICS: 'analytics' as const,
  SETTINGS: 'settings' as const,
  ADMIN: 'admin' as const,
} as const;

export type PermissionResource = keyof typeof permissionResource;

// Table-level permissions: (action, resource) pairs assigned to roles
export const permissions = pgTable('permissions', {
  id: uuid('id').notNull(),
  action: text('action').notNull(), // create, read, update, delete, manage
  resource: text('resource').notNull(), // drama, movie, episode, etc.
  role_id: uuid('role_id').notNull(),
  granted: boolean('granted').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Initial role definitions (constant, not stored in code) ----------

// These are the initial roles for the DramaScan RBAC system.
// Permissions are assigned to roles via the permissions table.
export const INITIAL_ROLES = {
  SUPER_ADMIN: 'super_admin' as const,
  CONTENT_MANAGER: 'content_manager' as const,
  MODERATOR: 'moderator' as const,
  ANALYST: 'analyst' as const,
  VIEWER: 'viewer' as const,
} as const;

export type InitialRole = keyof typeof INITIAL_ROLES;

/** Default permission assignments for each role.
 * These map (action, resource) pairs to granted=true for each role.
 * Super Admin: all permissions granted (no 'ALL' action needed - has every permission).
 * Content Manager: manage content, read analytics.
 * Moderator: user moderation, content review.
 * Analyst: read-only dashboard and analytics.
 * Viewer: read/limited content.
 */
export const ROLE_PERMISSIONS = {
  [INITIAL_ROLES.SUPER_ADMIN]: [
    // Super Admin has all permissions - every (action, resource) pair is granted
    { action: permissionAction.CREATE, resource: permissionResource.DRAMA },
    { action: permissionAction.READ, resource: permissionResource.DRAMA },
    { action: permissionAction.UPDATE, resource: permissionResource.DRAMA },
    { action: permissionAction.DELETE, resource: permissionResource.DRAMA },
    { action: permissionAction.MANAGE, resource: permissionResource.DRAMA },
    { action: permissionAction.CREATE, resource: permissionResource.MOVIE },
    { action: permissionAction.READ, resource: permissionResource.MOVIE },
    { action: permissionAction.UPDATE, resource: permissionResource.MOVIE },
    { action: permissionAction.DELETE, resource: permissionResource.MOVIE },
    { action: permissionAction.MANAGE, resource: permissionResource.MOVIE },
    { action: permissionAction.CREATE, resource: permissionResource.EPISODE },
    { action: permissionAction.READ, resource: permissionResource.EPISODE },
    { action: permissionAction.UPDATE, resource: permissionResource.EPISODE },
    { action: permissionAction.DELETE, resource: permissionResource.EPISODE },
    { action: permissionAction.MANAGE, resource: permissionResource.EPISODE },
    { action: permissionAction.CREATE, resource: permissionResource.CATEGORY },
    { action: permissionAction.READ, resource: permissionResource.CATEGORY },
    { action: permissionAction.UPDATE, resource: permissionResource.CATEGORY },
    { action: permissionAction.DELETE, resource: permissionResource.CATEGORY },
    { action: permissionAction.MANAGE, resource: permissionResource.CATEGORY },
    { action: permissionAction.CREATE, resource: permissionResource.PLATFORM },
    { action: permissionAction.READ, resource: permissionResource.PLATFORM },
    { action: permissionAction.UPDATE, resource: permissionResource.PLATFORM },
    { action: permissionAction.DELETE, resource: permissionResource.PLATFORM },
    { action: permissionAction.MANAGE, resource: permissionResource.PLATFORM },
    { action: permissionAction.READ, resource: permissionResource.USER },
    { action: permissionAction.MANAGE, resource: permissionResource.USER },
    { action: permissionAction.READ, resource: permissionResource.REVIEW },
    { action: permissionAction.MANAGE, resource: permissionResource.REVIEW },
    { action: permissionAction.READ, resource: permissionResource.RATING },
    { action: permissionAction.MANAGE, resource: permissionResource.RATING },
    { action: permissionAction.READ, resource: permissionResource.ANALYTICS },
    { action: permissionAction.MANAGE, resource: permissionResource.ANALYTICS },
    { action: permissionAction.READ, resource: permissionResource.SETTINGS },
    { action: permissionAction.MANAGE, resource: permissionResource.SETTINGS },
  ],
  [INITIAL_ROLES.CONTENT_MANAGER]: [
    // Content Manager: manage content, read analytics
    { action: permissionAction.CREATE, resource: permissionResource.DRAMA },
    { action: permissionAction.READ, resource: permissionResource.DRAMA },
    { action: permissionAction.UPDATE, resource: permissionResource.DRAMA },
    { action: permissionAction.MANAGE, resource: permissionResource.DRAMA },
    { action: permissionAction.CREATE, resource: permissionResource.MOVIE },
    { action: permissionAction.READ, resource: permissionResource.MOVIE },
    { action: permissionAction.UPDATE, resource: permissionResource.MOVIE },
    { action: permissionAction.MANAGE, resource: permissionResource.MOVIE },
    { action: permissionAction.CREATE, resource: permissionResource.EPISODE },
    { action: permissionAction.READ, resource: permissionResource.EPISODE },
    { action: permissionAction.UPDATE, resource: permissionResource.EPISODE },
    { action: permissionAction.MANAGE, resource: permissionResource.EPISODE },
    { action: permissionAction.READ, resource: permissionResource.CATEGORY },
    { action: permissionAction.UPDATE, resource: permissionResource.CATEGORY },
    { action: permissionAction.MANAGE, resource: permissionResource.CATEGORY },
    { action: permissionAction.READ, resource: permissionResource.PLATFORM },
    { action: permissionAction.MANAGE, resource: permissionResource.PLATFORM },
    { action: permissionAction.READ, resource: permissionResource.ANALYTICS },
  ],
  [INITIAL_ROLES.MODERATOR]: [
    // Moderator: user moderation, content review
    { action: permissionAction.READ, resource: permissionResource.DRAMA },
    { action: permissionAction.UPDATE, resource: permissionResource.DRAMA },
    { action: permissionAction.DELETE, resource: permissionResource.DRAMA },
    { action: permissionAction.READ, resource: permissionResource.EPISODE },
    { action: permissionAction.UPDATE, resource: permissionResource.EPISODE },
    { action: permissionAction.DELETE, resource: permissionResource.EPISODE },
    { action: permissionAction.READ, resource: permissionResource.USER },
    { action: permissionAction.CREATE, resource: permissionResource.REVIEW },
    { action: permissionAction.READ, resource: permissionResource.REVIEW },
    { action: permissionAction.DELETE, resource: permissionResource.REVIEW },
    { action: permissionAction.READ, resource: permissionResource.RATING },
    { action: permissionAction.MANAGE, resource: permissionResource.RATING },
    { action: permissionAction.READ, resource: permissionResource.ANALYTICS },
  ],
  [INITIAL_ROLES.ANALYST]: [
    // Analyst: read-only dashboard and analytics
    { action: permissionAction.READ, resource: permissionResource.ANALYTICS },
    { action: permissionAction.READ, resource: permissionResource.DRAMA },
    { action: permissionAction.READ, resource: permissionResource.MOVIE },
    { action: permissionAction.READ, resource: permissionResource.EPISODE },
    { action: permissionAction.READ, resource: permissionResource.CATEGORY },
    { action: permissionAction.READ, resource: permissionResource.PLATFORM },
    { action: permissionAction.READ, resource: permissionResource.USER },
    { action: permissionAction.READ, resource: permissionResource.REVIEW },
    { action: permissionAction.READ, resource: permissionResource.RATING },
    { action: permissionAction.READ, resource: permissionResource.SETTINGS },
  ],
  [INITIAL_ROLES.VIEWER]: [
    // Viewer: limited content access
    { action: permissionAction.READ, resource: permissionResource.DRAMA },
    { action: permissionAction.READ, resource: permissionResource.MOVIE },
    { action: permissionAction.READ, resource: permissionResource.EPISODE },
  ],
} as const;

export type RolePermissions = typeof ROLE_PERMISSIONS;

// ---- Export types ------------------------------------------------------

export type AuthTables = typeof users & typeof accounts & typeof sessions & typeof verifications & typeof roles & typeof permissions;
export type AuthSchema = typeof users | typeof accounts | typeof sessions | typeof verifications | typeof roles | typeof permissions;

export {};