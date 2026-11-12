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
