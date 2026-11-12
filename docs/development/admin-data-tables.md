# Admin Data Tables

**Project:** DramaScan — International Drama & Movie Streaming Platform
**Version:** 1.0
**Date:** 2026-11-12

This document describes the reusable admin data-table kit created by Prompt 051
and the reference implementation that proves it, `/admin/users`. It covers the
kit's files and boundaries, the column-priority API, the URL query-state
contract, the filter and sort semantics, the authorization rules, the two
documented deviations from `CONVENTIONS.md`, the shared/module contract
duplication, and the supporting index.

The kit is generic; `/admin/users` is the first table built with it. Reviews,
dramas, movies, and the other planned admin sections reuse the same contract.

---

## 1. Principles

- **All table state lives in the URL.** Page, page size, sort, search term, and
  filters are query parameters, so a shared or bookmarked link reproduces the
  exact view and the browser's back/forward buttons work.
- **Server Components only.** Sorting and pagination are links; search and
  filters are GET forms. There is no client-side table state, no TanStack Query,
  no router-driven search, and no REST endpoint for a listing.
- **The browser receives one page of rows.** The query runs on the server with
  `LIMIT`/`OFFSET` (`CONVENTIONS.md` §6.3).
- **Authorization is server-side and canonical.** The page and the query service
  both enforce `user.read`; sidebar visibility is never the boundary.
- **No module import from the kit.** Components may import `lib`/`lib/contracts`
  only (`ARCHITECTURE.md` §7); the kit fetches nothing and imports no module.

---

## 2. Files and Boundaries

### 2.1 The kit — `src/components/admin/data-table/`

No barrel `index.ts` (`CONVENTIONS.md` §2.2); direct imports only. File names are
kebab-case, matching the rest of `src/components/admin/`.

| File                             | Exports                                            | Boundary |
| -------------------------------- | -------------------------------------------------- | -------- |
| `types.ts`                       | `AdminTableColumn<T>`, `AdminTableFilterOption`, `AdminTableFilterField`, `AdminTableColumnVisibility` | Shared (types only) |
| `data-table.tsx`                 | `AdminDataTable<T>`, `nextSortToken`               | Server   |
| `data-table-toolbar.tsx`         | `AdminTableToolbar`                                | Server   |
| `data-table-pagination.tsx`      | `AdminTablePagination`, `buildPageWindow`          | Server   |
| `data-table-skeleton.tsx`        | `AdminTableSkeleton`                               | Server   |
| `data-table-error.tsx`           | `AdminTableError`                                  | Server   |

The kit reuses `src/components/states/` (`EmptyState`, `Skeleton`,
`SkeletonGroup`, `RetryState`) and the vendored `src/components/ui/table.tsx`,
`input.tsx`. `src/components/ui/table.tsx` lost its `'use client'` directive in
this prompt: it holds no state, no hooks, and no handlers, so the directive only
prevented the primitive from rendering inside a Server Component. The file is
otherwise untouched and has no other call sites.

### 2.2 The rest of the feature

| File                                          | Responsibility                                                   |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `src/lib/contracts/table.ts`                  | Parameter names, page-size constants, `TableQueryState`, `buildTableHref` |
| `src/modules/users/validation.ts`             | Zod contract and parser for the admin users query                |
| `src/modules/users/read-models/admin-users.ts` | `listUsersForAdmin`: guard, query, projection                    |
| `src/modules/users/index.ts`                  | Users module public API (`server-only`)                          |
| `src/modules/auth/repository.ts`              | `listUserAccounts`: Drizzle query over the auth module's own `users` table |
| `src/modules/auth/index.ts`                   | Auth module public API (`server-only`)                           |
| `src/app/admin/users/page.tsx`                | The reference listing page                                       |
| `src/app/admin/users/loading.tsx`             | Route loading state (`AdminTableSkeleton`)                       |
| `src/app/admin/users/error.tsx`               | Route error boundary (Client Component, required by Next.js)     |
| `drizzle/0003_needy_infant_terrible.sql`      | One partial index (`CREATE INDEX`, not `CONCURRENTLY`)           |

