import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { users } from './schema';

/**
 * The identity audience (D-070).
 *
 * A broadcast — a new drama, a new season, a website announcement — reaches
 * every active account. The list of those accounts is the identity module's
 * business: it owns the `users` table, so it answers the question and nobody
 * else reads the table directly.
 *
 * The read is bounded: a platform with more accounts than the bound notifies
 * the first `limit` of them and no more. The bound is part of the contract,
 * not an accident of the query.
 */

/** How many accounts one audience read returns by default. */
export const DEFAULT_AUDIENCE_LIMIT = 5000;

/** The largest audience one read may return. */
export const MAX_AUDIENCE_LIMIT = 10_000;

/**
 * The identifiers of the active accounts.
 *
 * A deactivated account and a soft-deleted account are not part of the
 * audience: neither can sign in, and neither is told about a new title.
 *
 * @param limit the maximum number of accounts
 * @param executor the database executor
 * @returns the account identifiers
 */
export async function listActiveAccountIds(
  limit: number = DEFAULT_AUDIENCE_LIMIT,
  executor: DbExecutor = db
): Promise<string[]> {
  const bounded = Math.max(1, Math.min(Math.trunc(limit), MAX_AUDIENCE_LIMIT));

  const rows = await executor
    .select({ id: users.id })
    .from(users)
    .where(and(isNull(users.deletedAt), eq(users.isActive, true)))
    .limit(bounded);

  return rows.map(row => row.id);
}
