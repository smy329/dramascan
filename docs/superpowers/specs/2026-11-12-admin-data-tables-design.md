# Admin Data Tables (Prompt 051) — Design

**Status:** Proposed — awaiting approval
**Date:** 2026-11-12
**Requirement:** `docs/requirements/REQUIREMENTS.md` §8.1, §8.5; `CONVENTIONS.md` §6.3, §6.4, §5.4
**Builds on:** Prompt 049 (`2026-11-12-admin-layout-design.md`), Prompt 050 (`2026-11-12-admin-sidebar-breadcrumbs-design.md`)

## 1. Intent

The admin shell (Prompts 049–050) has navigation, breadcrumbs, and an access
gate, but no way to list a collection. Every future admin section — users,
reviews, dramas, movies — needs the same eight things: server-driven
pagination, sorting, search, filters, an empty state, a loading state, an error
state, and a rule that the browser never receives more than one page of rows.

This prompt builds that capability once as a reusable kit, then proves it with a
complete reference implementation: `/admin/users`.

Two things are deliberately **not** shared: the kit (client-safe UI) and the
domain query contract (module-owned validation) live in different layers because
the architecture forbids modules from importing `lib` and forbids components
from importing modules. The overlap between them is four constants and four
parameter names, and a unit test asserts the two agree.

## 2. Goals / Non-goals / Anti-goals

**Goals**

- A reusable admin table kit: generic table, toolbar (search + filters),
  pagination bar, loading skeleton, error state.
- A shared, typed table-state and pagination contract that future admin
  modules reuse verbatim.
- `/admin/users` as a complete reference implementation: real server-side
  pagination, search, sorting, and filtering over the `users` table.
- All table state in the URL, so it survives refresh, back/forward, and
  sharing.
- Only the current page of rows in the browser.
- Server-side authorization on the canonical `user.read` permission.
- A supporting index for the new production list query, and a verified query
  plan for every filter combination.

**Non-goals**

- No reviews, drama, or movie tables in this prompt.
- No row actions (deactivate/reactivate). The existing admin account routes are
  stubs, and wiring them would ship a control that reports success without
  changing anything.
- No client-side table state, no TanStack Query, no router-driven search, no
  REST endpoint for the listing.
- No new permission key, no new dependency, no `forbidden.tsx`, no
  `experimental.authInterrupts`.
- No speculative indexes: exactly one index is added, for the demonstrated
  access path.

**Anti-goals (failure even if tests pass)**

- Loading a whole collection and paginating in the browser.
- Accepting a client-supplied column name into SQL.
- Deriving Super Admin from a role name, a permission, or a query parameter.
- Hiding `/admin/users` from the navigation and leaving the route open.
- A component kit that only works for one table.

## 3. Constraints

- `CONVENTIONS.md` §6.3: page-based paging, `page` default 1, `pageSize` default
  20 / max 100, `meta` envelope, deterministic sort with a stable tiebreaker,
  and "Never load an entire collection into memory. Admin tables and public
  discovery use server-side pagination."
- `CONVENTIONS.md` §6.4: `sort` is an allowlist with `-` for descending, `q` is
  free text, filters are validated with Zod, no raw SQL fragments from clients.
- `CONVENTIONS.md` §5.4: "Every list query used in production has a supporting
  index, documented in `DATABASE.md`."
- `CONVENTIONS.md` §6.6: permission failures on known admin resources return
  403 — **except `/admin/users`**, see §6.9, recorded as D-026.
- `CONVENTIONS.md` §5.5: validation lives in the module's `validation.ts`.
- `ARCHITECTURE.md` §5.1: standard module file roles — `repository.ts` holds
  the Drizzle queries and may use the database client; `validation.ts` holds
  Zod schemas and parsers; `index.ts` re-exports only.
- `ARCHITECTURE.md` §7: `components` may import only `lib`/`lib/contracts`;
  modules may import only `platform` and lower-layer modules; `auth` may not
  import `authorization` (§7.2); a module may only import another module's
  `index.ts` (§7.2).
- `ARCHITECTURE.md` §8.1 / §8.4: `modules/users/read-models/` is the approved
  location for the admin user listing over the `auth` identity table (D-011).
- `ARCHITECTURE.md` §6.4: the `users` module's public API is `listUsersForAdmin`.
- `ARCHITECTURE.md` §9.1: a Server Component resolves the actor and calls module
  query services. It must not touch repositories or the DB.
- `AGENTS.md`: no mock data in production paths; a UI that renders is not a
  completed feature; server-side authorization is the security authority.

## 4. Decisions already made by you

| Decision | Choice |
| --- | --- |
| Scope | Kit **and** a wired `/admin/users` reference page |
| State location | URL query parameters, server-rendered; GET forms for search/filters, links for sort/pagination |
| Filters | Status (Active / Deactivated / Deleted), Super Admin (Yes / No), free-text `q` over name + email |
| Read model | All in `src/modules/users/read-models/admin-users.ts`, exported as `listUsersForAdmin` from the users module |
| Small screens | Column priority + horizontal-scroll fallback; no separate mobile card list |
| Unauthorized actor | `notFound()` (404) for an admin-area actor without `user.read` (recorded as D-026) |
| Supporting index | One reviewed migration: `users (created_at DESC) WHERE deleted_at IS NULL` |
| E2E authentication | Build a test-only session seeder so Playwright renders the real page |