### 2.3 Component APIs

| Component                  | Props (beyond `className`)                                                                                                  | Notes |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----- |
| `AdminDataTable<T>`        | `caption`, `captionClassName?`, `columns`, `rows`, `rowKey`, `pathname`, `state`, `empty?`, `emptyIcon?`                     | Renders `EmptyState` instead of a body when `rows.length === 0` |
| `AdminTableToolbar`        | `pathname`, `state`, `searchLabel`, `searchPlaceholder?`, `filters?`, `clearHref?`                                          | Search form, filter form, clear link |
| `AdminTablePagination`     | `pathname`, `state`, `total`, `totalPages`, `itemLabel`, `pageSizeOptions?`                                                 | Summary, page window, page-size form |
| `AdminTableSkeleton`       | `columns`, `label?`                                                                                                         | One `SkeletonGroup` announcement; `columns` placeholder rows |
| `AdminTableError`          | `label`, `description?`, `children?`                                                                                        | Wraps `RetryState` with a "Could not load {label}" heading |

`buildPageWindow(currentPage, totalPages)` returns the page numbers to show
around the current page with `'gap'` markers for the gaps; it is a pure function
and is unit-tested.

---

## 3. The Shared URL Contract — `src/lib/contracts/table.ts`

Client-safe and isomorphic: no framework import, no server code, no database
access. It is **not** imported by modules (`ARCHITECTURE.md` §7).

```ts
export const TABLE_QUERY_PARAMS = {
  page: 'page',
  pageSize: 'pageSize',
  sort: 'sort',
  search: 'q',
} as const;

export const DEFAULT_TABLE_PAGE_SIZE = 20;
export const MAX_TABLE_PAGE_SIZE = 100;
export const TABLE_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export type TableSortDirection = 'asc' | 'desc';

export type TableQueryState = Readonly<{
  page: number;                                     // 1-based page index
  pageSize: number;
  sort: string;                                     // e.g. '-createdAt'
  search: string;                                   // '' when absent
  filters: Readonly<Record<string, string>>;        // '' means "no filter"
}>;
```

`buildTableHref(pathname, state, overrides?)` is pure and holds no default
values — the caller passes the state it wants, so "reset to page 1" is a visible
decision at each call site rather than hidden magic:

- `pageSize` and `sort` are **always** emitted, so a shared link reproduces the
  view exactly;
- `page` is emitted only when greater than 1;
- `q` is emitted only when non-empty;
- a filter is emitted only when its value is non-empty;
- `overrides` replaces the named fields; `filters` is replaced wholesale, not
  merged, so a caller dropping one filter must pass the rest.

---

## 4. Column Priority API and Its Tailwind Mapping

`AdminTableColumn<T>` describes one column:

```ts
export type AdminTableColumnVisibility = 'always' | 'sm' | 'md' | 'lg';

export type AdminTableColumn<T> = Readonly<{
  key: string;
  header: string;
  sortKey?: string;                     // set to make the column sortable
  align?: 'left' | 'center' | 'right';  // default 'left'
  visibility?: AdminTableColumnVisibility; // default 'always'
  headerClassName?: string;
  cellClassName?: string;
  render: (_row: T) => ReactNode;
}>;
```

`visibility` maps to Tailwind classes applied to both the header cell and the
body cells:

| `visibility` | Classes                 | Visible from |
| ------------ | ----------------------- | ------------ |
| `always`     | —                       | every width  |
| `sm`         | `hidden sm:table-cell`  | 640px        |
| `md`         | `hidden md:table-cell`  | 768px        |
| `lg`         | `hidden lg:table-cell`  | 1024px       |

The table sits inside the vendored primitive's `relative w-full overflow-x-auto`
container, so columns that still exceed the available width scroll inside the
container instead of stretching the page. There is no separate mobile card list
and the table never renders a second copy of the row data.

`/admin/users` uses these priorities:

