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
 * RBAC tables (`roles`, `permissions`, `user_roles`) are owned by the
 * `authorization` module. These identity tables remain owned by `auth`; the
 * authorization module reads `users.is_super_admin` / `is_active` / `deleted_at`
 * when resolving an actor.
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

// ---- Export types ------------------------------------------------------

export type AuthTables = typeof users & typeof accounts & typeof sessions & typeof verifications;
export type AuthSchema = typeof users | typeof accounts | typeof sessions | typeof verifications;

export {};