## 5. Approaches considered

### 5.1 Where the admin user listing lives

- **A. Split — query in `auth`, guard in `users`.** The paged Drizzle query sits
  next to the table it reads; the `user.read` guard and the DTO projection sit
  in the users module. Honest about table ownership, but splits one feature
  across two modules and two public APIs, and needs `auth` to grow a public
  query API that exists only to serve the users module.
- **B. All in `users/read-models/` (chosen).** The read model, the guard, and
  the projection live together in the location D-011 §8.4 and
  `ARCHITECTURE.md` §6.4 already name for exactly this query. The read model
  reaches the `users` table through the auth module's public API, so no module
  imports another's `schema.ts` and the read-model exception stays limited to
  the one documented use case.
- **C. All in `users/queries.ts`.** Same as B without the `read-models/`
  folder. Rejected: D-011 §8.4 names `read-models/` specifically, and the
  moderation module already establishes the `read-models/` convention.

B is chosen: it matches the approved locations, keeps the feature in one file,
and keeps the auth module free of authorization.

### 5.2 How the read model reaches the `users` table

- **A. Import `@/modules/auth/schema` directly (rejected).** §8.1 forbids a
  module importing another module's `schema.ts`. `authorization/actors.ts` does
  this today as a pre-existing exception; this prompt must not add another.
- **B. Call the auth module's public API (chosen).** `src/modules/auth/index.ts`
  exports a paged identity query held in `src/modules/auth/repository.ts` —
  the file role §5.1 and the §17 database-access allowlist
  (`modules/*/repository*`) both prescribe. The auth module owns its table; the
  users module owns the admin projection and the authorization decision. The
  read model therefore performs **no** cross-module JOIN, so the D-011
  read-model exception is used for its stated purpose (a read-only projection
  over the auth identity table) and not for a join.

### 5.3 Server Component vs. client component for the table

Column definitions carry a `render: (row) => ReactNode` function. Functions
cannot cross the server/client boundary, so a client-rendered table would
force every cell to be pre-rendered strings and lose per-column formatting.

- **A. Server-rendered table (chosen).** The table, toolbar, and pagination bar
  are Server Components; the only client islands in the feature are the
  existing `RetryButton` in the error boundary.
- **B. Client-rendered table with a REST endpoint.** Rejected: it contradicts
  the chosen URL-driven model, adds a second contract to keep in sync with
  `API.md`, and ships JavaScript for a table that has no interactivity beyond
  links and GET forms.

Consequence of A: `src/components/ui/table.tsx` currently carries
`'use client'` although it holds no state, no hooks, and no event handlers.
The directive is removed so the vendored primitive can render inside a Server
Component, matching `button.tsx`, `input.tsx`, and `card.tsx`, which are
already server-safe. The file is otherwise untouched, and it has no call sites
today.

### 5.4 Invalid query parameters

- **A. Reject with a validation error (rejected for this route).** The REST
  contract does this, but a bookmarked or hand-edited admin URL would then
  produce an error page.
- **B. Normalize (chosen).** Every query parameter is validated with Zod and
  falls back to a safe default. The sortable-column allowlist is still
  enforced server-side, so an unrecognized column can never reach SQL — it is
  replaced by the default sort rather than erroring.

**Documented deviation from `CONVENTIONS.md` §6.4**, which says an unknown
field is a validation error: §6.4 governs REST responses. An admin page is a
navigable URL, and a stray `utm_source` or a hand-edited `pageSize` must not
produce an error page. The allowlist is still enforced — an unknown *sort
column* is replaced by the default sort rather than reaching SQL — and the
deviation is recorded in `docs/development/admin-data-tables.md` and in D-026.

### 5.5 Row actions

`/admin/users` has no Actions column in this prompt.

- **A. Wire the existing admin account routes (rejected).**
  `/admin/api/users?action=deactivate-admin` calls a stub that returns
  `{ success: true }` without changing anything. A button that reports success
  without deactivating an account is a fake feature.
- **B. Implement real account management (out of scope).** The `users` module
  owns `deactivateUser`/`reactivateUser` and D-005 requires a mandatory
  security notification on deactivation. That is a separate prompt.
- **C. Kit supports Actions; the reference page omits it (chosen).** The kit
  accepts an Actions column with always-visible priority and a caller-supplied
  renderer; `/admin/users` renders four content columns and no Actions column.

**Deviation from your request, flagged:** you listed Actions among the
always-visible columns for `/admin/users`. It is omitted here for the reason in
§5.5A. The kit supports it; adding the column to the page is a one-line change
once a real account action exists. Say the word if you want the column present
with the stub endpoints behind it.

### 5.6 The supporting index

- **A. Add one partial index (chosen).** `users (created_at DESC) WHERE
  deleted_at IS NULL`. It matches the default listing scope and the default
  sort, so the default admin page view is an index scan rather than a
  sequential scan plus sort.
