# Admin Data Tables (Prompt 051) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable admin data-table kit (server-driven pagination, sorting, search, filters, empty/loading/error states) and prove it with a complete `/admin/users` implementation whose state lives entirely in the URL.

**Architecture:** A client-safe shared contract in `src/lib/contracts/table.ts` owns the URL query-state shape and the href builder; a Server Component kit in `src/components/admin/data-table/` renders the table, toolbar, pagination bar, skeleton, and error state with no client JavaScript. The domain side is split by ownership: the auth module owns the Drizzle query over its own `users` table (`src/modules/auth/repository.ts`, exposed through `src/modules/auth/index.ts`), and the users module owns the admin projection and the `user.read` guard (`src/modules/users/read-models/admin-users.ts`, exposed through `src/modules/users/index.ts`). The page is a Server Component that parses `searchParams` with Zod, calls the module query service, and renders the kit.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS 4, shadcn/Base UI primitives, Drizzle ORM, PostgreSQL 18, Zod 4, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-admin-data-tables-design.md`

## Global Constraints

- **No new permission key, no new dependency, no `forbidden.tsx`, no `experimental.authInterrupts`, no REST endpoint for the listing, and no client-side table state.** The only schema change is the single approved index in Task 5.
- The table, toolbar, and pagination bar are **Server Components**. The only client islands are the existing `RetryButton` in the route error boundary and Next.js's own `error.tsx`.
- `src/components/ui/table.tsx` loses its `'use client'` directive (it has no state, hooks, or handlers). No other file in `src/components/ui/**` changes.
- Only one page of rows may reach the browser. Never query the whole collection and paginate in memory.
- The sortable-column allowlist is enforced server-side. A client-supplied column name never reaches SQL.
- `is_super_admin` is the authoritative Super Admin definition. It is never inferred from a role name, a permission, or a query parameter.
- Soft-deleted users are visible only when `status=deleted`. A deleted user is never reported as active or deactivated.
- An admin-area actor without `user.read` receives `notFound()` (404) on `/admin/users`. This is D-026 and is scoped to this route; no existing route's behavior changes.
- The `/admin/users` navigation entry becomes `implemented: true` only after the route and its guard exist.
- `npm run lint` enforces `no-extra-parens` and `arrow-body-style`: use early returns and single-line implicit returns, not parenthesized multi-line JSX.
- Tests are not weakened or deleted to make a suite pass. No test asserts against a mock of the module under test.
- **One commit total for Prompt 051. No per-task commits and no push** until the hash and verification results are shown and explicit approval is received.

## Review Focus

1. **A hand-edited URL** — `?page=-3&pageSize=9999&sort=; DROP TABLE users&status=bogus&superAdmin=maybe` must render a normal page with defaults, never an error page and never a SQL fragment.
2. **A filter change must not silently drop another filter** — applying the Status filter while a Super Admin filter and a search term are active must keep all three and reset to page 1.
3. **A deleted account must never appear as active** — a row with `deleted_at` set and `is_active = true` is reported as `deleted`, and appears only under `status=deleted`.
4. **The browser must never receive the whole collection** — the response contains one page of rows; the total count is a number, not the collection.
5. **An actor without `user.read` must not be able to reach the listing by guessing the URL** — the page gate and the service guard must both refuse, and the navigation link must not be the boundary.

---

### Task 1: Shared table-state contract

**Files:**
- Create: `src/lib/contracts/table.ts`
- Test: `tests/unit/lib/table-contract.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 6–8):
  - `TABLE_QUERY_PARAMS = { page: 'page', pageSize: 'pageSize', sort: 'sort', search: 'q' } as const`
  - `DEFAULT_TABLE_PAGE_SIZE = 20`, `MAX_TABLE_PAGE_SIZE = 100`, `TABLE_PAGE_SIZE_OPTIONS = [20, 50, 100] as const`
  - `type TableSortDirection = 'asc' | 'desc'`
  - `type TableQueryState = Readonly<{ page: number; pageSize: number; sort: string; search: string; filters: Readonly<Record<string, string>> }>`
  - `buildTableHref(pathname: string, state: TableQueryState, overrides?: Partial<TableQueryState>): string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/table-contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TABLE_PAGE_SIZE,
  MAX_TABLE_PAGE_SIZE,
  TABLE_PAGE_SIZE_OPTIONS,
  TABLE_QUERY_PARAMS,
  buildTableHref,
  type TableQueryState,
} from '@/lib/contracts/table';

const state: TableQueryState = {
  page: 1,
  pageSize: 20,
  sort: '-createdAt',
  search: '',
  filters: {},
};

describe('table query parameters', () => {
  it('names the query parameters', () => {
    expect(TABLE_QUERY_PARAMS).toEqual({
      page: 'page',
      pageSize: 'pageSize',
      sort: 'sort',
      search: 'q',
    });
  });

  it('fixes the page size defaults and options', () => {
    expect(DEFAULT_TABLE_PAGE_SIZE).toBe(20);
    expect(MAX_TABLE_PAGE_SIZE).toBe(100);
    expect(TABLE_PAGE_SIZE_OPTIONS).toEqual([20, 50, 100]);
  });
});

describe('buildTableHref', () => {
  it('always emits the sort column and the page size', () => {
    expect(buildTableHref('/admin/users', state)).toBe(
      '/admin/users?pageSize=20&sort=-createdAt'
    );
  });

  it('omits the page parameter on the first page', () => {
    expect(buildTableHref('/admin/users', { ...state, page: 1 })).not.toMatch(/[?&]page=/);
  });

  it('emits the page parameter beyond the first page', () => {
    expect(buildTableHref('/admin/users', { ...state, page: 3 })).toContain('page=3');
  });

  it('omits an empty search term', () => {
    expect(buildTableHref('/admin/users', state)).not.toContain('q=');
    expect(buildTableHref('/admin/users', { ...state, search: 'lee' })).toContain('q=lee');
  });

  it('omits filters with an empty value and keeps the others', () => {
    const href = buildTableHref('/admin/users', {
      ...state,
      filters: { status: 'active', superAdmin: '' },
    });

    expect(href).toContain('status=active');
    expect(href).not.toContain('superAdmin');
  });

  it('preserves filters, search, and sort when only the page changes', () => {
    const href = buildTableHref('/admin/users', {
      ...state,
      page: 4,
      search: 'lee',
      filters: { status: 'active' },
    }, { page: 5 });

    expect(href).toContain('page=5');
    expect(href).toContain('q=lee');
    expect(href).toContain('status=active');
    expect(href).toContain('sort=-createdAt');
  });

  it('preserves filters, search, and sort when only the sort changes', () => {
    const href = buildTableHref('/admin/users', {
      ...state,
      search: 'lee',
      filters: { status: 'active' },
    }, { sort: 'name', page: 1 });

    expect(href).toBe('/admin/users?pageSize=20&sort=name&q=lee&status=active');
  });

  it('replaces the whole filter set when the filters are overridden', () => {
    const href = buildTableHref('/admin/users', {
      ...state,
      filters: { status: 'active' },
    }, { filters: {} });

    expect(href).not.toContain('status');
  });

  it('keeps the pathname free of a trailing question mark', () => {
    expect(buildTableHref('/admin/users', state)).not.toMatch(/\?$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/table-contract.test.ts`
Expected: FAIL — `@/lib/contracts/table` cannot be resolved.

- [ ] **Step 3: Implement the contract**

Create `src/lib/contracts/table.ts`:

```ts
/**
 * Client-safe table-state contract shared by the admin table kit and the
 * pages that render it.
 *
 * The whole table state lives in the URL query string, so this module owns
 * the parameter names and the href builder. It is isomorphic: no framework
 * import, no server code, and no database access.
 *
 * Modules may not import `lib` (`ARCHITECTURE.md` §7), so a domain module
 * re-declares the same parameter names and bounds in its own
 * `validation.ts`. A unit test asserts the two agree.
 */

/** Query parameter names used by every admin data table. */
export const TABLE_QUERY_PARAMS = {
  page: 'page',
  pageSize: 'pageSize',
  sort: 'sort',
  search: 'q',
} as const;

/** Default number of rows per page (`CONVENTIONS.md` §6.3). */
export const DEFAULT_TABLE_PAGE_SIZE = 20;

/** Maximum number of rows a client may request (`CONVENTIONS.md` §6.3). */
export const MAX_TABLE_PAGE_SIZE = 100;

/** Page sizes offered by the table's page-size control. */
export const TABLE_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export type TableSortDirection = 'asc' | 'desc';

export type TableQueryState = Readonly<{
  /** 1-based page index. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Sort token: a column name, `-` prefixed for descending. */
  sort: string;
  /** Free-text search term; an empty string means "no search". */
  search: string;
  /** Active filters; an empty value means "no filter". */
  filters: Readonly<Record<string, string>>;
}>;

/**
 * Build the href for a table state.
 *
 * `sort` and `pageSize` are always emitted so a shared link reproduces the
 * view exactly. `page` is emitted only beyond the first page. The search term
 * and a filter are emitted only when they carry a value.
 *
 * `overrides` replaces the named fields. `filters` is replaced wholesale, not
 * merged, so a caller that drops one filter must pass the remaining ones.
 */
export function buildTableHref(
  pathname: string,
  state: TableQueryState,
  overrides: Partial<TableQueryState> = {}
): string {
  const next: TableQueryState = { ...state, ...overrides };
  const params = new URLSearchParams();

  params.set(TABLE_QUERY_PARAMS.pageSize, String(next.pageSize));
  params.set(TABLE_QUERY_PARAMS.sort, next.sort);

  if (next.page > 1) {
    params.set(TABLE_QUERY_PARAMS.page, String(next.page));
  }

  if (next.search.length > 0) {
    params.set(TABLE_QUERY_PARAMS.search, next.search);
  }

  for (const [key, value] of Object.entries(next.filters)) {
    if (value.length > 0) {
      params.set(key, value);
    }
  }

  return `${pathname}?${params.toString()}`;
}
```

**The `page` rule is unconditional:** `page` is emitted only when the resolved page is
greater than 1, whether the page came from the state or from an override. Page 1
is the default and is never written into the URL, so one page state has exactly
one spelling and a sort link that resets to page 1 produces
`?pageSize=20&sort=name`, not `?pageSize=20&sort=name&page=1`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/lib/table-contract.test.ts`
Expected: PASS, 11 tests.

Run: `npm run typecheck`
Expected: PASS.

---

### Task 2: Auth module identity query

**Files:**
- Create: `src/modules/auth/repository.ts`
- Create: `src/modules/auth/index.ts`
- Test: `tests/integration/users/admin-user-listing.integration.test.ts` (new)

**Interfaces:**
- Produces (consumed by Tasks 3–4, exported from `@/modules/auth`):
  - `USER_ACCOUNT_STATUSES = ['active', 'deactivated', 'deleted'] as const`, `type UserAccountStatus`
  - `USER_ACCOUNT_SORT_FIELDS = ['name', 'email', 'createdAt', 'updatedAt'] as const`, `type UserAccountSortField`
  - `type ListUserAccountsQuery = { page: number; pageSize: number; sortBy: UserAccountSortField; sortDirection: 'asc' | 'desc'; search: string | null; status: UserAccountStatus | null; isSuperAdmin: boolean | null }`
  - `type UserAccountRow = { id: string; name: string; email: string; isActive: boolean; isSuperAdmin: boolean; createdAt: Date; updatedAt: Date; deletedAt: Date | null }`
  - `type UserAccountPage = { rows: UserAccountRow[]; total: number }`
  - `listUserAccounts(query: ListUserAccountsQuery): Promise<UserAccountPage>`

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/users/admin-user-listing.integration.test.ts`. Follow the harness pattern of `tests/integration/content/information-pages.integration.test.ts`: assert `TEST_DATABASE_URL` in `vi.hoisted`, point `DATABASE_URL` at it, and `vi.mock('server-only', () => ({}))`.

Seed helpers (the `users` table columns are `id`, `name`, `email`, `isActive`, `isSuperAdmin`, `role`, `createdAt`, `updatedAt`, `deletedAt`):

```ts
const TEST_EMAIL_PREFIX = 'it-users-';

async function insertUser(options: {
  name: string;
  email: string;
  isActive?: boolean;
  isSuperAdmin?: boolean;
  deletedAt?: Date | null;
  createdAt?: Date;
}): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      name: options.name,
      email: options.email,
      isActive: options.isActive ?? true,
      isSuperAdmin: options.isSuperAdmin ?? false,
      deletedAt: options.deletedAt ?? null,
      createdAt: options.createdAt ?? new Date(),
    })
    .returning({ id: users.id });

  if (!row) {
    throw new Error('Test user insert returned no row.');
  }

  return row.id;
}

