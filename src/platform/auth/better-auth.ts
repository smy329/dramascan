/**
 * Better Auth configuration (server-only).
 *
 * Google OAuth is the only sign-in provider. Email/password authentication is
 * disabled. Better Auth owns the `users`, `accounts`, `sessions`, and
 * `verifications` tables through the Drizzle adapter; the physical columns are
 * snake_case while the TypeScript keys match Better Auth's camelCase field
 * names.
 *
 * `generateId: 'uuid'` selects UUID primary keys. The Drizzle adapter reports
 * UUID support for PostgreSQL, so Better Auth relies on the database defaults
 * (`uuidv7()`) defined by `uuidPrimaryKey()`.
 *
 * The session-creation hook has two responsibilities:
 * - reject deactivated or soft-deleted accounts before a session exists, and
 * - promote the configured first Super Admin (see `auth-hooks.ts`).
 *
 * Only imported on the server (via `server-only`).
 */

import 'server-only';

import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { db } from '@/db/client';
import { accounts, sessions, users, verifications, loginAttempts } from '@/modules/auth/schema';
import { serverConfig } from '@/platform/config';
import { assertUserCanCreateSession, bootstrapSuperAdminForUser } from './auth-hooks';

const googleProvider =
  serverConfig.googleClientId && serverConfig.googleClientSecret
    ? {
        google: {
          clientId: serverConfig.googleClientId,
          clientSecret: serverConfig.googleClientSecret,
        },
      }
    : {};

export const auth = betterAuth({
  appName: 'DramaScan',
  baseURL: serverConfig.appUrl,
  secret: serverConfig.betterAuthSecret ?? undefined,
  trustedOrigins: [...serverConfig.trustedOrigins],
  database: drizzleAdapter(db, {
    provider: 'pg',
    usePlural: true,
    schema: { users, sessions, accounts, verifications, loginAttempts },
  }),
  socialProviders: googleProvider,
  emailAndPassword: {
    enabled: false,
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google'],
    },
  },
  advanced: {
    database: {
      generateId: 'uuid',
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async session => {
          const userId = session.userId;
          await assertUserCanCreateSession(userId);
          await bootstrapSuperAdminForUser(userId);
        },
      },
    },
  },
  plugins: [nextCookies()],
});

export type AuthClient = typeof auth;

export default auth;