- **B. Add indexes for every filter combination (rejected).** A separate index
  per status would multiply write cost for a table that is written far less
  often than it is read, and would be speculative without query-plan evidence.
- **C. No index (rejected).** `CONVENTIONS.md` §5.4 requires a supporting index
  for every production list query.

The `deleted` filter (`deleted_at IS NOT NULL`) is deliberately **not** covered
by the partial index and stays a sequential scan over the (small) deleted set.
§6.8 records the measured plan for each filter rather than claiming coverage
that does not exist.

## 6. Detailed design

### 6.1 Shared table-state contract — `src/lib/contracts/table.ts` (new)

Client-safe, isomorphic, no framework imports. Used by the component kit and by
the app layer. It is **not** imported by modules (the architecture forbids it).

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
  page: number;
  pageSize: number;
  sort: string;              // e.g. '-createdAt'
  search: string;            // '' when absent
  filters: Readonly<Record<string, string>>;  // '' means "no filter"
}>;

export function buildTableHref(
  pathname: string,
  state: TableQueryState,
  overrides?: Partial<TableQueryState>
): string;
```

`buildTableHref` rules:

- `sort` and `pageSize` are always emitted (the table's configuration is
  explicit in the URL, so a shared link reproduces the view exactly).
- `page` is emitted only when greater than 1.
- `q` is emitted only when non-empty.
- A filter is emitted only when its value is non-empty.
- `overrides` replaces the named fields; `filters` is replaced wholesale, not
  merged, so a caller that wants to drop one filter must pass the rest.

`buildTableHref` is pure and has no default values: callers pass the state they
want. This keeps "reset to page 1" an explicit, visible decision at each call
site rather than hidden magic.

### 6.2 The admin table kit — `src/components/admin/data-table/` (new)

No `index.ts` barrel (CONVENTIONS §2.2); direct imports only. No module
imports. No data fetching.

| File | Exports | Boundary |
| --- | --- | --- |
| `types.ts` | `AdminTableColumn<T>`, `AdminTableFilterField`, `AdminTableFilterOption`, `AdminTableColumnVisibility` | Shared |
| `data-table.tsx` | `AdminDataTable<T>` | Server |
| `data-table-toolbar.tsx` | `AdminTableToolbar` | Server |
| `data-table-pagination.tsx` | `AdminTablePagination` | Server |
| `data-table-skeleton.tsx` | `AdminTableSkeleton` | Server |
| `data-table-error.tsx` | `AdminTableError` | Server |

File names use kebab-case, matching the existing `src/components/states/` and
`src/components/admin/` files rather than the PascalCase example in
`CONVENTIONS.md` §2.2; practice in this repository is uniform and renaming is
out of scope.

**`AdminTableColumn<T>`**

```ts
export type AdminTableColumnVisibility = 'always' | 'sm' | 'md' | 'lg';