| Column       | Sort key   | Visibility |
| ------------ | ---------- | ---------- |
| Name         | `name`     | `always`   |
| Email        | `email`    | `sm`       |
| Status       | —          | `always`   |
| Super Admin  | —          | `md`       |
| Created      | `createdAt`| `lg`       |
| Actions      | —          | `always` (kit support only; not rendered by this page) |

The kit accepts an Actions column with always-visible priority and a
caller-supplied renderer. `/admin/users` renders five content columns and no
Actions column: the existing admin account routes are stubs, and wiring them
would ship a control that reports success without changing anything. Account
management actions belong to their own prompt.

---

## 5. The URL Query-State Contract

| Parameter  | Accepted values                                             | Default      | Effect                                        |
| ---------- | ----------------------------------------------------------- | ------------ | --------------------------------------------- |
| `page`     | integer ≥ 1                                                 | `1`          | 1-based page index                            |
| `pageSize` | integer 1–100                                               | `20`         | rows per page; the UI offers 20 / 50 / 100    |
| `sort`     | `name`, `email`, `createdAt`, `updatedAt`, each `-` optional | `-createdAt` | sort column and direction                     |
| `q`        | free text, trimmed, ≤ 200 characters                        | absent       | case-insensitive match on name **or** email   |
| `status`   | `active`, `deactivated`, `deleted`                          | absent       | account status filter                         |
| `superAdmin` | `yes`, `no`                                               | absent       | Super Admin filter                            |

Rules:

- **An invalid or unknown value normalizes instead of erroring.** A missing,
  malformed, or out-of-range parameter falls back to its default and the page
  still renders. See §8.
- **Sorting is a single column.** The parser tolerates the
  `CONVENTIONS.md` §6.4 comma-separated form by using the first recognized
  column, so the format stays forward-compatible, but the kit never emits more
  than one column and never renders two sorted columns at once.
- **A search or filter change resets to page 1, and so does a sort change** — the
  current page index may not exist in the new ordering, and a silently empty page
  is worse than returning to the first page.
- Sorting, paging, searching, and filtering all preserve every other parameter,
  so a filter survives a sort change and a page change.
- The flash parameters the existing admin account routes redirect with
  (`?authorized=true`, `?deactivated=true`, `?reactivate=true`) are ignored by
  this page. Those routes are stubs; the parameters become meaningful in the
  account-management prompt.

The controls and how they submit:

| Control          | Form/link                                        | Hidden state carried                                     | Page reset |
| ---------------- | ------------------------------------------------ | -------------------------------------------------------- | ---------- |
| Search           | GET form to the pathname                         | `sort`, `pageSize`, every active filter                   | yes        |
| Filters          | GET form, one `<select>` per filter              | `sort`, `pageSize`, `q`                                   | yes        |
| Sort header      | `<Link>` with the sort token flipped             | everything else, through `buildTableHref`                 | yes        |
| Page number      | `<Link>`                                        | everything else, through `buildTableHref`                 | no         |
| Rows per page    | GET form with `<select name="pageSize">`         | `sort`, `q`, the active filters                           | yes        |
| Clear filters    | `<Link>` to page 1                               | the current sort and page size; search and filters removed| yes        |

The clear link renders only when a search term or a filter is active. A filter's
"All" option carries the empty value, which the parser normalizes to "no filter".
The clear link returns to page 1, keeping the current sort and page size.

The page-size control lists 20 / 50 / 100 and additionally includes the current
page size when a hand-edited or shared link carries one the control does not
offer (`CONVENTIONS.md` §6.3 allows any size from 1 to 100). A `<select>` shows
only the option matching its value, so a missing size would leave the control
blank — or showing a stale number — while the page showed a different number of
rows.

---

## 6. Filter Semantics and Status Precedence

The account status is a derived, strict partition, and **deleted wins**:

| `status`    | SQL predicate                                          |
| ----------- | ------------------------------------------------------ |
| absent      | `deleted_at IS NULL`                                   |
| `active`    | `deleted_at IS NULL AND is_active = true`              |
| `deactivated` | `deleted_at IS NULL AND is_active = false`           |
| `deleted`   | `deleted_at IS NOT NULL`                               |

