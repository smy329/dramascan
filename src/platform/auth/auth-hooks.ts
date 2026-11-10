/**
 * Database-backed authentication hooks.
 *
 * Better Auth calls these during sign-in. The decisions themselves live in
 * `auth-policy.ts`; this module only supplies PostgreSQL access and the
 * concurrency barrier.
 *
 * `bootstrapSuperAdminForUser` runs inside a transaction that first acquires a
 * transaction-scoped advisory lock. Concurrent first sign-ins therefore
 * serialize: the second transaction observes the committed promotion and does
 * not promote another user. The lock is released automatically when the
 * transaction ends.
 */

import 'server-only';

import { APIError } from 'better-auth/api';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { serverConfig } from '@/platform/config';
import {
  bootstrapSuperAdmin,
  decideSessionCreation,
  type SuperAdminBootstrapResult,
  type SuperAdminBootstrapStore,
  type SuperAdminCandidate,
} from './auth-policy';

/**
 * Stable application-wide lock key for Super Admin bootstrap. Any constant
 * works as long as every process uses the same value; it must not collide with
 * another advisory lock in this application.
 */
const SUPER_ADMIN_BOOTSTRAP_LOCK_KEY = 4_627_001_033;

/** Reject a user who is missing, deactivated, or soft-deleted. */
export async function assertUserCanCreateSession(userId: string): Promise<void> {
  const [account] = await db
    .select({ isActive: users.isActive, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const decision = decideSessionCreation(account ?? null);

  if (decision !== 'allowed') {
    throw new APIError('FORBIDDEN', {
      code: 'ACCOUNT_NOT_ACTIVE',
      message: 'This account is not permitted to sign in.',
    });
  }
}

/**
 * Promote the configured first Super Admin.
 *
 * Only a user whose normalized email matches `SUPER_ADMIN_EMAIL` is eligible,
 * and only while no Super Admin exists. Any other outcome leaves the database
 * unchanged.
 */
export async function bootstrapSuperAdminForUser(
  userId: string
): Promise<SuperAdminBootstrapResult> {
  return bootstrapSuperAdmin(userId, {
    configuredEmail: serverConfig.superAdminEmail,
    runExclusive: work =>
      db.transaction(async tx => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${SUPER_ADMIN_BOOTSTRAP_LOCK_KEY}::bigint)`
        );

        const store: SuperAdminBootstrapStore = {
          async findCandidate(candidateId: string): Promise<SuperAdminCandidate | null> {
            const [row] = await tx
              .select({
                id: users.id,
                email: users.email,
                isSuperAdmin: users.isSuperAdmin,
                isActive: users.isActive,
                deletedAt: users.deletedAt,
              })
              .from(users)
              .where(eq(users.id, candidateId))
              .limit(1);

            return row ?? null;
          },
          async hasSuperAdmin(): Promise<boolean> {
            const [row] = await tx
              .select({ id: users.id })
              .from(users)
              .where(eq(users.isSuperAdmin, true))
              .limit(1);

            return row !== undefined;
          },
          async promote(candidateId: string): Promise<void> {
            await tx
              .update(users)
              .set({ isSuperAdmin: true, updatedAt: new Date() })
              .where(eq(users.id, candidateId));
          },
        };

        return work(store);
      }),
  });
}