export type AdminTableColumn<T> = Readonly<{
  key: string;
  header: string;
  /** Set to make the column sortable. The value is the sort token. */
  sortKey?: string;
  align?: 'left' | 'center' | 'right';
  /** Responsive priority. 'always' keeps the column at every width. */
  visibility?: AdminTableColumnVisibility;   // default 'always'
  headerClassName?: string;
  cellClassName?: string;
  render: (row: T) => ReactNode;
}>;
```

**`AdminDataTable<T>`** props: `caption`, `captionClassName`, `columns`,
`rows`, `rowKey`, `pathname`, `state`, `empty` (optional `ReactNode`),
`emptyIcon`, `className`.

Rendering:

- A `<Table>` from `src/components/ui/table.tsx` (no `'use client'` after
  §5.3), inside the primitive's own `overflow-x-auto` container.
- `<caption>` describes the table for assistive technology; it is visible by
  default and can be visually hidden by the caller through `captionClassName`.
- A sortable column renders `<th scope="col" aria-sort="…">` containing a
  `<Link>` to the same table with the sort token flipped. The currently sorted
  column gets `aria-sort="ascending"` or `"descending"`; every other sortable
  column gets `aria-sort="none"`. The link's accessible name states the
  current order and the action, so a screen reader announces both.
- `rows.length === 0` renders the empty state instead of a table body.
- The table never renders a second copy of the row data for small screens.

**`AdminTableToolbar`** props: `pathname`, `state`, `searchLabel`,
`searchPlaceholder`, `filters` (`readonly AdminTableFilterField[]`),
`clearHref`, `className`.

- The **search form** is a GET form to `pathname`. It carries hidden inputs for
  the current `sort`, `pageSize`, and every active filter, so submitting a new
  search preserves the rest of the table's state. It carries **no** `page`
  input, so a search always resets to page 1.
- The **filter form** is a GET form to `pathname` with one `<select>` per
  filter field, plus hidden inputs for the current `sort`, `pageSize`, and `q`.
  An "All" option has the empty value, which the parser normalizes to "no
  filter". Again no `page` input, so applying a filter resets to page 1.
- The **clear link** is a `<Link>` to the same path with the search term and
  every filter removed, keeping the current sort and page size. It is rendered
  only when a search term or a filter is active.

**`AdminTablePagination`** props: `pathname`, `state`, `total`, `totalPages`,
`itemLabel` (e.g. `"users"`), `pageSizeOptions`, `className`. The current page
and page size come from `state`, so there is one source of truth.

- A summary line: `"Showing 21–40 of 137 users"`, or `"No users"` when the
  total is 0.
- Previous / Next links. On the first and last page they render as disabled
  `<span>`s, not links, so there is no dead link and no `aria-disabled` link
  to activate.
- A numbered window around the current page, with ellipses for the gaps. The
  window is a pure function and is unit-tested.
- A page-size form: a GET form with a `<select name="pageSize">` and hidden
  inputs for `sort`, `q`, and the active filters, and no `page` input, so
  changing the page size resets to page 1.

**`AdminTableSkeleton`** renders a `SkeletonGroup` (one polite announcement)
containing one skeleton row per visible column, so the loading layout matches
the loaded layout and the page does not jump.

**`AdminTableError`** wraps the existing `RetryState` with a "Could not load
{label}" heading and a retry action slot. It adds no new primitive.

### 6.3 Responsive column priority

`visibility` maps to Tailwind classes on both the header cell and the body
cells:

| `visibility` | Classes | Visible from |
| --- | --- | --- |
| `always` | — | every width |
| `sm` | `hidden sm:table-cell` | 640px |
| `md` | `hidden md:table-cell` | 768px |
| `lg` | `hidden lg:table-cell` | 1024px |

The table sits in the vendored primitive's `relative w-full overflow-x-auto`
container, so when the remaining columns still exceed the available width the
table scrolls inside the container instead of stretching the page. The page
container also carries `min-w-0` so the scroll container can shrink.

Column priorities for `/admin/users`:

| Column | Sort key | Visibility |
| --- | --- | --- |
| Name | `name` | `always` |
| Email | `email` | `sm` |
| Status | — | `always` |
| Super Admin | — | `md` |
| Created | `createdAt` | `lg` |
| Actions | — | `always` (kit support; not rendered by this page — §5.5) |

At 390px the table shows Name, Status, and Actions. At 640px it adds Email, at
768px Super Admin, at 1024px Created.

### 6.4 Server-side query path

```
/admin/users?page=2&pageSize=20&sort=-createdAt&q=lee&status=active&superAdmin=yes
  └─ page.tsx (Server Component)
       ├─ requireAdminPageAccess('/admin/users')      → redirect | 404 | actor
       ├─ hasPermission(actor, 'user.read')           → notFound() when false
       ├─ parseAdminUsersQuery(searchParams)          → validated AdminUsersQuery
       └─ listUsersForAdmin(actor, query)             → users module public API
            ├─ requirePermission(actor, 'user.read')  → service guard
            ├─ listUserAccounts(query)                → auth module public API
            │    ├─ SELECT … WHERE <filters> ORDER BY <sort>, id LIMIT/OFFSET
            │    └─ SELECT count(*) WHERE <filters>
            └─ project rows → AdminUserListItem[]
```

**`src/modules/auth/repository.ts` (new)** — the auth module's paged identity
query over its own table. It holds the Drizzle access, which §5.1 and §17
confine to `repository*` and `read-models*` files.

```ts
export const USER_ACCOUNT_STATUSES = ['active', 'deactivated', 'deleted'] as const;
export type UserAccountStatus = (typeof USER_ACCOUNT_STATUSES)[number];

export type UserAccountSortField = 'name' | 'email' | 'createdAt' | 'updatedAt';

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

export type UserAccountPage = { rows: UserAccountRow[]; total: number };

export async function listUserAccounts(query: ListUserAccountsQuery): Promise<UserAccountPage>;
```

**Documented deviation from `ARCHITECTURE.md` §5.4** ("every exported
mutation and protected query takes `actor: ActorContext` as its first
argument"): the auth module may not import the authorization module
(`ARCHITECTURE.md` §7.2, D-008), so it cannot even name the `ActorContext`
type. The *protected* query is `listUsersForAdmin(actor, query)` in the users
module, which does take the actor and does enforce `user.read` before the
query runs. `listUserAccounts` is a lower-level identity accessor, reachable
only through the auth module's public API and never called without the
authorization check that precedes it.

`src/modules/auth/index.ts` (new) is the auth module's public API and exports
`listUserAccounts` and its types. It imports `server-only` (§11.4).
`docs/architecture/ARCHITECTURE.md` §6.1 is updated with the new public API
entry.

**`src/modules/users/validation.ts` (new)** — Zod schema and parser, in the
file role `CONVENTIONS.md` §5.5 and `ARCHITECTURE.md` §5.1 prescribe. No
database, no `server-only`, so it is unit-testable without PostgreSQL.

```ts
export const ADMIN_USER_STATUSES = ['active', 'deactivated', 'deleted'] as const;
export type AdminUserStatus = (typeof ADMIN_USER_STATUSES)[number];

export const ADMIN_USER_SORT_FIELDS = ['name', 'email', 'createdAt', 'updatedAt'] as const;
export type AdminUserSortField = (typeof ADMIN_USER_SORT_FIELDS)[number];

