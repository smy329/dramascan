/**
 * Drizzle queries over the auth module's own tables.
 *
 * The `users` table is owned by this module, so the admin user listing reads
 * it here and not from the users module. The users module reaches this query
 * through `src/modules/auth/index.ts`.
 *
 * `ARCHITECTURE.md` §5.4 asks every protected query to take an `ActorContext`.
 * This module cannot: `auth` may not import `authorization` (§7.2, D-008), so
 * it cannot even name the type. The protected query is
 * `listUsersForAdmin` in the users module, which enforces the permission
 * before this function is called.
 */

import 'server-only';

import { and, asc, count, desc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { ConflictError, NotFoundError } from '@/platform/errors';

import { users } from './schema';

/** Account statuses an administrator can filter by. */
export const USER_ACCOUNT_STATUSES = ['active', 'deactivated', 'deleted'] as const;

export type UserAccountStatus = (typeof USER_ACCOUNT_STATUSES)[number];

/** Columns an administrator can sort by. */
export const USER_ACCOUNT_SORT_FIELDS = ['name', 'email', 'createdAt', 'updatedAt'] as const;

export type UserAccountSortField = (typeof USER_ACCOUNT_SORT_FIELDS)[number];

export type ListUserAccountsQuery = {
  page: number;
  pageSize: number;
  sortBy: UserAccountSortField;
  sortDirection: 'asc' | 'desc';
  search: string | null;
  status: UserAccountStatus | null;
  isSuperAdmin: boolean | null;
};

export type UserAccountRow = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  isSuperAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type UserAccountPage = {
  rows: UserAccountRow[];
  total: number;
};

/** Escape the LIKE wildcards so a search term is matched literally. */
function escapeSearchTerm(term: string): string {
  return term.replace(/[\\%_]/g, character => `\\${character}`);
}

function buildAccountFilter(query: ListUserAccountsQuery) {
  const conditions = [];

  if (query.status === 'deleted') {
    conditions.push(isNotNull(users.deletedAt));
  } else {
    conditions.push(isNull(users.deletedAt));

    if (query.status === 'active') {
      conditions.push(eq(users.isActive, true));
    } else if (query.status === 'deactivated') {
      conditions.push(eq(users.isActive, false));
    }
  }

  if (query.isSuperAdmin !== null) {
    conditions.push(eq(users.isSuperAdmin, query.isSuperAdmin));
  }

  if (query.search !== null && query.search.length > 0) {
    const pattern = `%${escapeSearchTerm(query.search)}%`;
    conditions.push(
      or(
        sql`${users.name} ILIKE ${pattern} ESCAPE '\\'`,
        sql`${users.email} ILIKE ${pattern} ESCAPE '\\'`
      )
    );
  }

  return and(...conditions);
}

function buildSortColumn(sortBy: UserAccountSortField) {
  switch (sortBy) {
    case 'name':
      return users.name;
    case 'email':
      return users.email;
    case 'createdAt':
      return users.createdAt;
    case 'updatedAt':
      return users.updatedAt;
    default:
      throw new Error(`Unsupported sort field: ${sortBy}`);
  }
}

/**
 * Read one page of user accounts and the total number of matching accounts.
 *
 * The ordering always ends with the row id, so the order is total and paging
 * can neither repeat nor skip a row when the primary sort key ties.
 */
export async function listUserAccounts(query: ListUserAccountsQuery): Promise<UserAccountPage> {
  const filter = buildAccountFilter(query);
  const sortColumn = buildSortColumn(query.sortBy);
  const order =
    query.sortDirection === 'asc'
      ? [asc(sortColumn), asc(users.id)]
      : [desc(sortColumn), asc(users.id)];
  // Defense in depth: `AdminUsersQuery` already refuses a page below 1, so a
  // negative offset cannot reach PostgreSQL today. Clamping it here keeps that
  // true if a future caller builds the query by hand.
  const offset = Math.max((query.page - 1) * query.pageSize, 0);

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      isSuperAdmin: users.isSuperAdmin,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(filter)
    .orderBy(...order)
    .limit(query.pageSize)
    .offset(offset);

  const [totalRow] = await db.select({ value: count() }).from(users).where(filter);

  return { rows, total: Number(totalRow?.value ?? 0) };
}

/** One identity row, with the account-status columns an administrator needs. */
export type UserAccountRecord = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  isSuperAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

const USER_ACCOUNT_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  isActive: users.isActive,
  isSuperAdmin: users.isSuperAdmin,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
  deletedAt: users.deletedAt,
} as const;

/** Read one account, or `null` when the id matches no row. */
export async function getUserAccount(userId: string): Promise<UserAccountRecord | null> {
  const [row] = await db
    .select(USER_ACCOUNT_COLUMNS)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return row ?? null;
}

/**
 * Activate or deactivate an account.
 *
 * The last-active-Super-Admin invariant is enforced here, inside the module
 * that owns the `users` table, so it holds for every caller. The check runs in
 * one transaction that locks the active Super Admin rows before the target
 * row:
 *
 * - The lock is taken in a stable order (by id), so two concurrent
 *   deactivations cannot deadlock or both observe a stale count.
 * - PostgreSQL re-evaluates the row filter after a blocked lock is released, so
 *   the second transaction sees the first one's deactivation and refuses to
 *   remove the last remaining Super Admin.
 *
 * A deactivated account loses access immediately: the actor resolver reads
 * `is_active` from the database on every request, so a stale session cookie is
 * not enough to get back in.
 */
export async function setUserAccountActive(
  userId: string,
  isActive: boolean
): Promise<UserAccountRecord> {
  return db.transaction(async tx => {
    const lockedSuperAdmins = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.isSuperAdmin, true),
          eq(users.isActive, true),
          isNull(users.deletedAt)
        )
      )
      .orderBy(asc(users.id))
      .for('update');

    const [target] = await tx
      .select(USER_ACCOUNT_COLUMNS)
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1);

    if (!target) {
      throw new NotFoundError('User account not found.');
    }

    const isActiveSuperAdmin =
      target.isSuperAdmin && target.isActive && target.deletedAt === null;

    if (!isActive && isActiveSuperAdmin && lockedSuperAdmins.length <= 1) {
      throw new ConflictError('The last active Super Admin cannot be deactivated.');
    }

    if (target.isActive !== isActive) {
      await tx
        .update(users)
        .set({ isActive, updatedAt: new Date() })
        .where(eq(users.id, userId));
    }

    return { ...target, isActive };
  });
}