- Soft-deleted users are visible **only** when `status=deleted`. The default
  scope excludes them, and selecting `deleted` is never silently reduced to the
  default scope.
- The projection derives the status as
  `deletedAt !== null ? 'deleted' : isActive ? 'active' : 'deactivated'`, so a
  deleted account is never reported as active or deactivated even when its
  `is_active` column is still `true`.
- `superAdmin` is applied with `AND`, so the two filters combine:
  `?status=active&superAdmin=yes` shows only active Super Admins.
- `is_super_admin` is the authoritative Super Admin definition (D-022). The
  filter reads the column; it is never inferred from a role name, a permission,
  or a query parameter.

The free-text term is matched with `ILIKE` against `name` and `email`, and `%`,
`_`, and `\` in the term are escaped, so a search for `100%` does not act as a
wildcard.

---

## 7. Sorting and the Tiebreaker

- **Allowlist:** `name`, `email`, `createdAt`, `updatedAt`. The column is chosen
  through a fixed map in `src/modules/auth/repository.ts`, never interpolated
  from the request, so no client-supplied identifier reaches SQL.
- **Tiebreaker:** every query ends with `id ASC`, so the ordering is a total
  order and paging can neither repeat nor skip a row when the primary key ties.
  `id` is UUIDv7 and therefore time-ordered, so the tiebreaker is stable in
  practice too.
- A sortable header renders `<th scope="col" aria-sort="…">` containing a
  `<Link>`. The sorted column gets `aria-sort="ascending"` or `"descending"`;
  every other sortable column gets `aria-sort="none"`. The link's accessible name
  states the current order and the action (`"Sort by Name, currently
  descending"`), and a decorative arrow states the same visually.
- `nextSortToken(currentSort, columnSortKey)` flips the direction of the sorted
  column and sorts a different column descending first, matching the table's
  default order. It is a pure function and is unit-tested.

---

## 8. Authorization Rules

Two layers, both server-side:

1. **Entrypoint** — `src/app/admin/users/page.tsx` calls
   `requireAdminPageAccess('/admin/users')` (the shared admin gate), then
   `hasPermission(actor, toPermissionKey('user', 'read'))`. An anonymous visitor
   is redirected by the admin layout before the page's own gate runs. An
   authenticated actor with admin-area access but without `user.read` receives
   `notFound()` (404).
2. **Service** — `listUsersForAdmin` calls
   `requirePermission(actor, toPermissionKey('user', 'read'))` before the query
   runs, so an unauthorized actor can never reach the database. An anonymous
   actor raises `AuthenticationError` (401) and an authenticated actor without
   the permission raises `AuthorizationError` (403).

**D-026 — the 404 exception to `CONVENTIONS.md` §6.6.** §6.6 prefers `403` for a
permission failure on a known admin resource. `/admin/users` returns `404`
instead, extending the area-level rule Prompt 049 established (no admin-area
permission → 404) to a page-level permission inside it: an actor with `user.read`
but no `user.manage` sees the listing, and an actor with neither sees nothing at
all, so the page's existence is not advertised. The exception is scoped to the
admin area, no existing route's behavior changes, and no `forbidden.tsx` or
`experimental.authInterrupts` is introduced. A future admin page that gates on a
page-level permission follows the same rule; any deviation needs its own
decision. See `docs/decisions/DECISIONS.md` D-026.

The navigation entry is **not** the boundary: its `implemented` flag is flipped
to `true` only after the route and its guard exist, and a hidden entry never
grants access.

---

## 9. Query-Parameter Normalization — the Deviation from `CONVENTIONS.md` §6.4

§6.4 says an unknown field is a validation error. That rule governs **REST
responses**. An admin page is a navigable URL: a bookmarked link, a shared link, a
back-button navigation, or a hand-edited `pageSize` must render, not error.