async function cleanupTestUsers(): Promise<void> {
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
}
```

Use `beforeEach`/`afterEach`/`afterAll` to call `cleanupTestUsers()` and `closePool()` in `afterAll`.

Test cases (all against the real database):

```ts
describe('listUserAccounts (real database)', () => {
  it('returns only non-deleted accounts by default', async () => {
    const activeId = await insertUser({ name: 'Active Person', email: `${TEST_EMAIL_PREFIX}active@example.com` });
    const deletedId = await insertUser({
      name: 'Deleted Person',
      email: `${TEST_EMAIL_PREFIX}deleted@example.com`,
      deletedAt: new Date(),
    });

    const result = await listUserAccounts({
      page: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortDirection: 'desc',
      search: null,
      status: null,
      isSuperAdmin: null,
    });

    const ids = result.rows.map(row => row.id);
    expect(ids).toContain(activeId);
    expect(ids).not.toContain(deletedId);
  });

  it('includes soft-deleted accounts only for the deleted status', async () => {
    const deletedId = await insertUser({
      name: 'Deleted Person',
      email: `${TEST_EMAIL_PREFIX}deleted@example.com`,
      isActive: true,
      deletedAt: new Date(),
    });

    const deleted = await listUserAccounts({
      page: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortDirection: 'desc',
      search: null,
      status: 'deleted',
      isSuperAdmin: null,
    });

    expect(deleted.rows.map(row => row.id)).toContain(deletedId);
  });

  it('separates active from deactivated accounts', async () => {
    const deactivatedId = await insertUser({
      name: 'Inactive Person',
      email: `${TEST_EMAIL_PREFIX}inactive@example.com`,
      isActive: false,
    });

    const active = await listUserAccounts({ page: 1, pageSize: 100, sortBy: 'createdAt', sortDirection: 'desc', search: null, status: 'active', isSuperAdmin: null });
    const deactivated = await listUserAccounts({ page: 1, pageSize: 100, sortBy: 'createdAt', sortDirection: 'desc', search: null, status: 'deactivated', isSuperAdmin: null });

    expect(active.rows.map(row => row.id)).not.toContain(deactivatedId);
    expect(deactivated.rows.map(row => row.id)).toContain(deactivatedId);
  });

  it('matches the search term against the name or the email, case-insensitively', async () => {
    const byName = await insertUser({ name: 'Zaphod Beeblebrox', email: `${TEST_EMAIL_PREFIX}by-name@example.com` });
    const byEmail = await insertUser({ name: 'Unrelated', email: `${TEST_EMAIL_PREFIX}hoopy@example.com` });

    const result = await listUserAccounts({ page: 1, pageSize: 100, sortBy: 'createdAt', sortDirection: 'desc', search: 'ZAPHO', status: null, isSuperAdmin: null });
    expect(result.rows.map(row => row.id)).toContain(byName);
    expect(result.rows.map(row => row.id)).not.toContain(byEmail);

    const byEmailResult = await listUserAccounts({ page: 1, pageSize: 100, sortBy: 'createdAt', sortDirection: 'desc', search: 'hoopy', status: null, isSuperAdmin: null });
    expect(byEmailResult.rows.map(row => row.id)).toContain(byEmail);
  });

  it('treats a search wildcard as a literal character', async () => {
    const literal = await insertUser({ name: '100% Person', email: `${TEST_EMAIL_PREFIX}literal@example.com` });
    const other = await insertUser({ name: '100X Person', email: `${TEST_EMAIL_PREFIX}other@example.com` });

    const result = await listUserAccounts({ page: 1, pageSize: 100, sortBy: 'createdAt', sortDirection: 'desc', search: '100%', status: null, isSuperAdmin: null });

    expect(result.rows.map(row => row.id)).toContain(literal);
    expect(result.rows.map(row => row.id)).not.toContain(other);
  });

  it('filters by the Super Admin flag', async () => {
    const superAdminId = await insertUser({ name: 'Root Person', email: `${TEST_EMAIL_PREFIX}root@example.com`, isSuperAdmin: true });

    const yes = await listUserAccounts({ page: 1, pageSize: 100, sortBy: 'createdAt', sortDirection: 'desc', search: null, status: null, isSuperAdmin: true });
    const no = await listUserAccounts({ page: 1, pageSize: 100, sortBy: 'createdAt', sortDirection: 'desc', search: null, status: null, isSuperAdmin: false });

    expect(yes.rows.map(row => row.id)).toContain(superAdminId);
    expect(no.rows.map(row => row.id)).not.toContain(superAdminId);
  });

  it('combines the status and Super Admin filters', async () => {
    const activeSuperAdmin = await insertUser({ name: 'Active Root', email: `${TEST_EMAIL_PREFIX}active-root@example.com`, isSuperAdmin: true });
    const deactivatedSuperAdmin = await insertUser({ name: 'Retired Root', email: `${TEST_EMAIL_PREFIX}retired-root@example.com`, isSuperAdmin: true, isActive: false });

    const result = await listUserAccounts({ page: 1, pageSize: 100, sortBy: 'createdAt', sortDirection: 'desc', search: null, status: 'active', isSuperAdmin: true });
    const ids = result.rows.map(row => row.id);

    expect(ids).toContain(activeSuperAdmin);
    expect(ids).not.toContain(deactivatedSuperAdmin);
  });

  it('paginates with a stable total and never repeats a row across pages', async () => {
    for (let index = 0; index < 5; index += 1) {
      await insertUser({ name: `Paged ${index}`, email: `${TEST_EMAIL_PREFIX}paged-${index}@example.com` });
    }

    const first = await listUserAccounts({ page: 1, pageSize: 2, sortBy: 'name', sortDirection: 'asc', search: null, status: null, isSuperAdmin: null });
    const second = await listUserAccounts({ page: 2, pageSize: 2, sortBy: 'name', sortDirection: 'asc', search: null, status: null, isSuperAdmin: null });

    expect(first.rows).toHaveLength(2);
    expect(first.total).toBe(second.total);
    expect(first.rows.map(row => row.id)).not.toEqual(second.rows.map(row => row.id));
  });

  it('breaks sort ties with the row id so the order is total', async () => {
    const sameTime = new Date('2026-01-01T00:00:00.000Z');
    const first = await insertUser({ name: 'Tied Person', email: `${TEST_EMAIL_PREFIX}tied-a@example.com`, createdAt: sameTime });
    const second = await insertUser({ name: 'Tied Person', email: `${TEST_EMAIL_PREFIX}tied-b@example.com`, createdAt: sameTime });

    const ascending = await listUserAccounts({ page: 1, pageSize: 100, sortBy: 'name', sortDirection: 'asc', search: null, status: null, isSuperAdmin: null });
    const names = ascending.rows.filter(row => row.name === 'Tied Person').map(row => row.id);

    expect(names).toEqual([first, second].sort());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:integration -- tests/integration/users/admin-user-listing.integration.test.ts`
Expected: FAIL — `@/modules/auth/repository` does not exist.

- [ ] **Step 3: Implement the repository**

Create `src/modules/auth/repository.ts`:

```ts
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

import { and, asc, count, desc, eq, ilike, isNotNull, isNull, like, or, sql } from 'drizzle-orm';

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
```

Add the private helpers and the exported function:

```ts
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
    conditions.push(or(ilike(users.name, pattern), ilike(users.email, pattern)));
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
  const order = query.sortDirection === 'asc' ? [asc(sortColumn), asc(users.id)] : [desc(sortColumn), asc(users.id)];
  const offset = (query.page - 1) * query.pageSize;

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

  return { rows, total: totalRow?.value ?? 0 };
}
```

Remove the unused `like` and `sql` imports from the import list — only `and`, `asc`, `count`, `desc`, `eq`, `ilike`, `isNotNull`, `isNull`, `or` are used.

**Two corrections to the reference implementation above, both required:**

1. `sql` **is** used, and `ilike` is not: the pattern is bound as a parameter through
   `sql\`${users.name} ILIKE ${pattern} ESCAPE '\\'\``. Drizzle's `ilike` helper has no
   escape argument, and the explicit `ESCAPE` clause states the escape character
   instead of relying on the PostgreSQL default. Note that `\\` inside a JavaScript
   template literal is a single backslash, so the SQL text reads `ESCAPE '\'` — a
   one-character escape string, which is what PostgreSQL requires.
2. The `switch` over `sortBy` needs a `default` branch, because this project's ESLint
   config enables `default-case`. Use `default: throw new Error(...)`. The switch
   still covers every member of the union, so the throw is unreachable and TypeScript
   narrowing is unaffected.

Create `src/modules/auth/index.ts`:

```ts
/**
 * Auth module public API (server-only).
 *
 * The single public surface for the authentication and identity domain. Keep
 * it narrow: callers get identity reads and status changes they are allowed
 * to use, not the module's schema or inner helpers.
 */

import 'server-only';

export {
  USER_ACCOUNT_SORT_FIELDS,
  USER_ACCOUNT_STATUSES,
  listUserAccounts,
} from './repository';

export type {
  ListUserAccountsQuery,
  UserAccountPage,
  UserAccountRow,
  UserAccountSortField,
  UserAccountStatus,
} from './repository';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:integration -- tests/integration/users/admin-user-listing.integration.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

---

### Task 3: Admin users query contract

**Files:**
- Create: `src/modules/users/validation.ts`
- Test: `tests/unit/modules/users/admin-users-query.test.ts`

**Interfaces:**
- Consumes: `UserAccountStatus`, `UserAccountSortField` from `@/modules/auth` (type-only import).
- Produces (consumed by Tasks 4 and 8, exported from `@/modules/users`):
  - `ADMIN_USER_STATUSES`, `type AdminUserStatus`, `ADMIN_USER_SORT_FIELDS`, `type AdminUserSortField`
  - `type AdminUsersQuery = { page: number; pageSize: number; sortBy: AdminUserSortField; sortDirection: 'asc' | 'desc'; search: string; status: AdminUserStatus | null; superAdmin: boolean | null }`
  - `adminUsersQuerySchema` — a Zod object whose output matches `AdminUsersQuery`
  - `parseAdminUsersQuery(input: unknown): AdminUsersQuery`
  - `formatSortToken(sortBy: AdminUserSortField, sortDirection: 'asc' | 'desc'): string`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/modules/users/admin-users-query.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { DEFAULT_TABLE_PAGE_SIZE, MAX_TABLE_PAGE_SIZE } from '@/lib/contracts/table';
import {
  ADMIN_USER_SORT_FIELDS,
  ADMIN_USER_STATUSES,
  formatSortToken,
  parseAdminUsersQuery,
} from '@/modules/users/validation';

describe('admin users query contract', () => {
  it('exposes the same statuses and sort fields as the auth module', () => {
    expect([...ADMIN_USER_STATUSES]).toEqual(['active', 'deactivated', 'deleted']);
    expect([...ADMIN_USER_SORT_FIELDS]).toEqual(['name', 'email', 'createdAt', 'updatedAt']);
  });

  it('applies the documented defaults', () => {
    expect(parseAdminUsersQuery({})).toEqual({
      page: 1,
      pageSize: DEFAULT_TABLE_PAGE_SIZE,
      sortBy: 'createdAt',
      sortDirection: 'desc',
      search: '',
      status: null,
      superAdmin: null,
    });
  });

  it('matches the shared contract page-size bounds', () => {
    expect(parseAdminUsersQuery({ pageSize: '100' }).pageSize).toBe(MAX_TABLE_PAGE_SIZE);
    expect(parseAdminUsersQuery({ pageSize: '500' }).pageSize).toBe(DEFAULT_TABLE_PAGE_SIZE);
    expect(parseAdminUsersQuery({ pageSize: '0' }).pageSize).toBe(DEFAULT_TABLE_PAGE_SIZE);
  });

  it('normalizes an invalid page instead of failing', () => {
    expect(parseAdminUsersQuery({ page: '-3' }).page).toBe(1);
    expect(parseAdminUsersQuery({ page: 'abc' }).page).toBe(1);
    expect(parseAdminUsersQuery({ page: '4' }).page).toBe(4);
  });

  it('replaces an unknown sort column with the default', () => {
    expect(parseAdminUsersQuery({ sort: 'password' }).sortBy).toBe('createdAt');
    expect(parseAdminUsersQuery({ sort: 'password' }).sortDirection).toBe('desc');
    expect(parseAdminUsersQuery({ sort: 'name' }).sortBy).toBe('name');
    expect(parseAdminUsersQuery({ sort: '-name' }).sortDirection).toBe('desc');
    expect(parseAdminUsersQuery({ sort: 'name' }).sortDirection).toBe('asc');
  });

  it('uses the first recognized column of a comma separated sort', () => {
    expect(parseAdminUsersQuery({ sort: 'name,email' }).sortBy).toBe('name');
    expect(parseAdminUsersQuery({ sort: 'password,email' }).sortBy).toBe('email');
    expect(parseAdminUsersQuery({ sort: 'password,nope' }).sortBy).toBe('createdAt');
  });

  it('normalizes the status and Super Admin filters', () => {
    expect(parseAdminUsersQuery({ status: 'active' }).status).toBe('active');
    expect(parseAdminUsersQuery({ status: 'bogus' }).status).toBeNull();
    expect(parseAdminUsersQuery({ superAdmin: 'yes' }).superAdmin).toBe(true);
    expect(parseAdminUsersQuery({ superAdmin: 'no' }).superAdmin).toBe(false);
    expect(parseAdminUsersQuery({ superAdmin: 'maybe' }).superAdmin).toBeNull();
  });

  it('trims the search term and discards an unusable one', () => {
    expect(parseAdminUsersQuery({ q: '  lee  ' }).search).toBe('lee');
    expect(parseAdminUsersQuery({ q: 'x'.repeat(500) }).search).toBe('');
  });

  it('ignores unknown query parameters', () => {
    expect(parseAdminUsersQuery({ utm_source: 'newsletter' }).page).toBe(1);
  });

  it('formats a sort token with the descending prefix', () => {
    expect(formatSortToken('name', 'desc')).toBe('-name');
    expect(formatSortToken('name', 'asc')).toBe('name');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/modules/users/admin-users-query.test.ts`
Expected: FAIL — `@/modules/users/validation` cannot be resolved.

- [ ] **Step 3: Implement the validation module**

Create `src/modules/users/validation.ts`:

```ts
/**
 * Admin user-listing input validation.
 *
 * The Zod schema lives here, not in `lib/contracts`, because a module may not
 * import `lib` (`ARCHITECTURE.md` §7) and this schema is the module's own
 * input boundary. The shared URL contract lives in `src/lib/contracts/table.ts`
 * and is kept in step by a unit test.
 *
 * Every field normalizes instead of failing: an admin page is a navigable URL,
 * and a hand-edited or shared link must never produce an error page. The
 * sortable-column allowlist is still enforced, so an unknown column can never
 * reach SQL.
 */

import { z } from 'zod';

import type { UserAccountSortField, UserAccountStatus } from '@/modules/auth';

export const ADMIN_USER_STATUSES = ['active', 'deactivated', 'deleted'] as const satisfies readonly UserAccountStatus[];

export type AdminUserStatus = UserAccountStatus;

export const ADMIN_USER_SORT_FIELDS = [
  'name',
  'email',
  'createdAt',
  'updatedAt',
] as const satisfies readonly UserAccountSortField[];

export type AdminUserSortField = UserAccountSortField;

/** `CONVENTIONS.md` §6.3: page-based paging, default 20 rows, maximum 100. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

const SORT_FIELDS = new Set<string>(ADMIN_USER_SORT_FIELDS);

export type AdminUsersQuery = {
  page: number;
  pageSize: number;
  sortBy: AdminUserSortField;
  sortDirection: 'asc' | 'desc';
  search: string;
  status: AdminUserStatus | null;
  superAdmin: boolean | null;
};

/** Build a sort token from a column and a direction. */
export function formatSortToken(
  sortBy: AdminUserSortField,
  sortDirection: 'asc' | 'desc'
): string {
  return sortDirection === 'desc' ? `-${sortBy}` : sortBy;
}

/**
 * Resolve a sort token to a column and a direction.
 *
 * The token may be a comma separated list (`CONVENTIONS.md` §6.4); the first
 * recognized column wins. An unrecognized column falls back to the default
 * sort rather than reaching the query.
 */
export function parseSortToken(token: string): {
  sortBy: AdminUserSortField;
  sortDirection: 'asc' | 'desc';
} {
  const segments = token.split(',');

  for (const segment of segments) {
    const trimmed = segment.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const descending = trimmed.startsWith('-');
    const column = descending ? trimmed.slice(1) : trimmed;

    if (SORT_FIELDS.has(column)) {
      return {
        sortBy: column as AdminUserSortField,
        sortDirection: descending ? 'desc' : 'asc',
      };
    }
  }

  return { sortBy: 'createdAt', sortDirection: 'desc' };
}

const superAdminFilterSchema = z
  .enum(['yes', 'no'])
  .optional()
  .catch(undefined)
  .transform(value => (value === undefined ? null : value === 'yes'));

export const adminUsersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).catch(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).catch(DEFAULT_PAGE_SIZE),
    sort: z.string().trim().max(32).catch('-createdAt'),
    q: z.string().trim().max(200).catch(''),
    status: z.enum(ADMIN_USER_STATUSES).optional().catch(undefined),
    superAdmin: superAdminFilterSchema,
  })
  .transform(value => ({
    page: value.page,
    pageSize: value.pageSize,
    ...parseSortToken(value.sort),
    search: value.q,
    status: value.status ?? null,
    superAdmin: value.superAdmin,
  }));

/** Parse untrusted query input into a validated admin users query. */
export function parseAdminUsersQuery(input: unknown): AdminUsersQuery {
  return adminUsersQuerySchema.parse(input);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/modules/users/admin-users-query.test.ts`
Expected: PASS, 10 tests.

Run: `npm run typecheck`
Expected: PASS.

---

### Task 4: Users admin read model

**Files:**
- Create: `src/modules/users/read-models/admin-users.ts`
- Create: `src/modules/users/index.ts`
- Test: `tests/unit/modules/users/admin-users-read-model.test.ts` (new)
- Test: `tests/integration/users/admin-user-listing.integration.test.ts` (extend)

**Interfaces:**
- Consumes: `listUserAccounts` from `@/modules/auth`; `requirePermission`, `toPermissionKey`, `type ActorContext` from `@/modules/authorization`; `AdminUsersQuery` from `./validation`.
- Produces (consumed by Task 8, exported from `@/modules/users`):
  - `type AdminUserListItem = { id: string; name: string; email: string; status: AdminUserStatus; isSuperAdmin: boolean; createdAt: string; updatedAt: string }`
  - `type AdminUserListResult = { items: readonly AdminUserListItem[]; page: number; pageSize: number; total: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean }`
  - `listUsersForAdmin(actor: ActorContext, query: AdminUsersQuery): Promise<AdminUserListResult>`
  - `src/modules/users/index.ts` re-exports `listUsersForAdmin`, `parseAdminUsersQuery`, `formatSortToken`, and the types.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/modules/users/admin-users-read-model.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listUserAccountsMock } = vi.hoisted(() => ({ listUserAccountsMock: vi.fn() }));

vi.mock('@/modules/auth', () => ({ listUserAccounts: listUserAccountsMock }));

import type { ActorContext } from '@/modules/authorization';
import { AuthenticationError, AuthorizationError } from '@/platform/errors';

import { listUsersForAdmin } from '@/modules/users/read-models/admin-users';
import type { AdminUsersQuery } from '@/modules/users/validation';

const anonymous: ActorContext = { userId: null, roles: [], isSuperAdmin: false, permissions: [] };
const reader: ActorContext = { userId: 'u1', roles: [], isSuperAdmin: false, permissions: ['user.read'] };
const other: ActorContext = { userId: 'u2', roles: [], isSuperAdmin: false, permissions: ['user.manage'] };

const query: AdminUsersQuery = {
  page: 1,
  pageSize: 20,
  sortBy: 'createdAt',
  sortDirection: 'desc',
  search: '',
  status: null,
  superAdmin: null,
};

beforeEach(() => {
  listUserAccountsMock.mockReset();
});

describe('listUsersForAdmin', () => {
  it('rejects an anonymous actor before querying', async () => {
    await expect(listUsersForAdmin(anonymous, query)).rejects.toBeInstanceOf(AuthenticationError);
    expect(listUserAccountsMock).not.toHaveBeenCalled();
  });

  it('rejects an actor without user.read before querying', async () => {
    await expect(listUsersForAdmin(other, query)).rejects.toBeInstanceOf(AuthorizationError);
    expect(listUserAccountsMock).not.toHaveBeenCalled();
  });

  it('returns projected rows and the page metadata', async () => {
    listUserAccountsMock.mockResolvedValue({
      total: 42,
      rows: [
        {
          id: 'a',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          isActive: true,
          isSuperAdmin: false,
          createdAt: new Date('2026-01-02T03:04:05.000Z'),
          updatedAt: new Date('2026-01-02T03:04:05.000Z'),
          deletedAt: null,
        },
      ],
    });

    const result = await listUsersForAdmin(reader, query);

    expect(result.items).toEqual([
      {
        id: 'a',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        status: 'active',
        isSuperAdmin: false,
        createdAt: '2026-01-02T03:04:05.000Z',
        updatedAt: '2026-01-02T03:04:05.000Z',
      },
    ]);
    expect(result.total).toBe(42);
    expect(result.totalPages).toBe(3);
    expect(result.hasNextPage).toBe(true);
    expect(result.hasPreviousPage).toBe(false);
  });

  it('reports no pages for an empty result', async () => {
    listUserAccountsMock.mockResolvedValue({ total: 0, rows: [] });

    const result = await listUsersForAdmin(reader, query);

    expect(result.totalPages).toBe(0);
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(false);
  });

  it('derives the status with deleted taking precedence over the active flag', async () => {
    listUserAccountsMock.mockResolvedValue({
      total: 1,
      rows: [
        {
          id: 'b',
          name: 'Deleted Person',
          email: 'deleted@example.com',
          isActive: true,
          isSuperAdmin: false,
          createdAt: new Date('2026-01-02T03:04:05.000Z'),
          updatedAt: new Date('2026-01-02T03:04:05.000Z'),
          deletedAt: new Date('2026-01-02T03:04:05.000Z'),
        },
      ],
    });

    const result = await listUsersForAdmin(reader, query);

    expect(result.items[0]?.status).toBe('deleted');
  });

  it('passes the validated query to the identity query', async () => {
    listUserAccountsMock.mockResolvedValue({ total: 0, rows: [] });

    await listUsersForAdmin(reader, { ...query, search: 'lee', status: 'active', superAdmin: true });

    expect(listUserAccountsMock).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortDirection: 'desc',
      search: 'lee',
      status: 'active',
      isSuperAdmin: true,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/modules/users/admin-users-read-model.test.ts`
Expected: FAIL — `@/modules/users/read-models/admin-users` does not exist.

- [ ] **Step 3: Implement the read model**

Create `src/modules/users/read-models/admin-users.ts`:

```ts
/**
 * Admin user listing read model (owned by `users`).
 *
 * This is the approved cross-module read model for the admin user listing
 * over the `auth` identity table (`ARCHITECTURE.md` §8.4, D-011). It reads no
 * other module's table directly: the identity rows come from the auth
 * module's public API.
 *
 * Authorization is enforced here, not only at the entrypoint, so the listing
 * cannot be reached without the canonical `user.read` permission.
 */

import { requirePermission, toPermissionKey, type ActorContext } from '@/modules/authorization';
import { listUserAccounts } from '@/modules/auth';

import type { AdminUserStatus, AdminUsersQuery } from '../validation';

export type AdminUserListItem = {
  id: string;
  name: string;
  email: string;
  status: AdminUserStatus;
  isSuperAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserListResult = {
  items: readonly AdminUserListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

/** Deleted wins over the active flag, so a trashed account is never "active". */
function resolveStatus(isActive: boolean, deletedAt: Date | null): AdminUserStatus {
  if (deletedAt !== null) {
    return 'deleted';
  }

  return isActive ? 'active' : 'deactivated';
}

/**
 * Read one page of user accounts for the administration area.
 *
 * Throws `AuthenticationError` for an anonymous actor and `AuthorizationError`
 * for an actor without `user.read`, before any query runs.
 */
export async function listUsersForAdmin(
  actor: ActorContext,
  query: AdminUsersQuery
): Promise<AdminUserListResult> {
  requirePermission(actor, toPermissionKey('user', 'read'));

  const result = await listUserAccounts({
    page: query.page,
    pageSize: query.pageSize,
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    search: query.search.length > 0 ? query.search : null,
    status: query.status,
    isSuperAdmin: query.superAdmin,
  });

  const totalPages = result.total === 0 ? 0 : Math.ceil(result.total / query.pageSize);

  return {
    items: result.rows.map(row => ({
      id: row.id,
      name: row.name,
      email: row.email,
      status: resolveStatus(row.isActive, row.deletedAt),
      isSuperAdmin: row.isSuperAdmin,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    page: query.page,
    pageSize: query.pageSize,
    total: result.total,
    totalPages,
    hasNextPage: query.page < totalPages,
    hasPreviousPage: query.page > 1 && totalPages > 0,
  };
}
```

Create `src/modules/users/index.ts`:

```ts
/**
 * Users module public API (server-only).
 *
 * The single public surface for the users domain. Keep it narrow: callers get
 * the admin user listing they are allowed to use, not the module's schema or
 * inner helpers.
 */

import 'server-only';

export { listUsersForAdmin } from './read-models/admin-users';
export type { AdminUserListItem, AdminUserListResult } from './read-models/admin-users';
export {
  ADMIN_USER_SORT_FIELDS,
  ADMIN_USER_STATUSES,
  formatSortToken,
  parseAdminUsersQuery,
} from './validation';
export type { AdminUserSortField, AdminUserStatus, AdminUsersQuery } from './validation';
```

- [ ] **Step 4: Extend the integration test with the service-level guard**

Append to `tests/integration/users/admin-user-listing.integration.test.ts`:

```ts
describe('listUsersForAdmin (real database)', () => {
  it('rejects an anonymous actor', async () => {
    await expect(
      listUsersForAdmin(
        { userId: null, roles: [], isSuperAdmin: false, permissions: [] },
        { page: 1, pageSize: 20, sortBy: 'createdAt', sortDirection: 'desc', search: '', status: null, superAdmin: null }
      )
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects an actor without user.read', async () => {
    await expect(
      listUsersForAdmin(
        { userId: 'u1', roles: [], isSuperAdmin: false, permissions: ['user.manage'] },
        { page: 1, pageSize: 20, sortBy: 'createdAt', sortDirection: 'desc', search: '', status: null, superAdmin: null }
      )
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('lists accounts for an actor with user.read', async () => {
    const id = await insertUser({ name: 'Listed Person', email: `${TEST_EMAIL_PREFIX}listed@example.com` });

    const result = await listUsersForAdmin(
      { userId: 'u2', roles: [], isSuperAdmin: false, permissions: ['user.read'] },
      { page: 1, pageSize: 100, sortBy: 'createdAt', sortDirection: 'desc', search: 'Listed Person', status: null, superAdmin: null }
    );

    expect(result.items.map(item => item.id)).toContain(id);
    expect(result.items[0]?.status).toBe('active');
  });
});
```

Add the imports it needs: `listUsersForAdmin` from `@/modules/users`, `AuthenticationError` and `AuthorizationError` from `@/platform/errors`, and `type ActorContext` is not needed because the actor objects are inline.

Also add this case to the `listUserAccounts` describe block. It pins the **value**
of `total`, not just that it matches across pages: the total is the number of
matching accounts, while the rows are one page of them.

```ts
it('reports the total number of matching accounts, not the page size', async () => {
  await insertUser({ name: 'Counted One', email: `${TEST_EMAIL_PREFIX}counted-1@example.com` });
  await insertUser({ name: 'Counted Two', email: `${TEST_EMAIL_PREFIX}counted-2@example.com` });
  await insertUser({ name: 'Counted Three', email: `${TEST_EMAIL_PREFIX}counted-3@example.com` });

  const page = await listUserAccounts({
    page: 2,
    pageSize: 2,
    sortBy: 'name',
    sortDirection: 'asc',
    search: 'Counted',
    status: null,
    isSuperAdmin: null,
  });

  expect(page.rows).toHaveLength(1);
  expect(page.total).toBe(3);
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/modules/users/admin-users-read-model.test.ts`
Expected: PASS, 6 tests.

Run: `npm run test:integration -- tests/integration/users/admin-user-listing.integration.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

---

### Task 5: Supporting index for the admin user listing

**Files:**
- Modify: `src/modules/auth/schema.ts`
- Create: `drizzle/0003_*.sql` and `drizzle/meta/0003_snapshot.json` (generated)

**Interfaces:**
- Consumes: the `users` table definition in `src/modules/auth/schema.ts`.
- Produces: the index `idx_users_active_created_at` on `users (created_at DESC) WHERE deleted_at IS NULL`.

- [ ] **Step 1: Add the index to the Drizzle schema**

The index is **partial and descending**, so the shared `indexOn` helper cannot express it — that helper creates a plain ascending btree index. Use Drizzle's `index()` builder directly, matching the house style of the partial indexes in `src/modules/content/schema.ts`:

In `src/modules/auth/schema.ts`, change the `users` table's constraint list. The table currently ends with `uniqueConstraint('users', table.email)`; change it to:

```ts
  table => [
    uniqueConstraint('users', table.email),
    index('idx_users_active_created_at')
      .on(table.createdAt.desc())
      .where(sql`${table.deletedAt} is null`),
  ]
```

Add `index` to the existing `drizzle-orm/pg-core` import, and add
`import { sql } from 'drizzle-orm';`. `indexOn` stays imported — the
`accounts`, `sessions`, `verifications`, and `loginAttempts` tables still use it.

Note the property names: the `users` table follows Better Auth's camelCase
property names over snake_case columns, so the column is `table.createdAt` and
the predicate is `${table.deletedAt}`.

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0003_*.sql` and a matching snapshot, containing
exactly one statement:

```sql
CREATE INDEX "idx_users_active_created_at" ON "users" USING btree ("created_at" DESC NULLS LAST) WHERE "users"."deleted_at" is null;
```

Read the generated SQL. If it contains anything other than that one
`CREATE INDEX` statement, stop and report it — the schema and the applied
migrations must already be in sync.

- [ ] **Step 3: Apply the migration to the isolated test database**

Run: `npm run test:integration -- tests/integration/users/admin-user-listing.integration.test.ts`
Expected: PASS. The integration global setup applies the ordered migrations to
`dramascan_test` with `DATABASE_URL` pointed at the test database, so the new
index is created there.

Then confirm the index exists **in the test database only**. Use the `pg`
client with `TEST_DATABASE_URL` from `.env.local` — the
`tests/e2e/support/load-local-env.mjs` helper loads `.env.local` into
`process.env`, so a short Node script can do it. Query `pg_indexes` for
`indexname = 'idx_users_active_created_at'` and print its `indexdef`.

Expected: one row, whose `indexdef` is
`CREATE INDEX idx_users_active_created_at ON public.users USING btree (created_at DESC NULLS LAST) WHERE (users.deleted_at IS NULL)`.

**Never run `db:push`.** And never run a bare `npx drizzle-kit migrate` in this
task: that reads `DATABASE_URL`, which points at the `dramascan` development
database, and this task must leave it untouched. The `dramascan` database
receives the migration only when the owner deploys it.

- [ ] **Step 4: Record the measured query plans**

Against the migrated `dramascan_test` database, run `EXPLAIN (ANALYZE, BUFFERS)`
for the default listing query and for each status filter. The default listing
query is:

```sql
SELECT id, name, email, is_active, is_super_admin, created_at, updated_at, deleted_at
FROM users
WHERE deleted_at IS NULL
ORDER BY created_at DESC, id ASC
LIMIT 20 OFFSET 0;
```

The `active` filter adds `AND is_active = true`; the `deactivated` filter adds
`AND is_active = false`; the `deleted` filter replaces the predicate with
`deleted_at IS NOT NULL`.

Note that `EXPLAIN` reports a **plan**, not rows: on a small test table
PostgreSQL will prefer a sequential scan, because the table does not yet
justify an index scan. That is an expected result, not a defect. What the plan
does show is which access path the planner *would* take and at what cost, so
report the plan, the estimated rows, and the planner's chosen path for each of
the four queries, and state plainly whether the partial index is used.

Record for each: the chosen plan, and explicitly that the `deleted` filter is
**not** served by the partial index (its predicate is `deleted_at IS NOT NULL`,
the complement of the index's). Put the four plans and that statement in your
report file — Task 11 writes them into `docs/development/DATABASE.md`.

- [ ] **Step 5: Run the full database-backed suites**

Run: `npm run test:integration`
Expected: PASS, with the new index present.

---

### Task 6: Admin table kit — types, table, skeleton, error

**Files:**
- Modify: `src/components/ui/table.tsx` (remove `'use client'`)
- Create: `src/components/admin/data-table/types.ts`
- Create: `src/components/admin/data-table/data-table.tsx`
- Create: `src/components/admin/data-table/data-table-skeleton.tsx`
- Create: `src/components/admin/data-table/data-table-error.tsx`
- Test: `tests/unit/components/admin-data-table.test.tsx` (new)

**Interfaces:**
- Consumes: `TableQueryState`, `buildTableHref` from `@/lib/contracts/table`; `Skeleton`, `SkeletonGroup` from `@/components/states/skeleton`; `EmptyState` from `@/components/states/empty-state`; `RetryState` from `@/components/states/retry-state`.
- Produces (consumed by Tasks 7–8):
  - `AdminTableColumnVisibility = 'always' | 'sm' | 'md' | 'lg'`
  - `AdminTableColumn<T>` = `{ key, header, sortKey?, align?, visibility?, headerClassName?, cellClassName?, render }`
  - `AdminTableFilterOption` = `{ value, label }`, `AdminTableFilterField` = `{ name, label, options, value }`
  - `AdminDataTable<T>` props: `{ caption, captionClassName?, columns, rows, rowKey, pathname, state, empty?, emptyIcon?, className? }`
  - `AdminTableSkeleton` props: `{ columns: number, label?: string, className?: string }`
  - `AdminTableError` props: `{ label: string, description?: string, children?: ReactNode, className?: string }`

- [ ] **Step 1: Make the vendored table primitive server-safe**

In `src/components/ui/table.tsx`, delete line 1 (`'use client';`) and the blank line after it. The file has no state, hooks, or event handlers, so it renders unchanged inside a Server Component. `button.tsx`, `input.tsx`, and `card.tsx` are already server-safe and are the precedent.

- [ ] **Step 2: Write the failing component test**

Create `tests/unit/components/admin-data-table.test.tsx`. Follow the jsdom opt-in pattern used by the existing component tests (`tests/unit/components/empty-state.test.tsx`): a `// @vitest-environment jsdom` docblock, `afterEach(cleanup)`, and **plain Vitest matchers** — this project does not install `@testing-library/jest-dom`, so `toBeInTheDocument` and `toHaveAttribute` are not available.

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { AdminDataTable } from '@/components/admin/data-table/data-table';
import { AdminTableSkeleton } from '@/components/admin/data-table/data-table-skeleton';
import { AdminTableError } from '@/components/admin/data-table/data-table-error';
import type { AdminTableColumn } from '@/components/admin/data-table/types';
import type { TableQueryState } from '@/lib/contracts/table';

afterEach(cleanup);

type Row = { id: string; name: string; email: string; active: boolean };

const state: TableQueryState = {
  page: 1,
  pageSize: 20,
  sort: '-createdAt',
  search: '',
  filters: {},
};

const columns: readonly AdminTableColumn<Row>[] = [
  { key: 'name', header: 'Name', sortKey: 'name', render: row => row.name },
  { key: 'email', header: 'Email', sortKey: 'email', visibility: 'sm', render: row => row.email },
  { key: 'status', header: 'Status', render: row => (row.active ? 'Active' : 'Deactivated') },
];

const rows: readonly Row[] = [
  { id: '1', name: 'Ada Lovelace', email: 'ada@example.com', active: true },
];

describe('AdminDataTable', () => {
  it('renders a caption, the headers, and one row', () => {
    render(<AdminDataTable caption="Users" columns={columns} rows={rows} rowKey={row => row.id} pathname="/admin/users" state={state} />);

    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('Users')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /Name/ })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Ada Lovelace' })).toBeTruthy();
  });

  it('marks the sorted column with aria-sort and the others with none', () => {
    render(<AdminDataTable caption="Users" columns={columns} rows={rows} rowKey={row => row.id} pathname="/admin/users" state={{ ...state, sort: 'name' }} />);

    expect(screen.getByRole('columnheader', { name: /Name/ }).getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByRole('columnheader', { name: /Email/ }).getAttribute('aria-sort')).toBe('none');
  });

  it('links a sortable header to the same table with the flipped sort', () => {
    render(<AdminDataTable caption="Users" columns={columns} rows={rows} rowKey={row => row.id} pathname="/admin/users" state={{ ...state, sort: 'name' }} />);

    const link = within(screen.getByRole('columnheader', { name: /Name/ })).getByRole('link');
    expect(link.getAttribute('href')).toBe('/admin/users?pageSize=20&sort=-name');
  });

  it('links a new column to a descending sort and resets the page', () => {
    render(<AdminDataTable caption="Users" columns={columns} rows={rows} rowKey={row => row.id} pathname="/admin/users" state={{ ...state, page: 4, sort: '-createdAt' }} />);

    const link = within(screen.getByRole('columnheader', { name: /Email/ })).getByRole('link');
    expect(link.getAttribute('href')).toBe('/admin/users?pageSize=20&sort=-email');
  });

  it('keeps the active filters in a sort link', () => {
    render(<AdminDataTable caption="Users" columns={columns} rows={rows} rowKey={row => row.id} pathname="/admin/users" state={{ ...state, filters: { status: 'active' } }} />);

    const link = within(screen.getByRole('columnheader', { name: /Name/ })).getByRole('link');
    expect(link.getAttribute('href')).toContain('status=active');
  });

  it('hides a secondary column below its breakpoint', () => {
    render(<AdminDataTable caption="Users" columns={columns} rows={rows} rowKey={row => row.id} pathname="/admin/users" state={state} />);

    const header = screen.getByRole('columnheader', { name: /Email/ });
    expect(header.className).toContain('hidden');
    expect(header.className).toContain('sm:table-cell');
  });

  it('renders the empty state instead of a row when there are no rows', () => {
    render(<AdminDataTable caption="Users" columns={columns} rows={[]} rowKey={row => row.id} pathname="/admin/users" state={state} empty={<p>No accounts yet</p>} />);

    expect(screen.getByText('No accounts yet')).toBeTruthy();
    expect(screen.queryAllByRole('row')).toHaveLength(0);
  });
});

describe('AdminTableSkeleton', () => {
  it('announces loading exactly once', () => {
    render(<AdminTableSkeleton columns={3} label="Loading users" />);

    const status = screen.getAllByRole('status');
    expect(status).toHaveLength(1);
    expect(status[0]?.textContent).toContain('Loading users');
  });
});

describe('AdminTableError', () => {
  it('renders an alert with the label', () => {
    render(<AdminTableError label="users" description="Try again." />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Could not load users')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/components/admin-data-table.test.tsx`
Expected: FAIL — `@/components/admin/data-table/data-table` cannot be resolved.

- [ ] **Step 4: Implement the kit types**

Create `src/components/admin/data-table/types.ts`:

```ts
import type { ReactNode } from 'react';

/**
 * Responsive priority of a table column.
 *
 * `always` keeps the column at every width. The other values hide the column
 * below the matching Tailwind breakpoint, so a narrow screen shows fewer
 * columns instead of a table that is too wide to use.
 */
export type AdminTableColumnVisibility = 'always' | 'sm' | 'md' | 'lg';

export type AdminTableColumn<T> = Readonly<{
  key: string;
  header: string;
  /** Set to make the column sortable. The value is the sort column name. */
  sortKey?: string;
  align?: 'left' | 'center' | 'right';
  /** Responsive priority. Defaults to `always`. */
  visibility?: AdminTableColumnVisibility;
  headerClassName?: string;
  cellClassName?: string;
  render: (row: T) => ReactNode;
}>;

export type AdminTableFilterOption = Readonly<{
  value: string;
  label: string;
}>;

export type AdminTableFilterField = Readonly<{
  /** Query parameter name. */
  name: string;
  label: string;
  options: readonly AdminTableFilterOption[];
  /** The active value; an empty string means "no filter". */
  value: string;
}>;
```

- [ ] **Step 5: Implement the table**

Create `src/components/admin/data-table/data-table.tsx`:

```tsx
import type { JSX, ReactNode } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

import { EmptyState } from '@/components/states/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { buildTableHref, type TableQueryState } from '@/lib/contracts/table';
import { cn } from '@/lib/utils';

import type { AdminTableColumn, AdminTableColumnVisibility } from './types';

const VISIBILITY_CLASSES: Record<AdminTableColumnVisibility, string> = {
  always: '',
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
};

const ALIGNMENT_CLASSES = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const;

/**
 * The sort token a column link should point at.
 *
 * Clicking the column that is already sorted flips its direction; clicking a
 * different column sorts it descending first, which matches the table's
 * default order.
 */
export function nextSortToken(currentSort: string, columnSortKey: string): string {
  const descending = currentSort.startsWith('-');
  const currentColumn = descending ? currentSort.slice(1) : currentSort;

  if (currentColumn === columnSortKey) {
    return descending ? columnSortKey : `-${columnSortKey}`;
  }

  return `-${columnSortKey}`;
}

export type AdminDataTableProps<T> = Readonly<{
  caption: string;
  captionClassName?: string;
  columns: readonly AdminTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  pathname: string;
  state: TableQueryState;
  empty?: ReactNode;
  emptyIcon?: LucideIcon;
  className?: string;
}>;

export function AdminDataTable<T>({
  caption,
  captionClassName,
  columns,
  rows,
  rowKey,
  pathname,
  state,
  empty,
  emptyIcon = Inbox,
  className,
}: AdminDataTableProps<T>): JSX.Element {
  if (rows.length === 0) {
    return (
      <div className={className}>
        {empty ?? <EmptyState icon={emptyIcon} title="Nothing to show" />}
      </div>
    );
  }

  return (
    <Table className={className}>
      <caption className={cn('text-left text-sm text-muted-foreground', captionClassName)}>
        {caption}
      </caption>
      <TableHeader>
        <TableRow>
          {columns.map(column => (
            <SortableHead key={column.key} column={column} pathname={pathname} state={state} />
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(row => (
          <TableRow key={rowKey(row)}>
            {columns.map(column => (
              <TableCell
                key={column.key}
                className={cn(
                  VISIBILITY_CLASSES[column.visibility ?? 'always'],
                  ALIGNMENT_CLASSES[column.align ?? 'left'],
                  column.cellClassName
                )}
              >
                {column.render(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

Import the primitive parts as
`import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';`
— the vendored primitive does export a `TableCaption`, but its class list is
fixed, so the kit writes the `<caption>` element itself in order to support the
caller's `captionClassName`. Place it as the first child of `<Table>`.

Add the sortable header helper in the same file:

```tsx
type SortableHeadProps<T> = Readonly<{
  column: AdminTableColumn<T>;
  pathname: string;
  state: TableQueryState;
}>;

function SortableHead<T>({ column, pathname, state }: SortableHeadProps<T>): JSX.Element {
  const visibilityClass = VISIBILITY_CLASSES[column.visibility ?? 'always'];

  if (column.sortKey === undefined) {
    return (
      <TableHead scope="col" className={cn(visibilityClass, ALIGNMENT_CLASSES[column.align ?? 'left'], column.headerClassName)}>
        {column.header}
      </TableHead>
    );
  }

  const descending = state.sort.startsWith('-');
  const sorted = (descending ? state.sort.slice(1) : state.sort) === column.sortKey;
  const ariaSort = sorted ? (descending ? 'descending' : 'ascending') : 'none';
  const order = descending ? 'descending' : 'ascending';
  const label = sorted
    ? `Sort by ${column.header}, currently ${order}`
    : `Sort by ${column.header}, currently unsorted`;

  return (
    <TableHead scope="col" aria-sort={ariaSort} className={cn(visibilityClass, ALIGNMENT_CLASSES[column.align ?? 'left'], column.headerClassName)}>
      <Link
        href={buildTableHref(pathname, state, { sort: nextSortToken(state.sort, column.sortKey), page: 1 })}
        className="inline-flex items-center gap-1 hover:text-foreground"
        aria-label={label}
      >
        {column.header}
        <span aria-hidden="true">{sorted ? (descending ? '↓' : '↑') : '↕'}</span>
      </Link>
    </TableHead>
  );
}
```

- [ ] **Step 6: Implement the skeleton and the error state**

Create `src/components/admin/data-table/data-table-skeleton.tsx`:

```tsx
import type { JSX } from 'react';

import { Skeleton, SkeletonGroup } from '@/components/states/skeleton';

export type AdminTableSkeletonProps = Readonly<{
  columns: number;
  label?: string;
  className?: string;
}>;

/**
 * Loading placeholder for a data table. The bones are decorative; the group
 * owns the single loading announcement.
 */
export function AdminTableSkeleton({
  columns,
  label = 'Loading table',
  className,
}: AdminTableSkeletonProps): JSX.Element {
  return (
    <SkeletonGroup label={label} className={className}>
      <div className="space-y-2">
        {Array.from({ length: columns }, (_, index) => (
          <div key={index} className="flex gap-3">
            {Array.from({ length: 5 }, (__, cellIndex) => (
              <Skeleton key={cellIndex} className="h-8 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}
```

Create `src/components/admin/data-table/data-table-error.tsx`:

```tsx
import type { JSX, ReactNode } from 'react';

import { RetryState } from '@/components/states/retry-state';

export type AdminTableErrorProps = Readonly<{
  label: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}>;

/**
 * Failure block for a data table. The caller supplies the retry action.
 */
export function AdminTableError({
  label,
  description,
  children,
  className,
}: AdminTableErrorProps): JSX.Element {
  return (
    <RetryState
      title={`Could not load ${label}`}
      description={description}
      className={className}
    >
      {children}
    </RetryState>
  );
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/unit/components/admin-data-table.test.tsx`
Expected: PASS, 9 tests.

Run: `npm run typecheck`
Expected: PASS.

---

### Task 7: Toolbar and pagination bar

**Files:**
- Create: `src/components/admin/data-table/data-table-toolbar.tsx`
- Create: `src/components/admin/data-table/data-table-pagination.tsx`
- Test: `tests/unit/components/admin-data-table-toolbar.test.tsx` (new)
- Test: `tests/unit/components/admin-data-table-pagination.test.tsx` (new)

**Interfaces:**
- Consumes: `buildTableHref`, `type TableQueryState` from `@/lib/contracts/table`; `AdminTableFilterField` from `./types`; `Input` from `@/components/ui/input`.
- Produces:
  - `AdminTableToolbar` props: `{ pathname, state, searchLabel, searchPlaceholder?, filters?, clearHref?, className? }`
  - `AdminTablePagination` props: `{ pathname, state, total, totalPages, itemLabel, pageSizeOptions?, className? }`

- [ ] **Step 1: Write the failing toolbar test**

Create `tests/unit/components/admin-data-table-toolbar.test.tsx` (jsdom docblock, `afterEach(cleanup)`, plain Vitest matchers):

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { AdminTableToolbar } from '@/components/admin/data-table/data-table-toolbar';
import type { TableQueryState } from '@/lib/contracts/table';

afterEach(cleanup);

const state: TableQueryState = {
  page: 3,
  pageSize: 20,
  sort: '-createdAt',
  search: 'lee',
  filters: { status: 'active', superAdmin: '' },
};

const filters = [
  {
    name: 'status',
    label: 'Status',
    value: 'active',
    options: [
      { value: '', label: 'All statuses' },
      { value: 'active', label: 'Active' },
      { value: 'deactivated', label: 'Deactivated' },
      { value: 'deleted', label: 'Deleted' },
    ],
  },
];

describe('AdminTableToolbar', () => {
  it('renders a GET search form that keeps the sort, page size, and active filters', () => {
    render(<AdminTableToolbar pathname="/admin/users" state={state} searchLabel="Search users" filters={filters} />);

    const form = screen.getByRole('search').closest('form');
    expect(form?.getAttribute('method')).toBe('get');
    expect(form?.getAttribute('action')).toBe('/admin/users');

    const hidden = form?.querySelectorAll('input[type="hidden"]') ?? [];
    const values = Array.from(hidden).map(input => `${input.getAttribute('name')}=${input.getAttribute('value')}`);

    expect(values).toContain('sort=-createdAt');
    expect(values).toContain('pageSize=20');
    expect(values).toContain('status=active');
    expect(values).not.toContain('page=3');
  });

  it('prefills the search term', () => {
    render(<AdminTableToolbar pathname="/admin/users" state={state} searchLabel="Search users" filters={filters} />);

    expect(screen.getByLabelText('Search users').getAttribute('value')).toBe('lee');
  });

  it('renders a filter select per field and keeps the search term', () => {
    render(<AdminTableToolbar pathname="/admin/users" state={state} searchLabel="Search users" filters={filters} />);

    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    expect(select.getAttribute('name')).toBe('status');
    expect(select.value).toBe('active');

    const form = select.closest('form');
    const hidden = form?.querySelectorAll('input[type="hidden"]') ?? [];
    const values = Array.from(hidden).map(input => `${input.getAttribute('name')}=${input.getAttribute('value')}`);

    expect(values).toContain('q=lee');
    expect(values).toContain('sort=-createdAt');
    expect(values).not.toContain('page=3');
  });

  it('renders a clear link that drops the search term and every filter', () => {
    render(
      <AdminTableToolbar
        pathname="/admin/users"
        state={state}
        searchLabel="Search users"
        filters={filters}
        clearHref="/admin/users?pageSize=20&sort=-createdAt"
      />
    );

    const link = screen.getByRole('link', { name: /clear/i });
    expect(link.getAttribute('href')).toBe('/admin/users?pageSize=20&sort=-createdAt');
  });

  it('renders no clear link when nothing is filtered', () => {
    render(
      <AdminTableToolbar
        pathname="/admin/users"
        state={{ ...state, search: '', filters: {} }}
        searchLabel="Search users"
        filters={filters}
      />
    );

    expect(screen.queryByRole('link', { name: /clear/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the toolbar test to verify it fails**

Run: `npx vitest run tests/unit/components/admin-data-table-toolbar.test.tsx`
Expected: FAIL — `@/components/admin/data-table/data-table-toolbar` cannot be resolved.

- [ ] **Step 3: Implement the toolbar**

Create `src/components/admin/data-table/data-table-toolbar.tsx`:

```tsx
import type { JSX } from 'react';
import Link from 'next/link';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { AdminTableFilterField } from './types';
import type { TableQueryState } from '@/lib/contracts/table';

/** Hidden inputs that carry the state a form must preserve. */
function StateInputs({
  state,
  includeSearch,
  includeFilters,
}: Readonly<{
  state: TableQueryState;
  includeSearch: boolean;
  includeFilters: boolean;
}>): JSX.Element {
  return (
    <>
      <input type="hidden" name="sort" value={state.sort} />
      <input type="hidden" name="pageSize" value={String(state.pageSize)} />
      {includeSearch && state.search.length > 0 ? (
        <input type="hidden" name="q" value={state.search} />
      ) : null}
      {includeFilters
        ? Object.entries(state.filters).map(([name, value]) =>
            value.length > 0 ? <input key={name} type="hidden" name={name} value={value} /> : null
          )
        : null}
    </>
  );
}

export type AdminTableToolbarProps = Readonly<{
  pathname: string;
  state: TableQueryState;
  searchLabel: string;
  searchPlaceholder?: string;
  filters?: readonly AdminTableFilterField[];
  clearHref?: string;
  className?: string;
}>;

/**
 * Search and filter controls for a data table.
 *
 * Both controls are GET forms, so the whole table state stays in the URL. The
 * forms never carry a `page` input, so a new search or filter always returns
 * to the first page.
 */
export function AdminTableToolbar({
  pathname,
  state,
  searchLabel,
  searchPlaceholder,
  filters = [],
  clearHref,
  className,
}: AdminTableToolbarProps): JSX.Element {
  const hasActiveFilter = Object.values(state.filters).some(value => value.length > 0);

  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <form method="get" action={pathname} role="search" className="flex flex-1 items-end gap-2">
        <StateInputs state={state} includeSearch={false} includeFilters />
        <div className="flex-1">
          <label htmlFor="table-search" className="mb-1 block text-xs font-medium text-muted-foreground">
            {searchLabel}
          </label>
          <Input id="table-search" name="q" type="search" defaultValue={state.search} placeholder={searchPlaceholder} />
        </div>
        <button type="submit" className="h-8 rounded-lg border border-border px-3 text-sm text-foreground">
          Search
        </button>
      </form>

      {filters.length > 0 ? (
        <form method="get" action={pathname} className="flex flex-wrap items-end gap-2">
          <StateInputs state={state} includeSearch includeFilters={false} />
          {filters.map(field => (
            <div key={field.name}>
              <label htmlFor={`table-filter-${field.name}`} className="mb-1 block text-xs font-medium text-muted-foreground">
                {field.label}
              </label>
              <select
                id={`table-filter-${field.name}`}
                name={field.name}
                defaultValue={field.value}
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground"
              >
                {field.options.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <button type="submit" className="h-8 rounded-lg border border-border px-3 text-sm text-foreground">
            Apply
          </button>
        </form>
      ) : null}

      {clearHref && (state.search.length > 0 || hasActiveFilter) ? (
        <Link href={clearHref} className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Clear filters
        </Link>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run the toolbar test to verify it passes**

Run: `npx vitest run tests/unit/components/admin-data-table-toolbar.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Extend the Task 6 component test with two sort-link cases**

Add two cases to `tests/unit/components/admin-data-table.test.tsx` (Task 6's
file). They pin the two halves of the sort behaviour that the requirement
"preserve valid active filters **and search terms** when changing pages or
sorting" depends on:

```tsx
it('keeps the search term in a sort link', () => {
  render(
    <AdminDataTable
      caption="Users"
      columns={columns}
      rows={rows}
      rowKey={row => row.id}
      pathname="/admin/users"
      state={{ ...state, search: 'lee' }}
    />
  );

  const link = within(screen.getByRole('columnheader', { name: /Name/ })).getByRole('link');
  expect(link.getAttribute('href')).toContain('q=lee');
});

it('flips a descending sort to ascending when the sorted column is clicked again', () => {
  render(
    <AdminDataTable
      caption="Users"
      columns={columns}
      rows={rows}
      rowKey={row => row.id}
      pathname="/admin/users"
      state={{ ...state, sort: '-name' }}
    />
  );

  const link = within(screen.getByRole('columnheader', { name: /Name/ })).getByRole('link');
  expect(link.getAttribute('href')).toBe('/admin/users?pageSize=20&sort=name');
});
```

Both are expected to pass against the Task 6 implementation — they are added
here so the file that owns the table's sort behaviour pins the whole contract.

- [ ] **Step 6: Write the failing pagination test**

Create `tests/unit/components/admin-data-table-pagination.test.tsx` (jsdom docblock, `afterEach(cleanup)`, plain Vitest matchers):
```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { AdminTablePagination } from '@/components/admin/data-table/data-table-pagination';
import type { TableQueryState } from '@/lib/contracts/table';

afterEach(cleanup);

const state: TableQueryState = {
  page: 3,
  pageSize: 20,
  sort: '-createdAt',
  search: 'lee',
  filters: { status: 'active' },
};

describe('AdminTablePagination', () => {
  it('summarises the visible range and the total', () => {
    render(<AdminTablePagination pathname="/admin/users" state={state} total={137} totalPages={7} itemLabel="users" />);

    expect(screen.getByText(/Showing 41–60 of 137 users/).textContent).toBe('Showing 41–60 of 137 users');
  });

  it('reports an empty result', () => {
    render(<AdminTablePagination pathname="/admin/users" state={{ ...state, page: 1 }} total={0} totalPages={0} itemLabel="users" />);

    expect(screen.getByText('No users')).toBeTruthy();
  });

  it('keeps the sort, the search term, and the filters in the page links', () => {
    render(<AdminTablePagination pathname="/admin/users" state={state} total={137} totalPages={7} itemLabel="users" />);

    const href = screen.getByRole('link', { name: 'Next' }).getAttribute('href') ?? '';

    expect(href).toContain('page=4');
    expect(href).toContain('sort=-createdAt');
    expect(href).toContain('q=lee');
    expect(href).toContain('status=active');
  });

  it('renders a disabled previous control on the first page', () => {
    render(<AdminTablePagination pathname="/admin/users" state={{ ...state, page: 1 }} total={137} totalPages={7} itemLabel="users" />);

    expect(screen.queryByRole('link', { name: 'Previous' })).toBeNull();
    expect(screen.getByText('Previous')).toBeTruthy();
  });

  it('renders a disabled next control on the last page', () => {
    render(<AdminTablePagination pathname="/admin/users" state={{ ...state, page: 7 }} total={137} totalPages={7} itemLabel="users" />);

    expect(screen.queryByRole('link', { name: 'Next' })).toBeNull();
    expect(screen.getByText('Next')).toBeTruthy();
  });

  it('renders a page-size form that keeps the rest of the state', () => {
    render(<AdminTablePagination pathname="/admin/users" state={state} total={137} totalPages={7} itemLabel="users" />);

    const select = screen.getByLabelText('Rows per page') as HTMLSelectElement;
    expect(select.getAttribute('name')).toBe('pageSize');
    expect(select.value).toBe('20');

    const form = select.closest('form');
    const hidden = form?.querySelectorAll('input[type="hidden"]') ?? [];
    const values = Array.from(hidden).map(input => `${input.getAttribute('name')}=${input.getAttribute('value')}`);

    expect(values).toContain('sort=-createdAt');
    expect(values).toContain('q=lee');
    expect(values).toContain('status=active');
    expect(values).not.toContain('page=3');
  });
});
```

- [ ] **Step 7: Run the pagination test to verify it fails**

Run: `npx vitest run tests/unit/components/admin-data-table-pagination.test.tsx`
Expected: FAIL — `@/components/admin/data-table/data-table-pagination` cannot be resolved.

- [ ] **Step 8: Implement the pagination bar**

Create `src/components/admin/data-table/data-table-pagination.tsx`:

```tsx
import type { JSX } from 'react';
import Link from 'next/link';

import { buildTableHref, type TableQueryState } from '@/lib/contracts/table';
import { cn } from '@/lib/utils';

const DEFAULT_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

/** The page numbers to show around the current page. */
export function buildPageWindow(currentPage: number, totalPages: number): readonly (number | 'gap')[] {
  if (totalPages <= 1) {
    return [];
  }

  const pages = new Set<number>([1, totalPages, currentPage]);
  const window = 1;

  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = currentPage + offset;

    if (candidate >= 1 && candidate <= totalPages) {
      pages.add(candidate);
    }
  }

  const sorted = [...pages].sort((left, right) => left - right);
  const result: (number | 'gap')[] = [];

  sorted.forEach((page, index) => {
    const previous = sorted[index - 1];

    if (previous !== undefined && page - previous > 1) {
      result.push('gap');
    }

    result.push(page);
  });

  return result;
}

export type AdminTablePaginationProps = Readonly<{
  pathname: string;
  state: TableQueryState;
  total: number;
  totalPages: number;
  itemLabel: string;
  pageSizeOptions?: readonly number[];
  className?: string;
}>;

/**
 * Pagination controls for a data table.
 *
 * The page number lives in the URL, so every control is a link or a GET form
 * that keeps the sort, the search term, and the active filters.
 */
export function AdminTablePagination({
  pathname,
  state,
  total,
  totalPages,
  itemLabel,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  className,
}: AdminTablePaginationProps): JSX.Element {
  const firstRow = total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const lastRow = total === 0 ? 0 : Math.min(state.page * state.pageSize, total);
  const window = buildPageWindow(state.page, totalPages);

  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      <p className="text-sm text-muted-foreground">
        {total === 0
          ? `No ${itemLabel}`
          : `Showing ${firstRow}–${lastRow} of ${total} ${itemLabel}`}
      </p>

      <nav aria-label="Pagination" className="flex items-center gap-1">
        {state.page > 1 ? (
          <Link
            href={buildTableHref(pathname, state, { page: state.page - 1 })}
            className="rounded-lg border border-border px-2 py-1 text-sm text-foreground"
          >
            Previous
          </Link>
        ) : (
          <span aria-disabled="true" className="rounded-lg border border-border px-2 py-1 text-sm text-muted-foreground opacity-60">
            Previous
          </span>
        )}

        {window.map((entry, index) =>
          entry === 'gap' ? (
            <span key={`gap-${index}`} className="px-1 text-sm text-muted-foreground">
              …
            </span>
          ) : (
            <Link
              key={entry}
              href={buildTableHref(pathname, state, { page: entry })}
              aria-current={entry === state.page ? 'page' : undefined}
              className={cn(
                'rounded-lg border px-2 py-1 text-sm',
                entry === state.page
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-foreground'
              )}
            >
              {entry}
            </Link>
          )
        )}

        {state.page < totalPages ? (
          <Link
            href={buildTableHref(pathname, state, { page: state.page + 1 })}
            className="rounded-lg border border-border px-2 py-1 text-sm text-foreground"
          >
            Next
          </Link>
        ) : (
          <span aria-disabled="true" className="rounded-lg border border-border px-2 py-1 text-sm text-muted-foreground opacity-60">
            Next
          </span>
        )}
      </nav>

      <form method="get" action={pathname} className="flex items-end gap-2">
        <input type="hidden" name="sort" value={state.sort} />
        {state.search.length > 0 ? <input type="hidden" name="q" value={state.search} /> : null}
        {Object.entries(state.filters).map(([name, value]) =>
          value.length > 0 ? <input key={name} type="hidden" name={name} value={value} /> : null
        )}
        <div>
          <label htmlFor="table-page-size" className="mb-1 block text-xs font-medium text-muted-foreground">
            Rows per page
          </label>
          <select
            id="table-page-size"
            name="pageSize"
            defaultValue={String(state.pageSize)}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground"
          >
            {pageSizeOptions.map(option => (
              <option key={option} value={String(option)}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="h-8 rounded-lg border border-border px-3 text-sm text-foreground">
          Apply
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 9: Run the pagination test to verify it passes**

Run: `npx vitest run tests/unit/components/admin-data-table-pagination.test.tsx`
Expected: PASS, 6 tests.

Run: `npm run typecheck`
Expected: PASS.

---

### Task 8: The `/admin/users` page

**Files:**
- Create: `src/app/admin/users/page.tsx`
- Create: `src/app/admin/users/loading.tsx`
- Create: `src/app/admin/users/error.tsx`
- Modify: `src/components/admin/navigation.ts`
- Test: `tests/unit/app/admin-users-page.test.tsx` (new)

**Interfaces:**
- Consumes: `listUsersForAdmin`, `parseAdminUsersQuery`, `formatSortToken` from `@/modules/users`; `hasPermission`, `toPermissionKey` from `@/modules/authorization`; `requireAdminPageAccess` from `../../_access`; the kit from `@/components/admin/data-table/*`; `buildTableHref`, `type TableQueryState` from `@/lib/contracts/table`.
- Produces: the route `/admin/users`, visible in the admin navigation.

- [ ] **Step 1: Write the failing page test**

Create `tests/unit/app/admin-users-page.test.tsx`. Mock the server-only modules and the module query service, then render the page.

```tsx
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { requireAdminPageAccessMock, listUsersForAdminMock, notFoundMock } = vi.hoisted(() => ({
  requireAdminPageAccessMock: vi.fn(),
  listUsersForAdminMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/app/admin/_access', () => ({ requireAdminPageAccess: requireAdminPageAccessMock }));
vi.mock('next/navigation', () => ({ notFound: notFoundMock }));
vi.mock('@/modules/users', () => ({
  listUsersForAdmin: listUsersForAdminMock,
  parseAdminUsersQuery: (input: unknown) => ({
    page: 1,
    pageSize: 20,
    sortBy: 'createdAt',
    sortDirection: 'desc',
    search: '',
    status: null,
    superAdmin: null,
    ...(input as Record<string, unknown>),
  }),
  formatSortToken: (sortBy: string, sortDirection: string) =>
    sortDirection === 'desc' ? `-${sortBy}` : sortBy,
}));

import AdminUsersPage from '@/app/admin/users/page';

afterEach(cleanup);

const superAdmin = { userId: 'u1', roles: [], isSuperAdmin: true, permissions: [] };
const analyst = { userId: 'u2', roles: [], isSuperAdmin: false, permissions: ['analytics.read'] };

beforeEach(() => {
  requireAdminPageAccessMock.mockReset();
  listUsersForAdminMock.mockReset();
});

describe('AdminUsersPage', () => {
  it('renders the listing for an actor with user.read', async () => {
    requireAdminPageAccessMock.mockResolvedValue({ actor: superAdmin, user: { name: 'Root', email: 'root@example.com' } });
    listUsersForAdminMock.mockResolvedValue({
      items: [{ id: 'a', name: 'Ada Lovelace', email: 'ada@example.com', status: 'active', isSuperAdmin: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });

    render(await AdminUsersPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole('heading', { name: 'Users' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Ada Lovelace' })).toBeTruthy();
    expect(listUsersForAdminMock).toHaveBeenCalled();
  });

  it('returns the not-found behaviour for an admin-area actor without user.read', async () => {
    requireAdminPageAccessMock.mockResolvedValue({ actor: analyst, user: { name: 'Analyst', email: 'a@example.com' } });

    await expect(AdminUsersPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(listUsersForAdminMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/app/admin-users-page.test.tsx`
Expected: FAIL — `@/app/admin/users/page` does not exist.

- [ ] **Step 3: Implement the page**

Create `src/app/admin/users/page.tsx`:

```tsx
import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { AdminDataTable } from '@/components/admin/data-table/data-table';
import { AdminTablePagination } from '@/components/admin/data-table/data-table-pagination';
import { AdminTableToolbar } from '@/components/admin/data-table/data-table-toolbar';
import type { AdminTableColumn } from '@/components/admin/data-table/types';
import { hasPermission, toPermissionKey } from '@/modules/authorization';
import { formatSortToken, listUsersForAdmin, parseAdminUsersQuery } from '@/modules/users';
import { buildTableHref, type TableQueryState } from '@/lib/contracts/table';

import { requireAdminPageAccess } from '../_access';

export const dynamic = 'force-dynamic';

const PATHNAME = '/admin/users';

type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  isSuperAdmin: boolean;
  createdAt: string;
};

const STATUS_OPTIONS = [
  { value: '', label: 'Active & deactivated' },
  { value: 'active', label: 'Active' },
  { value: 'deactivated', label: 'Deactivated' },
  { value: 'deleted', label: 'Deleted' },
] as const;

const SUPER_ADMIN_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  deactivated: 'Deactivated',
  deleted: 'Deleted',
};

function formatDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

export default async function AdminUsersPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>): Promise<JSX.Element> {
  const { actor } = await requireAdminPageAccess(PATHNAME);

  // The navigation is never the boundary: the page checks the canonical
  // permission itself, and the query service checks it again.
  if (!hasPermission(actor, toPermissionKey('user', 'read'))) {
    notFound();
  }

  const raw = await searchParams;
  const query = parseAdminUsersQuery(raw);
  const result = await listUsersForAdmin(actor, query);

  const state: TableQueryState = {
    page: query.page,
    pageSize: query.pageSize,
    sort: formatSortToken(query.sortBy, query.sortDirection),
    search: query.search,
    filters: {
      status: query.status ?? '',
      superAdmin: query.superAdmin === null ? '' : query.superAdmin ? 'yes' : 'no',
    },
  };

  const columns: readonly AdminTableColumn<AdminUserRow>[] = [
    { key: 'name', header: 'Name', sortKey: 'name', render: row => row.name },
    { key: 'email', header: 'Email', sortKey: 'email', visibility: 'sm', render: row => row.email },
    {
      key: 'status',
      header: 'Status',
      render: row => STATUS_LABELS[row.status] ?? row.status,
    },
    {
      key: 'superAdmin',
      header: 'Super Admin',
      visibility: 'md',
      render: row => (row.isSuperAdmin ? 'Yes' : 'No'),
    },
    {
      key: 'created',
      header: 'Created',
      sortKey: 'createdAt',
      visibility: 'lg',
      render: row => formatDate(row.createdAt),
    },
  ];

  const hasActiveFilter = query.search.length > 0 || query.status !== null || query.superAdmin !== null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Accounts created by people signing in with Google.
        </p>
      </div>

      <AdminTableToolbar
        pathname={PATHNAME}
        state={state}
        searchLabel="Search users"
        searchPlaceholder="Name or email"
        clearHref={buildTableHref(PATHNAME, state, { page: 1, search: '', filters: {} })}
        filters={[
          { name: 'status', label: 'Status', options: STATUS_OPTIONS, value: state.filters.status ?? '' },
          { name: 'superAdmin', label: 'Super Admin', options: SUPER_ADMIN_OPTIONS, value: state.filters.superAdmin ?? '' },
        ]}
      />

      <AdminDataTable
        caption="User accounts"
        columns={columns}
        rows={result.items}
        rowKey={row => row.id}
        pathname={PATHNAME}
        state={state}
        empty={
          hasActiveFilter ? (
            <p className="text-sm text-muted-foreground">No accounts match the current search and filters.</p>
          ) : (
            <p className="text-sm text-muted-foreground">No accounts exist yet.</p>
          )
        }
      />

      <AdminTablePagination
        pathname={PATHNAME}
        state={state}
        total={result.total}
        totalPages={result.totalPages}
        itemLabel="users"
      />
    </div>
  );
}
```

- [ ] **Step 4: Implement the loading and error states**

Create `src/app/admin/users/loading.tsx`:

```tsx
import type { JSX } from 'react';

import { AdminTableSkeleton } from '@/components/admin/data-table/data-table-skeleton';

export default function AdminUsersLoading(): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Users</h1>
      </div>
      <AdminTableSkeleton columns={5} label="Loading users" />
    </div>
  );
}
```

Create `src/app/admin/users/error.tsx`:

```tsx
'use client';

import { useState, type JSX } from 'react';

import { AdminTableError } from '@/components/admin/data-table/data-table-error';
import { RetryButton } from '@/components/states/retry-button';

export default function AdminUsersError({
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): JSX.Element {
  const [isRetrying, setIsRetrying] = useState(false);

  function handleRetry(): void {
    setIsRetrying(true);
    reset();
  }

  return (
    <AdminTableError label="users" description="The request failed. Try again.">
      <RetryButton onRetry={handleRetry} isRetrying={isRetrying} />
    </AdminTableError>
  );
}
```

- [ ] **Step 5: Flip the navigation entry**

In `src/components/admin/navigation.ts`, change the `users` entry in the `users` group from `implemented: false` to `implemented: true`.

Run: `npx vitest run tests/unit/components/admin-navigation.test.ts`
Expected: PASS. If an existing assertion expects the Users entry to be hidden, update that assertion to reflect the implemented flag, and keep every other assertion.

- [ ] **Step 6: Run the page test to verify it passes**

Run: `npx vitest run tests/unit/app/admin-users-page.test.tsx`
Expected: PASS, 2 tests.

Run: `npm run typecheck`
Expected: PASS.

---

### Task 9: Test-only session seeder

**Files:**
- Create: `tests/e2e/support/admin-session.mjs`
- Test: `tests/e2e/admin-session.spec.ts` (new)

**Interfaces:**
- Consumes: `resolveTestDatabase` from `./database-target.mjs`; `loadLocalEnv` from `./load-local-env.mjs`; `makeSignature` from `better-auth/crypto`.
- Produces:
  - `adminSession.seed(options: { email?: string; name?: string; superAdmin?: boolean }): Promise<{ userId: string; sessionToken: string; cookieName: string; cookieValue: string; databaseName: string }>`
  - `adminSession.remove(userId: string): Promise<void>`
  - `ADMIN_SESSION_COOKIE_NAME = 'better-auth.session_token'`

- [ ] **Step 1: Write the failing E2E test**

Create `tests/e2e/admin-session.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';

test.describe('seeded admin session', () => {
  test('signs a Super Admin into the admin area', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-superadmin@example.com' });

    try {
      await context.addCookies([
        {
          name: session.cookieName,
          value: session.cookieValue,
          url: 'http://localhost:3000',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);

      await page.goto('/admin');

      await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    } finally {
      await adminSession.remove(session.userId);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e -- tests/e2e/admin-session.spec.ts`
Expected: FAIL — `./support/admin-session.mjs` does not exist.

- [ ] **Step 3: Implement the seeder**

Create `tests/e2e/support/admin-session.mjs`:

```js
// Test-only authentication helper for the end-to-end suite.
//
// It creates a Super Admin user and a session row in the isolated test
// database and signs the session cookie with Better Auth's own signature
// helper, so the application accepts it through its real session validation.
// Nothing is mocked: the session lookup, the account-status gate, the actor
// resolution, and the permission guard all run for real.
//
// The helper refuses to run unless the target database name ends in "_test"
// and differs from DATABASE_URL. It only deletes the rows it created.

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { makeSignature } from 'better-auth/crypto';

import { loadLocalEnv } from './load-local-env.mjs';
import { resolveTestDatabase } from './database-target.mjs';

loadLocalEnv();

export const ADMIN_SESSION_COOKIE_NAME = 'better-auth.session_token';

const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function requireSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      'BETTER_AUTH_SECRET must be set to a real value of at least 32 characters before ' +
        'seeding an end-to-end session.'
    );
  }

  return secret;
}

function requireTestClient() {
  const target = resolveTestDatabase({
    testDatabaseUrl: process.env.TEST_DATABASE_URL,
    mainDatabaseUrl: process.env.DATABASE_URL,
  });

  return { target, client: new Client({ connectionString: target.url }) };
}

/** Sign a value the way Better Auth signs its session cookie. */
async function signCookieValue(value, secret) {
  return `${value}.${await makeSignature(value, secret)}`;
}

async function seed({ email, name, superAdmin = true }) {
  const secret = requireSecret();
  const { target, client } = requireTestClient();

  await client.connect();

  try {
    const userEmail = email ?? `e2e-superadmin-${randomUUID()}@example.com`;
    const displayName = name ?? 'E2E Super Admin';
    const sessionToken = randomUUID();

    await client.query(
      `INSERT INTO users (name, email, email_verified, is_active, is_super_admin, role, created_at, updated_at)
       VALUES ($1, $2, true, true, $3, 'viewer', now(), now())`,
      [displayName, userEmail, superAdmin]
    );

    const { rows } = await client.query('SELECT id FROM users WHERE email = $1', [userEmail]);

    if (!rows[0]) {
      throw new Error('Seeded user could not be read back.');
    }

    await client.query(
      `INSERT INTO sessions (expires_at, token, ip_address, user_agent, user_id, created_at, updated_at, last_activity_at)
       VALUES ($1, $2, '127.0.0.1', 'e2e-seeder', $3, now(), now(), now())`,
      [new Date(Date.now() + SESSION_LIFETIME_MS), sessionToken, rows[0].id]
    );

    return {
      userId: rows[0].id,
      sessionToken,
      cookieName: ADMIN_SESSION_COOKIE_NAME,
      cookieValue: await signCookieValue(sessionToken, secret),
      databaseName: target.databaseName,
    };
  } finally {
    await client.end().catch(() => {});
  }
}

async function remove(userId) {
  const { client } = requireTestClient();

  await client.connect();

  try {
    await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);
  } finally {
    await client.end().catch(() => {});
  }
}

export const adminSession = { seed, remove };
```

**Four corrections to the reference implementation above, all required:**

1. **Never let a raw `pg` error reach the output.** A `pg` connection or query
   failure carries the connection string — and therefore the password — in its
   message, and an uncaught error is printed by the test runner. Wrap every
   `pg` operation in `try`/`catch` and re-throw a sanitized error instead: a
   fixed message that names the operation and the target database but never the
   connection string. `redactConnectionString` is already exported from
   `./database-target.mjs` if you want the host without the credentials. Apply
   this to both `seed` and `remove`.
2. **Wrap the two inserts in one transaction.** The user insert and the session
   insert must commit together or not at all, so a failure between them cannot
   leave an orphan user row (`BEGIN` / `COMMIT` / `ROLLBACK` on error).
3. **Scope the session delete to the seeded session.** Return the session row's
   id from `seed` and delete that id, not every session belonging to the user.
4. **Make `seed` idempotent.** Inside the same transaction, delete any leftover
   user row with the requested email (and that user's sessions) before
   inserting. The `users.email` column is unique, so a run that crashed
   mid-test would otherwise make the next run fail on the insert. The helper
   owns the row for the email it was asked to seed, so removing a leftover of
   that exact email stays inside its blast radius.

Also note: `seed` must accept being called with no arguments, so give its
parameter object a `= {}` default. Without it, destructuring throws a
`TypeError` **before** the database guard runs, and the refusal would not name
the rejected database.

Because `allowJs` pulls this `.mjs` file into the TypeScript program when a
`.ts`/`.tsx` file imports it, the exported functions need JSDoc type
annotations, or `tsc --noEmit` rejects a call that passes `email`/`name`.
`tests/e2e/support/run-marker.mjs` is the existing style reference.

Before writing this file, confirm the installed Better Auth version (`node -e "console.log(require('better-auth/package.json').version)"` → 1.7.18) and confirm the cookie name and the `signCookieValue` shape against `node_modules/better-auth/dist/cookies/index.mjs` and `node_modules/better-auth/dist/plugins/test-utils/cookie-builder.mjs`, which sign a value as `${value}.${await makeSignature(value, secret)}`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:e2e -- tests/e2e/admin-session.spec.ts`
Expected: PASS.

If the session is rejected, inspect the application's server log for the session lookup and confirm the seeded `sessions.token` matches the cookie's unsigned part. Do not weaken the application's session validation to make the test pass.

- [ ] **Step 5: Confirm the helper cannot reach the main database**

Run a Node snippet that calls `adminSession.seed()` with `TEST_DATABASE_URL` pointing at `dramascan`.
Expected: it throws before connecting, naming the rejected database.

---

### Task 10: End-to-end coverage of the users listing

**Files:**
- Create: `tests/e2e/admin-users.spec.ts`
- Modify: `tests/e2e/admin-access.spec.ts` (add the `/admin/users` anonymous redirect)

**Interfaces:**
- Consumes: `adminSession` from `./support/admin-session.mjs`.
- Produces: browser coverage of the listing, the filters, the sort, the pagination, the authorization behavior, and the responsive layout.

- [ ] **Step 1: Write the failing E2E spec**

Create `tests/e2e/admin-users.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

import { adminSession } from './support/admin-session.mjs';

test.describe('admin users listing', () => {
  test('lists, searches, filters, sorts, and paginates', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-users-list@example.com' });

    try {
      await context.addCookies([
        {
          name: session.cookieName,
          value: session.cookieValue,
          url: 'http://localhost:3000',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);

      await page.goto('/admin/users');

      await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
      await expect(page.getByRole('table')).toBeVisible();

      // Sorting is a link that keeps the rest of the table state.
      await page.getByRole('columnheader', { name: /Name/ }).getByRole('link').click();
      await expect(page).toHaveURL(/sort=-name/);

      // The status filter is a GET form that resets to the first page.
      await page.getByLabel('Status').selectOption('active');
      await page.getByRole('button', { name: 'Apply' }).first().click();
      await expect(page).toHaveURL(/status=active/);
      await expect(page).not.toHaveURL(/page=\d/);

      // The search term survives the filter.
      await page.getByLabel('Search users').fill('e2e');
      await page.getByRole('button', { name: 'Search' }).click();
      await expect(page).toHaveURL(/q=e2e/);
      await expect(page).toHaveURL(/status=active/);
    } finally {
      await adminSession.remove(session.userId);
    }
  });

  test('shows the empty state when nothing matches', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-users-empty@example.com' });

    try {
      await context.addCookies([
        {
          name: session.cookieName,
          value: session.cookieValue,
          url: 'http://localhost:3000',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);

      await page.goto('/admin/users?q=definitely-not-a-real-account-name');

      await expect(page.getByText(/No accounts match/)).toBeVisible();
      await expect(page.getByRole('link', { name: /clear/i })).toBeVisible();
    } finally {
      await adminSession.remove(session.userId);
    }
  });

  test('normalizes an invalid query instead of failing', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-users-invalid@example.com' });

    try {
      await context.addCookies([
        {
          name: session.cookieName,
          value: session.cookieValue,
          url: 'http://localhost:3000',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);

      const response = await page.goto('/admin/users?page=-3&pageSize=9999&sort=password&status=bogus');

      expect(response?.status()).toBe(200);
      await expect(page.getByRole('table')).toBeVisible();
    } finally {
      await adminSession.remove(session.userId);
    }
  });

  test('never scrolls the page horizontally at any viewport', async ({ context, page }) => {
    const session = await adminSession.seed({ email: 'e2e-users-responsive@example.com' });

    try {
      await context.addCookies([
        {
          name: session.cookieName,
          value: session.cookieValue,
          url: 'http://localhost:3000',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);

      for (const viewport of [
        { width: 390, height: 844 },
        { width: 768, height: 1024 },
        { width: 1440, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto('/admin/users');

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );

        expect(overflow).toBeLessThanOrEqual(0);
      }
    } finally {
      await adminSession.remove(session.userId);
    }
  });
});
```

- [ ] **Step 2: Add the anonymous redirect for the new route**

Append to `tests/e2e/admin-access.spec.ts`:

```ts
  test('redirects anonymous visitors from the users listing to sign in', async ({ page }) => {
    const response = await page.goto('/admin/users');

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/auth\/signin\?callbackUrl=%2Fadmin$/);
    await expect(page.locator('input[name="callbackUrl"]')).toHaveValue('/admin');
  });
```

- [ ] **Step 3: Run the E2E specs**

Run: `npm run test:e2e -- tests/e2e/admin-users.spec.ts tests/e2e/admin-access.spec.ts`
Expected: PASS.

- [ ] **Step 4: Verify the authorization behavior in the browser**

Add one more case to `tests/e2e/admin-users.spec.ts`: seed a **non**-Super-Admin user (an `is_super_admin = false` row with no roles) and assert that `/admin/users` returns 404 for that session. The seeder needs a `superAdmin: false` option; add it to `adminSession.seed` as an option that controls the `is_super_admin` column value.

Run: `npm run test:e2e -- tests/e2e/admin-users.spec.ts`
Expected: PASS.

- [ ] **Step 5: Close the coverage gaps found in review**

The first version of this spec left three of the required coverage items
unasserted, and the fixes belong in the same file.

**5.1 — Super Admin filter.** The spec drives the status filter but never the
Super Admin filter, so a regression in that filter would pass unnoticed. Extend
the filter test (or add a case) to select the Super Admin filter, assert the
`superAdmin` parameter reaches the URL, and assert that it **combines** with
the status filter — both parameters present in one URL.

**5.2 — Column visibility.** The overflow measurement is a document-level
check, but a page that hid the *wrong* columns at 390px would still measure
zero. Inside the existing viewport loop, assert the responsive contract
directly: at 390px the `Email` column header is not visible, and at 1440px it
is. (`Email` has the `sm` priority, so it appears from 640px upward.)

**5.3 — The listing is actually populated.** The first assertions only prove
that the heading and the table exist. Assert that the seeded account is
visible in the table — for example by its email — so the "lists" claim is
verified rather than inferred from the surrounding controls.

**5.4 — Pagination beyond the first page.** Seed a **second** account, load the
listing with `?pageSize=1`, click `Next` in the pagination bar, and assert the
URL carries `page=2` and that the page shows the **other** account rather than
the first one. This exercises the pagination control through the real UI.

**5.5 — The page-size control must not lie.** `pageSize=1` is a legal value
(`CONVENTIONS.md` §6.3 allows 1–100), but the control only offers 20, 50, and
100, so the `<select>` would display a stale value. In
`src/components/admin/data-table/data-table-pagination.tsx`, include the current
page size in the options when it is not already among them, and add a case to
`tests/unit/components/admin-data-table-pagination.test.tsx` that renders the
component with a `pageSize` outside the option list and asserts the control
shows that value.

**5.6 — One comment correction.** The authorization test's comment says the
seeded account has "no role assignments", but the seeder writes
`role='viewer'` into the row. The permission outcome is proven by the 404; make
the comment precise: a viewer-role account with no admin permissions.

The duplicated cookie block that appears in each test case is a follow-up
refactor, not part of this step.

- [ ] **Step 6: Re-run the E2E specs**

Run: `npm run test:e2e -- tests/e2e/admin-users.spec.ts tests/e2e/admin-access.spec.ts`
Expected: PASS.

Run: `npm run test:e2e`
Expected: every test passes except the known pre-existing
`tests/e2e/public-site.spec.ts › footer reaches every public route` flake,
which must be reported separately.

---

### Task 11: Documentation, full verification, and the single commit

**Files:**
- Create: `docs/development/admin-data-tables.md`
- Modify: `docs/development/DATABASE.md`
- Modify: `docs/decisions/DECISIONS.md` (new D-026)
- Modify: `docs/architecture/ARCHITECTURE.md` (§6.1 auth public API)
- Modify: `docs/architecture/module-architecture.md`
- Modify: `docs/development/CONVENTIONS.md` (pointers to D-026)
- Modify: `docs/README.md` (quick link)
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/PROJECT_STATUS.md`

- [ ] **Step 1: Write `docs/development/admin-data-tables.md`**

Document, in this order: the kit's files and boundaries; the column-priority API and its Tailwind mapping; the URL query-state contract (parameter, accepted values, default, effect) and the rule that an invalid value normalizes; the filter semantics and the deleted-first status precedence; the sort allowlist and the `id` tiebreaker; the authorization rules and the D-026 exception to `CONVENTIONS.md` §6.6; the deviation from §6.4 for admin pages; the `src/lib/contracts/table.ts` ↔ module `validation.ts` duplication and the test that keeps them in step; and the supporting index with the queries it does not serve.

- [ ] **Step 2: Record D-026**

Append to `docs/decisions/DECISIONS.md`, before the decision-log rules:

```markdown
## D-026 - Admin data tables: URL state, page-level authorization, and the supporting index

**Date:** 2026-11-12
**Status:** Approved by user
**Resolves:** Prompt 051

**Context:** The admin shell had no way to list a collection. The first listing
(`/admin/users`) needed a shared table-state contract, a server-side query
path, and a decision about how an admin page answers an actor who reaches the
admin area but lacks the page's permission.

**Decision:**

1. **URL state:** All table state (page, page size, sort, search, filters)
   lives in the URL query string. Sorting and pagination are links; search and
   filters are GET forms. A search or filter change resets to page 1, and so
   does a sort change.
2. **Normalization:** An admin page normalizes an invalid query parameter
   instead of rejecting it, because §6.4 governs REST responses and a
   navigable URL must survive a stray parameter. The sortable-column
   allowlist is still enforced server-side; an unknown column never reaches
   SQL.
3. **Page-level authorization:** An authenticated actor with admin-area access
   but without the page's permission receives `notFound()` (404), extending the
   area-level rule established in Prompt 049 to a page-level permission. This
   is an intentional exception to `CONVENTIONS.md` §6.6, scoped to the admin
   area; no existing route's behavior changes and no `forbidden.tsx` or
   `experimental.authInterrupts` is introduced.
4. **Ownership:** The auth module owns the Drizzle query over its own `users`
   table and exposes it through its public API. The users module owns the
   admin projection and the `user.read` guard, in
   `modules/users/read-models/`. The auth module may not import the
   authorization module (§7.2, D-008), so `listUserAccounts` cannot take an
   `ActorContext`; the protected query is `listUsersForAdmin`.
5. **Supporting index:** The production listing query is served by a partial
   index on `users (created_at DESC) WHERE deleted_at IS NULL`. It serves the
   default scope and the default sort. It does not serve the `deleted` filter
   or the free-text search, and neither is claimed as covered.

**Consequences:**

- The admin area has one URL contract that every future table reuses.
- A shared or bookmarked admin URL reproduces the exact view, and an invalid
  one still renders.
- An actor without `user.read` cannot learn that `/admin/users` exists.
- The search remains an `ILIKE` scan until a query plan justifies a trigram
  index.
```

- [ ] **Step 3: Update the remaining documents**

`docs/CHANGELOG.md` is the canonical changelog — it carries the versioned
headings for the recent prompts. The root `CHANGELOG.md` and
`docs/implementation/CHANGELOG.md` are older duplicates that stopped being
updated at Prompts 018 and 019; leave them alone and do not duplicate this
prompt's entry into them.

- `docs/development/DATABASE.md`: record `idx_users_active_created_at`, the queries it serves, the queries it does not serve (the `deleted` filter and the free-text search), and the measured `EXPLAIN` plans from Task 5 Step 4. Also record the two known limitations: the `CREATE INDEX` is not `CONCURRENTLY`, so a deploy takes a brief write lock on `users` while it builds; and the index covers `created_at DESC` only, while the default sort is `ORDER BY created_at DESC, id ASC`, so a sort step remains for tied `created_at` rows.
- `docs/development/admin-shell.md`: correct the access-rules table — the anonymous redirect uses the **layout's** path, so the callback is always `callbackUrl=%2Fadmin` for every admin route, not the deep-linked path. `buildAdminSignInUrl` encodes a full path when it is given one, so the limitation is the layout's, and it is recorded as a known limitation with its follow-up.
- `docs/architecture/ARCHITECTURE.md` §6.1: add `listUserAccounts` to the auth module's public API list.
- `docs/architecture/module-architecture.md`: note the auth repository query and the users read model.
- `docs/development/CONVENTIONS.md`: add a pointer to D-026 under §6.6.
- `docs/README.md`: add "Admin Data Tables" to the quick links.
- `docs/CHANGELOG.md`: add the Prompt 051 entry.
- `docs/PROJECT_STATUS.md`: add the Prompt 051 row with the actual file list, test counts, and the known limitations (the search remains an `ILIKE` scan; the `deleted` filter is not served by the partial index; no Actions column).

- [ ] **Step 4: Run the full verification gate**

Run, in order, and record the actual output:

```text
npm run typecheck
npm run lint
npm test
npm run test:integration
node "C:\Users\User\AppData\Local\Temp\opencode\dramascan-build.mjs"
npm run test:e2e
```

The production build runs through the wrapper script rather than a bare
`npm run build`: production configuration requires an HTTPS `APP_URL`, and the
wrapper supplies a production-shaped origin without touching the local
development values or any real domain.

Expected: every command passes. Report any pre-existing failure separately from a failure introduced by this prompt.

- [ ] **Step 5: Review the diff for scope and secrets**

Run: `git status` and `git diff --check`.
Expected: only the files listed in this plan; no `.env*`, no `test-results/`, no `.next/`, no debug code, no credentials.

- [ ] **Step 6: Create the final commit**

The plan originally asked for one squashed commit for Prompt 051. That is no
longer possible: the first three task commits were pushed to `origin/main`
before the push-approval rule was enforced, and `AGENTS.md` forbids
`git push --force` and rewriting shared Git history unconditionally. Squashing
locally would diverge `main` from `origin/main` and make every later push
non-fast-forward, so the only way to reconcile would be the forbidden
force-push. **The branch therefore keeps its per-task commits.** This step
creates the final documentation commit on top of them.

```bash
git add src/lib/contracts src/components/admin src/components/ui/table.tsx src/modules/auth src/modules/users src/app/admin/users src/app/admin/navigation.ts tests drizzle docs/superpowers/specs/2026-11-12-admin-data-tables-design.md docs/superpowers/plans/2026-11-12-admin-data-tables.md docs/development docs/decisions/DECISIONS.md docs/architecture docs/README.md docs/CHANGELOG.md docs/PROJECT_STATUS.md
git commit -m "docs: document the admin data tables and the users listing (Prompt 051)"
```

Do **not** push. Report the commit hash, the verification results, and any unverified behavior, then request explicit approval to push.

---

## Plan Self-Review

- **Spec coverage:** Shared URL contract → Task 1. Identity query → Task 2. Zod contract → Task 3. Read model, guard, projection → Task 4. Supporting index and query plans → Task 5. Table, skeleton, error state, responsive priority → Task 6. Toolbar and pagination → Task 7. Page, loading, error, navigation → Task 8. Test-only seeder → Task 9. Browser workflow and responsive checks → Task 10. Documentation, decision, verification, commit → Task 11. Every spec section maps to a task.
- **Step scan:** Each step names a file, a signature, or a command with an expected result. No step says "add validation" or "write tests for the above" without naming them. The only bodies given are the ones whose exact text is pinned by the spec (the contract, the Zod schema, the component props, the migration SQL).
- **Type consistency:** `TableQueryState` and `buildTableHref` are produced in Task 1 and consumed in Tasks 6–8. `UserAccountStatus`/`UserAccountSortField` are produced in Task 2 and consumed by type-only import in Task 3. `AdminUsersQuery` is produced in Task 3 and consumed in Tasks 4 and 8. `AdminUserListItem`/`AdminUserListResult` are produced in Task 4 and consumed in Task 8. `AdminTableColumn`/`AdminTableFilterField` are produced in Task 6 and consumed in Tasks 7–8. `adminSession` is produced in Task 9 and consumed in Task 10.
- **Review Focus:** each of the five lines has a pinned test — the invalid-URL case in Tasks 3 and 10, the combined-filter case in Tasks 7 and 10, the deleted-before-active precedence in Tasks 2 and 4, the single-page response in Tasks 2 and 4, and the page-level permission refusal in Tasks 4 and 8.
- **Proportion:** the plan is longer than the spec's implementation detail but shorter than a transcript: the component bodies are given because their markup, class names, and accessible names are part of the deliverable, and the repository query is given because its filter predicates are the correctness core.
- **Deliberate deviations, all approved:** no Actions column on `/admin/users`; sort resets to page 1; `totalPages` is 0 for an empty result; query parameters normalize instead of erroring; `listUserAccounts` takes no actor.
