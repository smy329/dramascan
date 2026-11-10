/**
 * Authentication schema fragment (owned by `auth`).
 *
 * These tables implement Better Auth 1.7.x's canonical model for Google OAuth
 * with a Drizzle/PostgreSQL adapter. TypeScript property names use Better
 * Auth's camelCase field names; physical PostgreSQL columns remain snake_case
 * per the project conventions. The drizzle adapter indexes the table object by
 * Better Auth's field name, so this mapping must not be renamed.
 *
 * Tables: `users`, `accounts`, `sessions`, `verifications`.
 *
 * Only the `auth` module may write these tables. `src/db/schema.ts` assembles
 * this namespace; no module may import this file directly.
 *
 * Google OAuth only: email/password sign-in is disabled in the Better Auth
 * configuration and no credential rows are written.
 *
 * Application-owned columns (`is_active`, `is_super_admin`, `role`,
 * `deleted_at`) are not part of Better Auth's model. They are read by the
 * authorization module and the authentication hooks; Better Auth never
 * mutates them.
 *
 * RBAC tables (`roles`, `permissions`, `user_roles`) are owned by the
 * `authorization` module. The authorization module reads
 * `users.is_super_admin` / `is_active` / `deleted_at` when resolving an actor.
 */

import { pgTable, text, timestamp, uuid, boolean } from 'drizzle-orm/pg-core';
import {
  createdAt,
  deletedAt,
  foreignKeyConstraint,
  indexOn,
  uniqueConstraint,
  updatedAt,
  uuidPrimaryKey,
} from '@/platform/db/schema-helpers';

// ---- Users table -------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuidPrimaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    // ---- Application-owned account status / authorization columns ----
    isActive: boolean('is_active').notNull().default(true),
    isSuperAdmin: boolean('is_super_admin').notNull().default(false),
    // Deprecated single-role column kept for backward compatibility. New code
    // reads `user_roles`; effective permissions are the union of assigned roles.
    role: text('role').default('viewer'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  table => [uniqueConstraint('users', table.email)]
);

// ---- Accounts table ----------------------------------------------------

export const accounts = pgTable(
  'accounts',
  {
    id: uuidPrimaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true, mode: 'date' }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
      withTimezone: true,
      mode: 'date',
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueConstraint('accounts', table.providerId, table.accountId),
    foreignKeyConstraint('accounts', table.userId, users.id, { onDelete: 'cascade' }),
    indexOn('accounts', table.userId),
  ]
);

// ---- Sessions table ----------------------------------------------------

export const sessions = pgTable(
  'sessions',
  {
    id: uuidPrimaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    token: text('token').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueConstraint('sessions', table.token),
    foreignKeyConstraint('sessions', table.userId, users.id, { onDelete: 'cascade' }),
    indexOn('sessions', table.userId),
  ]
);

// ---- Verifications table -----------------------------------------------

export const verifications = pgTable(
  'verifications',
  {
    id: uuidPrimaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [indexOn('verifications', table.identifier)]
);

// ---- Export types ------------------------------------------------------

export type AuthTables = typeof users & typeof accounts & typeof sessions & typeof verifications;
export type AuthSchema = typeof users | typeof accounts | typeof sessions | typeof verifications;

export {};