Every query parameter of `parseAdminUsersQuery` therefore uses Zod `.catch(...)`
and falls back to a safe default. Unknown keys are stripped, so a stray
`utm_source` cannot break the page. Documented outcomes, all covered by unit
tests:

| Input                                        | Result                                     |
| -------------------------------------------- | ------------------------------------------ |
| `?page=-3` or `?page=abc`                    | page 1                                     |
| `?pageSize=500` or `?pageSize=0`             | 20                                         |
| `?sort=password`                             | `-createdAt` (default sort)                |
| `?sort=password,email`                       | `email` (first recognized column)          |
| `?status=bogus` or `?superAdmin=maybe`       | no filter (`null`)                         |
| `?q=<500 characters>`                        | empty search term                          |
| `?utm_source=newsletter`                     | ignored                                    |

**The allowlist is still enforced.** An unrecognized *sort column* is replaced by
the default sort rather than reaching SQL; `buildSortColumn` in
`src/modules/auth/repository.ts` resolves the parsed enum through a fixed switch
and throws for anything else. Normalization replaces the value; it never widens
what the query accepts.

---

## 10. The Contract Duplication and the Test That Keeps It in Step

`src/lib/contracts/table.ts` owns the parameter names and the page-size bounds.
A domain module may not import `lib` (`ARCHITECTURE.md` §7), so
`src/modules/users/validation.ts` re-declares the same bounds and the same
status and sort unions:

- `DEFAULT_PAGE_SIZE = 20` / `MAX_PAGE_SIZE = 100` mirror
  `DEFAULT_TABLE_PAGE_SIZE` / `MAX_TABLE_PAGE_SIZE`.
- `ADMIN_USER_STATUSES` and `ADMIN_USER_SORT_FIELDS` mirror the auth module's
  `USER_ACCOUNT_STATUSES` and `USER_ACCOUNT_SORT_FIELDS`, derived from them with
  a **type-only** import so the two cannot drift and the unit test never loads
  the auth module's `server-only` index.

The duplication is deliberate and is guarded by tests:
`tests/unit/lib/table-contract.test.ts` pins the shared constants, and
`tests/unit/modules/users/admin-users-query.test.ts` asserts that the module's
statuses and sort fields match the auth module's unions and that its parsed
page-size bounds equal `DEFAULT_TABLE_PAGE_SIZE` and `MAX_TABLE_PAGE_SIZE`.

**Consequence for a future change:** editing `DEFAULT_TABLE_PAGE_SIZE` or
`MAX_TABLE_PAGE_SIZE` in one place without the other fails the test suite. Update
both, and update this paragraph if the shared set ever changes.

---

## 11. The Supporting Index and What It Does Not Serve

`drizzle/0003_needy_infant_terrible.sql` adds exactly one index:

```sql
CREATE INDEX "idx_users_active_created_at" ON "users" USING btree ("created_at" DESC NULLS LAST) WHERE "users"."deleted_at" is null;
```

| Serves                                                            | Does not serve                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| The default scope `deleted_at IS NULL` (the index predicate), used when `status` is absent, `active`, or `deactivated` | The `deleted` filter — its predicate `deleted_at IS NOT NULL` is the complement of the index predicate |
| The default sort `created_at DESC`                                | The free-text search, which remains an `ILIKE` scan over `name` and `email` |

The `active`, `deactivated`, and `superAdmin` predicates are residual filters
evaluated after the scan; the index does not cover them, and no index is added
for them in this prompt.

Two known limitations, recorded rather than hidden:

1. **The `CREATE INDEX` is not `CONCURRENTLY`.** Applying the migration takes a
   brief write lock on `users` while the index builds. The table is small today;
   a future deployment that cannot tolerate the lock needs a reviewed
   `CONCURRENTLY` follow-up.
2. **The index covers `created_at DESC` only.** The default sort is
   `ORDER BY created_at DESC, id ASC`, so a sort step remains for rows with tied
   `created_at` values.