export const adminUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(1).max(100).catch(20),
  sort: z.string().max(32).catch('-createdAt'),
  q: z.string().trim().max(200).catch(''),
  status: z.enum(ADMIN_USER_STATUSES).optional().catch(undefined),
  superAdmin: z.enum(['yes', 'no']).optional().catch(undefined),
});
```

Every field uses `.catch(...)` so an invalid value normalizes instead of
throwing (§5.4). Unknown keys are stripped, so a stray `utm_source` cannot
break the page. The schema resolves the sort token into `sortBy` +
`sortDirection` and replaces a column outside the allowlist with the default.
`status` and `superAdmin` normalize to `undefined`, which the query treats as
"no filter" — not as `active`.

The status and sort unions are **not** re-declared: `validation.ts` derives
them from the auth module's public API with a **type-only** import
(`import type { UserAccountStatus } from '@/modules/auth'`). A type-only import
is erased at compile time, so the unit test never loads the auth module's
`server-only` index, and the two modules cannot drift.

Normalization outcomes, all covered by unit tests: a `pageSize` above the
maximum falls back to 20; a search term longer than 200 characters is
discarded; an unknown sort column, status, or Super Admin value falls back to
its default or to "no filter".

The module declares its own `DEFAULT_PAGE_SIZE` and `MAX_PAGE_SIZE` constants,
because a module may not import `lib`. A unit test asserts that they equal
`DEFAULT_TABLE_PAGE_SIZE` and `MAX_TABLE_PAGE_SIZE` in
`src/lib/contracts/table.ts`, so the two contracts cannot drift.

**`src/modules/users/read-models/admin-users.ts` (new)** — the read model.

```ts
export type AdminUserListItem = {
  id: string;
  name: string;
  email: string;
  status: AdminUserStatus;
  isSuperAdmin: boolean;
  createdAt: string;   // ISO 8601 UTC
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

export async function listUsersForAdmin(
  actor: ActorContext,
  query: AdminUsersQuery
): Promise<AdminUserListResult>;
```

- `requirePermission(actor, toPermissionKey('user', 'read'))` runs first, so
  the query is never executed for an unauthorized actor.
- The rows come from `listUserAccounts` in `@/modules/auth`.
- `totalPages` is `total === 0 ? 0 : Math.ceil(total / pageSize)`, matching
  the existing `listInformationPages` implementation and the `meta` envelope in
  `src/lib/contracts/common.ts`, so the shared `PaginationMeta` shape and the
  reference implementation agree.
- `status` is derived with deleted-first precedence (§6.7).

`src/modules/users/index.ts` (new) is the users module's public API and exports
`listUsersForAdmin`, the parser, and the types. It imports `server-only`.

### 6.5 URL query-state contract

| Parameter | Accepted values | Default | Effect |
| --- | --- | --- | --- |
| `page` | integer ≥ 1 | `1` | 1-based page index |
| `pageSize` | integer 1–100 | `20` | rows per page; the UI offers 20 / 50 / 100 |
| `sort` | `name`, `email`, `createdAt`, `updatedAt`, each optionally `-` prefixed | `-createdAt` | sort column and direction |
| `q` | free text, trimmed, ≤ 200 characters | absent | case-insensitive match on name **or** email |
| `status` | `active`, `deactivated`, `deleted` | absent | account status filter |
| `superAdmin` | `yes`, `no` | absent | Super Admin filter |

Rules:

- An absent or unrecognized value falls back to the default; the request is
  never rejected for a malformed parameter.
- The kit sorts by a single column. The parser tolerates the
  `CONVENTIONS.md` §6.4 comma-separated form by using the first recognized
  column, so the format stays forward-compatible, but the kit never emits more
  than one column and never renders two sorted columns at once.
- Search and filter changes reset to page 1. **Sort changes also reset to page
  1** — the current page index may not exist in the new ordering, and a
  silently empty page is worse than returning to the first page. This is my
  call; say so if you would rather keep the page number.
- Sorting, paging, searching, and filtering all preserve every other
  parameter, so a filter survives a sort and a page change.
- The URL is shareable: copying it reproduces the exact view.
- The flash parameters the existing admin account routes redirect with
  (`?authorized=true`, `?deactivated=true`, `?reactivate=true`) are **ignored**
  by this page. Those routes are stubs; the flash parameters become meaningful
  in the account-management prompt.

### 6.6 Status filter and precedence

The three statuses are a strict partition, and deleted wins:

| `status` | SQL predicate |
| --- | --- |
| absent | `deleted_at IS NULL` |
| `active` | `deleted_at IS NULL AND is_active = true` |
| `deactivated` | `deleted_at IS NULL AND is_active = false` |
| `deleted` | `deleted_at IS NOT NULL` |

- Soft-deleted users are visible **only** when `status=deleted`. The default
  scope excludes them, and selecting `deleted` must not be silently reduced to
  the default scope.
- A deleted user is never reported as active or deactivated, even when
  `is_active` is still `true` in the row. The projection derives the status as
  `deletedAt !== null ? 'deleted' : isActive ? 'active' : 'deactivated'`.
- `superAdmin` is applied with `AND`, so the two filters combine correctly.
- `is_super_admin` is the authoritative Super Admin definition (D-022). The
  filter reads the column; it is never inferred from a role name, a permission,
  or a query parameter.

### 6.7 Sorting and the tiebreaker

- Allowlist: `name`, `email`, `createdAt`, `updatedAt`. The value is chosen
  through a fixed map, never interpolated from the request.
- Every query appends `id` as the final sort key, so the ordering is a total
  order and paging cannot repeat or skip a row when the primary key ties.
- `id` is UUIDv7, so it is time-ordered and the tiebreaker is also stable in
  practice.
- The search term is matched with `ILIKE` against `name` and `email`. `%`, `_`,
  and `\` in the term are escaped, so a search for `100%` does not act as a
  wildcard.

### 6.8 The supporting index and query plans

**Migration.** One reviewed Drizzle migration adds:

```sql
CREATE INDEX idx_users_active_created_at
  ON users (created_at DESC)
  WHERE deleted_at IS NULL;
```

with the matching definition in `src/modules/auth/schema.ts`. The migration is
generated with `npm run db:generate` and applied with `npm run db:migrate`.
`drizzle-kit push` is never used, and the production database is not touched.

**Scope of the index.** The predicate `deleted_at IS NULL` matches the default
listing scope, and `created_at DESC` matches the default sort. The index does
**not** serve the `deleted` filter (`deleted_at IS NOT NULL`), which stays a
sequential scan over the deleted subset, and it does not serve the free-text
search, which is an `ILIKE` scan. Neither is claimed as covered.

**Plan verification.** `EXPLAIN (ANALYZE, BUFFERS)` is run against the
isolated test database for each filter — absent, `active`, `deactivated`,
`deleted` — and for the default and name sorts, with the recorded plan and
buffer counts written into `docs/development/DATABASE.md`. If the plan shows
the index is not used where it should be, the query is corrected rather than
the claim softened.

**Documentation.** `docs/development/DATABASE.md` records the index, its
purpose, the queries it serves, and the queries it does not serve.

### 6.9 Authorization

Two layers, both server-side:

1. **Entrypoint.** `requireAdminPageAccess('/admin/users')` redirects anonymous
   visitors to `/auth/signin?callbackUrl=%2Fadmin` and returns 404 for
   authenticated actors without admin-area access. Then
   `hasPermission(actor, toPermissionKey('user', 'read'))` gates the listing:
   an admin-area actor without `user.read` receives `notFound()`.
2. **Service.** `listUsersForAdmin` calls
   `requirePermission(actor, toPermissionKey('user', 'read'))` before the query
   runs. An anonymous actor raises `AuthenticationError` (401) and an
   authenticated actor without the permission raises `AuthorizationError` (403).

**D-026 — 404 for a page-level permission failure in the admin area.**
`CONVENTIONS.md` §6.6 prefers 403 for a permission failure on a known admin
resource. `/admin/users` returns 404 instead, extending the rule Prompt 049
already established for the admin *area* (no admin-area permission → 404) to a
page-level permission inside it: an actor with `user.read` but no
`user.manage` sees the listing, and an actor with neither sees nothing at all,
so the page's existence is not advertised. The exception is scoped to
`/admin/users`; no existing route's behavior changes. A future admin page that
gates on a page-level permission follows the same rule, and any deviation needs
its own decision.

The navigation entry is **not** the boundary: it is flipped to
`implemented: true` only after the route and its guard exist, and a hidden
entry never grants access.

### 6.10 The page, its loading state, and its error state

**`src/app/admin/users/page.tsx`** — a Server Component.

- `export const dynamic = 'force-dynamic'` (the listing is per-actor and
  per-request).
- `searchParams` is awaited (Next.js 15+ async search params).
- Renders the heading, the toolbar, the table, and the pagination bar.
- The empty state is one component with two messages: when a search term or a
  filter is active it says no account matched and offers a "Clear filters"
  action; otherwise it says no accounts exist yet. The default scope excludes
  deleted accounts, so the second message is scoped to the default scope and
  the `Deleted` filter reveals anything that is only in the trash.

**`src/app/admin/users/loading.tsx`** — renders `AdminTableSkeleton` inside
the admin shell, so a slow query shows the table's shape rather than a blank
page. It is the only loading state; the table component itself has no loading
prop, because a server-rendered table is never in a loading state.

**`src/app/admin/users/error.tsx`** — a Client Component (Next.js requirement).
It renders `AdminTableError` with a `RetryButton` whose action calls the
`reset` prop Next.js provides.

### 6.11 Navigation

`src/components/admin/navigation.ts`: the `users` entry's `implemented` flag
becomes `true`, after the route exists. Its permissions stay `['user.read',
'user.manage']`. Nothing else in the navigation model changes.

### 6.12 Test-only session seeder

The E2E harness currently has no way to be signed in, so no authenticated admin
flow has ever been verified in a browser. This prompt adds a seeder so the real
page is exercised.

**`tests/e2e/support/admin-session.mjs` (new)**

- Connects to the test database **only after** verifying that the database name
  ends in `_test` and differs from `DATABASE_URL`. It fails closed, reusing
  the checks in `tests/e2e/support/database-target.mjs` rather than
  re-implementing them.
- Inserts a Super Admin user (`is_active = true`, `is_super_admin = true`) and
  a session row with the raw token.
- Signs the session cookie with Better Auth's own `makeSignature` from
  `better-auth/crypto`, so the application accepts it through its real
  session validation. The installed Better Auth version is inspected first and
  the exact cookie name and signature format are confirmed against it rather
  than assumed.
- Nothing is mocked or bypassed: the real session lookup, the real
  `getActiveSession` gate, the real actor resolution, and the real
  `requirePermission` guard all run.
- Only the records it created are removed, by id. No table is truncated and no
  database-wide cleanup runs.
- It lives entirely under `tests/`, is imported by no production code, and
  cannot be reached from a build.

**Cost.** Roughly a hundred lines of E2E support code. It is the only way the
deliverable — a rendered admin table — is verified in a real browser, and it
also unlocks the responsive checks and the horizontal-overflow measurement.

### 6.13 Documentation

- `docs/development/admin-data-tables.md` — the kit, the column-priority API,
  the URL query-state contract, the filter and sort semantics, the
  authorization rules, the §6.4 and §6.6 deviations, and the index.
- `docs/development/DATABASE.md` — the new index, the queries it serves, and
  the measured plans.
- `docs/decisions/DECISIONS.md` — **D-026**: the admin page-level permission
  exception (404), the §6.4 normalization deviation for admin pages, and the
  supporting-index decision.
- `docs/architecture/ARCHITECTURE.md` §6.1 — the auth module's new public API
  entry.
- `docs/architecture/module-architecture.md` — the auth repository query and
  the users read model.
- `docs/development/CONVENTIONS.md` — pointers to D-026.
- `docs/README.md` — quick link.
- `docs/CHANGELOG.md`, `docs/PROJECT_STATUS.md` — the prompt row and the
  change log.

## 7. Files affected

### New

| File | Purpose |
| --- | --- |
| `src/lib/contracts/table.ts` | Shared table-state contract and URL builder |
| `src/components/admin/data-table/types.ts` | Column, filter, and visibility types |
| `src/components/admin/data-table/data-table.tsx` | Generic table with sortable headers and empty state |
| `src/components/admin/data-table/data-table-toolbar.tsx` | Search form, filter form, clear link |
| `src/components/admin/data-table/data-table-pagination.tsx` | Summary, page window, page-size form |
| `src/components/admin/data-table/data-table-skeleton.tsx` | Loading skeleton |
| `src/components/admin/data-table/data-table-error.tsx` | Error state |
| `src/modules/auth/repository.ts` | Auth-owned paged identity query |
| `src/modules/auth/index.ts` | Auth module public API |
| `src/modules/users/validation.ts` | Admin users query schema and parser |
| `src/modules/users/read-models/admin-users.ts` | Read model: guard, query, projection |
| `src/modules/users/index.ts` | Users module public API |
| `src/app/admin/users/page.tsx` | The admin users page |
| `src/app/admin/users/loading.tsx` | Route loading state |
| `src/app/admin/users/error.tsx` | Route error boundary |
| `drizzle/0003_*.sql` | The partial index migration |
| `tests/e2e/support/admin-session.mjs` | Test-only session seeder |
| `tests/unit/lib/table-contract.test.ts` | Shared contract |
| `tests/unit/modules/users/admin-users-query.test.ts` | Query schema |
| `tests/unit/modules/users/admin-users-read-model.test.ts` | Guard and projection |
| `tests/unit/components/admin-data-table.test.tsx` | Table, sorting, empty state, responsive classes |
| `tests/unit/components/admin-data-table-toolbar.test.tsx` | Search and filter forms |
| `tests/unit/components/admin-data-table-pagination.test.tsx` | Pagination links and window |
| `tests/unit/app/admin-users-page.test.tsx` | Page gate |
| `tests/integration/users/admin-user-listing.integration.test.ts` | Real-database listing behaviour |
| `tests/e2e/admin-users.spec.ts` | Browser workflow and responsive checks |
| `docs/development/admin-data-tables.md` | Kit and URL contract documentation |

### Modified

| File | Change |
| --- | --- |
| `src/components/ui/table.tsx` | Remove `'use client'` so the primitive renders in a Server Component (§5.3) |
| `src/modules/auth/schema.ts` | Add the partial index definition |
| `src/components/admin/navigation.ts` | `users` entry becomes `implemented: true` |
| `docs/README.md` | Quick link to the new document |
| `docs/architecture/ARCHITECTURE.md` | Auth module public API (§6.1) |
| `docs/architecture/module-architecture.md` | Auth repository query; users read model |
| `docs/development/CONVENTIONS.md` | Pointers to D-026 |
| `docs/development/DATABASE.md` | The index and the measured plans |
| `docs/decisions/DECISIONS.md` | D-026 |
| `docs/CHANGELOG.md`, `docs/PROJECT_STATUS.md` | Prompt 051 record |

## 8. Expected behavior

- `/admin/users` with a Super Admin session renders the users table with at
  most `pageSize` rows.
- `?page=2` shows the second page; `?pageSize=50` shows fifty rows;
  `?sort=name` sorts by name ascending; `?sort=-email` by email descending.
- `?q=lee` matches users whose name **or** email contains `lee`,
  case-insensitively.
- `?status=deactivated` shows only accounts that are inactive and not
  deleted. `?status=deleted` shows only soft-deleted accounts, including ones
  whose `is_active` is still true. `?status=active&superAdmin=yes` shows only
  active Super Admins.
- Filters and the search term survive a sort and a page change. Changing a
  filter or the search term returns to page 1.
- An unknown `sort` column, a `pageSize` above 100, a negative `page`, or an
  unknown `status` never produces an error: the value is replaced by its
  default.
- The browser receives one page of rows and nothing else. The response does
  not contain the whole `users` collection.
- An anonymous visitor is redirected to `/auth/signin?callbackUrl=%2Fadmin`.
  The admin **layout** performs that redirect before the page's own gate runs,
  and a server layout cannot read its own pathname, so the callback is always
  the layout's `/admin` rather than the deep-linked `/admin/users`. This is the
  admin shell's existing behavior from Prompt 049, not something this prompt
  changes; `buildAdminSignInUrl` already encodes a full path when it is given
  one. See §10 for the limitation and its follow-up.
- An authenticated actor with admin-area access but without `user.read`
  receives a 404.
- An actor with `user.read` but no `user.manage` sees the listing and no
  account-management controls.
- The table shows Name, Status, and Actions at 390px; Email appears at 640px;
  Super Admin at 768px; Created at 1024px. The page itself never scrolls
  horizontally.

## 9. Test plan

**Unit — shared contract** (`tests/unit/lib/table-contract.test.ts`): href
construction for every parameter, omission of empty values, override
semantics, and the guarantee that filters survive a sort or page change.

**Unit — query schema** (`tests/unit/modules/users/admin-users-query.test.ts`):
defaults, clamping, unknown sort columns, unknown statuses, `q` trimming and
length, and an assertion that the schema's defaults and bounds equal the
shared contract's constants.

**Unit — read model** (`tests/unit/modules/users/admin-users-read-model.test.ts`):
anonymous → `AuthenticationError`; authenticated without `user.read` →
`AuthorizationError`; permitted → projected rows; deleted-first status
precedence; the total count and page metadata. The auth module's query is
mocked at the module boundary, so the module under test is not mocked.

**Unit — components** (`tests/unit/components/admin-data-table*.test.tsx`):
column rendering, `aria-sort` on the sorted column and `none` elsewhere, the
sort link's target URL, the empty state, the skeleton's single announcement,
the error state, the toolbar's hidden state-preserving inputs and its
reset-to-page-1 behaviour, the pagination window, the disabled previous/next
spans, and the responsive visibility classes.

**Unit — page gate** (`tests/unit/app/admin-users-page.test.tsx`): an actor
with `user.read` reaches the listing; an admin-area actor without `user.read`
gets the not-found behaviour; an anonymous actor is redirected.

**Integration** (`tests/integration/users/admin-user-listing.integration.test.ts`,
against `TEST_DATABASE_URL`): real rows for search, each filter
independently, combined filters, deleted-user visibility, Super Admin
classification, stable sorting with the tiebreaker, and the total count across
pages.

**Index and plans** (manual, recorded in `DATABASE.md`): `EXPLAIN (ANALYZE,
BUFFERS)` for the absent, `active`, `deactivated`, and `deleted` filters and
for the default and name sorts, against the migrated test database.

**End-to-end** (`tests/e2e/admin-users.spec.ts`), using the session seeder:
the anonymous redirect and its callback URL; an authenticated Super Admin
session loading `/admin/users`; searching; applying each filter; combining
filters; sorting; paginating; the 404 for an actor without `user.read`;
responsive checks at 390px, 768px, and 1440px; and a horizontal-overflow
measurement asserting that the document does not scroll horizontally.

## 10. Out of scope

- Reviews, dramas, movies, categories, platforms, analytics, notifications, and
  settings tables.
- Account management actions (deactivate / reactivate) and their mandatory
  security notifications.
- A trigram index on `users.name` / `users.email`; the search remains an
  `ILIKE` scan until query-plan evidence justifies one.
- Cursor pagination.
- Any change to the global authorization response behavior.
- **Preserving a deep-linked admin path in the sign-in callback.** The admin
  layout redirects an anonymous visitor with `callbackUrl=%2Fadmin` because a
  server layout cannot read its own pathname; the page's own gate, which would
  use `/admin/users`, never runs for an anonymous visitor. `buildAdminSignInUrl`
  already encodes a full path when it is given one, so the fix belongs to the
  shell — either a middleware that records the requested path, or a client-side
  redirect that reads `usePathname()`. Either is an admin-shell change that
  deserves its own prompt, not a change this prompt makes incidentally.