Measured `EXPLAIN (ANALYZE, BUFFERS)` plans for every filter combination are
recorded in `docs/development/DATABASE.md` §6.1. On the small test table the
planner chose a sequential scan for all four cases; the plans record the access
path and estimated cost, not a claim that the index is used at today's data
volume.

---

## 12. The Reference Page — `/admin/users`

`src/app/admin/users/page.tsx` is a Server Component with
`export const dynamic = 'force-dynamic'` (the listing is per-actor and
per-request). It awaits `searchParams` (Next.js 15+ async search params),
resolves the actor, gates on `user.read`, parses the query, calls
`listUsersForAdmin`, and renders the heading, toolbar, table, and pagination bar.
The page never touches a repository or the database directly
(`ARCHITECTURE.md` §9.1).

- **Loading state** — `loading.tsx` renders `AdminTableSkeleton` inside the admin
  shell so a slow query shows the table's shape rather than a blank page. It is
  the only loading state; the table component has no loading prop, because a
  server-rendered table is never in a loading state.
- **Error state** — `error.tsx` is a Client Component (Next.js requirement) and
  renders `AdminTableError` with a `RetryButton` whose action calls the `reset`
  prop Next.js provides.
- **Empty state** — one message with two variants: when a search term or filter
  is active it says no account matched the current search and filters (the
  toolbar's "Clear filters" link removes them); otherwise it says no accounts
  exist yet. The default scope excludes deleted accounts, so the second message
  is scoped to it and the `Deleted` filter reveals anything that is only in the
  trash.

### 12.1 Known limitation — the sign-in callback of the admin layout

`src/app/admin/layout.tsx` passes the literal `/admin` to the access gate, and a
server layout cannot read its own pathname, so an anonymous visitor to any admin
route — including `/admin/users` — is redirected with
`callbackUrl=%2Fadmin` rather than the deep-linked path. `buildAdminSignInUrl`
already encodes a full path when it is given one, so the limitation belongs to
the admin shell, not to this prompt. The follow-up (a middleware that records the
requested path, or a client-side redirect reading `usePathname()`) is an
admin-shell change and is recorded in `docs/development/admin-shell.md`.

---

## 13. Tests

| Area                          | File                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| Shared contract               | `tests/unit/lib/table-contract.test.ts`                              |
| Admin users query schema      | `tests/unit/modules/users/admin-users-query.test.ts`                 |
| Read model guard + projection | `tests/unit/modules/users/admin-users-read-model.test.ts`            |
| Table component               | `tests/unit/components/admin-data-table.test.tsx`                    |
| Toolbar                       | `tests/unit/components/admin-data-table-toolbar.test.tsx`            |
| Pagination                    | `tests/unit/components/admin-data-table-pagination.test.tsx`         |
| Page gate                     | `tests/unit/app/admin-users-page.test.tsx`                           |
| Real-database listing         | `tests/integration/users/admin-user-listing.integration.test.ts`     |
| E2E session seeder            | `tests/e2e/support/admin-session.mjs` (test-only, imported by no production code) |
| Browser workflow              | `tests/e2e/admin-users.spec.ts`                                      |
| Seeded session smoke          | `tests/e2e/admin-session.spec.ts`                                    |

The read-model test mocks the auth module's query at the module boundary, so the
module under test is not mocked. The browser tests seed a session through the
test-only helper, so the application performs its real session lookup,
account-status gate, actor resolution, and `user.read` check — nothing is mocked
in production paths.

---

## 14. Related Documents

- [Admin Shell](admin-shell.md)
- [State Components](state-components.md)
- [Confirmation Dialogs](confirmation-dialogs.md)
- [Testing Conventions](testing-conventions.md)
- [Coding Conventions](coding-conventions.md)
- [Database Conventions](DATABASE.md) — the index and the measured plans
- Decisions: `docs/decisions/DECISIONS.md` D-011, D-022, D-026
- Design: `docs/superpowers/specs/2026-11-12-admin-data-tables-design.md`
- Plan: `docs/superpowers/plans/2026-11-12-admin-data-tables.md`
