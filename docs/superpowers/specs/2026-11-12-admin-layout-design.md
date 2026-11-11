# Admin Layout — Design

**Prompt:** 049 — Build the Admin Layout
**Date:** 2026-11-12
**Status:** Proposed — awaiting approval

## 1. Intent

Create a separate, protected administration shell that later admin pages can
render inside. The shell provides a responsive sidebar, a sticky header with
breadcrumbs and an account menu, and a functional `/admin` overview page. It
shows only navigation the current administrator may use, but navigation
visibility is never the security boundary: the layout and page both resolve the
actor and enforce admin-area access server-side.

This prompt builds the shell, one landing page, and the pure logic behind them.
It does not build any future admin section, table, form, or database table.

## 2. Confirmed Decisions

| Decision            | Choice                                                                 |
| ------------------- | ---------------------------------------------------------------------- |
| Architecture        | A — Server layout + client shell                                        |
| Routes              | `src/app/admin/layout.tsx` and `src/app/admin/page.tsx` only            |
| Navigation          | Complete model centrally defined; only implemented routes render        |
| Implemented now     | Dashboard group with the `/admin` overview entry                        |
| Group permissions   | Existing catalog only; no new permission keys or schema changes         |
| Anonymous access    | Redirect to `/auth/signin` with a validated admin callback URL          |
| Non-admin access    | `notFound()` (404) for authenticated users without admin-area access    |
| Client authorization| Never; the client receives only entries the server already permitted    |
| Responsive          | Persistent sidebar at `lg`; off-canvas dialog drawer below `lg`         |
| Account menu        | Name, email, Your account, View site, Sign out via `googleSignOut`      |
| Breadcrumbs         | Server-computed for implemented routes; current page is not a link      |
| Testing             | Pure unit tests, RTL shell tests, Playwright anonymous redirect          |
| Push                | Only after explicit approval following verification                     |

## 3. Non-Goals

- No content, moderation, users, analytics, notifications, or settings pages.
- No placeholder pages, catch-all routes, or links to routes that 404.
- No new database tables, permissions, check constraints, or migrations.
- No admin tables, forms, dashboard widgets, or charts.
- No middleware/proxy, route groups, or global navigation changes.
- No public-site changes.
- No change to existing admin REST handlers or their authorization.
- No client-side permission filtering or hidden-button authorization.

## 4. Current State

- `src/app/admin/` has API route handlers only; there is no admin page or
  layout. Layouts do not apply to route handlers, so the existing APIs are
  unaffected.
- `resolveActor()` resolves the session, active account, Super Admin flag,
  assigned roles, and effective permission keys. It returns an anonymous actor
  for missing sessions, deactivated users, and soft-deleted users.
- `requireAdmin()` requires `admin.manage` or Super Admin. That is narrower than
  the admin area: Content Managers and Analysts hold operational permissions
  without `admin.manage`. The shell therefore uses an admin-area check derived
  from the navigation model, while every future operation still uses its own
  canonical guard.
- The catalog contains all keys used here: `drama.read`, `movie.read`,
  `episode.read`, `category.read`, `platform.read`, `review.read`,
  `review.manage`, `user.read`, `user.manage`, `analytics.read`, `settings.read`,
  `settings.manage`, `admin.manage`.
- `src/app/auth/signin/page.tsx` ignores any callback URL, and `googleSignIn()`
  hard-codes `callbackURL: '/dashboard'`. Preserving an admin destination
  therefore requires a small, scoped change to both.
- Base UI provides `menu`, `dialog`, and `separator`; `src/components/ui` has
  wrappers for alert-dialog, dialog, tooltip, button, and the other existing
  primitives, but no dropdown-menu wrapper.

## 5. Approaches Considered

### A — Server layout + client shell (chosen)

The layout resolves the actor, enforces access, filters navigation, and computes
breadcrumbs. A client shell owns drawer state, active links, and the account
menu. Pure modules hold the navigation model, access decision, breadcrumb
resolution, and callback validation.

- Permission decisions run where the authority is; the browser receives only
  permitted entries.
- Pure modules are straightforward to test without a database or browser.
- Cost: a serialization boundary and a small amount of server-to-client props.

### B — Client-side filtering

Pass the full model and permissions to a client shell that filters.

- Fewer server props, but navigation logic lives in the browser, hidden entries
  are shipped anyway, and the server/client view can drift.
- Contradicts the rule that hiding navigation is not authorization. Rejected.

### C — Per-section nested layouts

Each group gets its own layout that enforces its permission and supplies its own
navigation subset.

- Strong per-section gates, but duplicates the shell and navigation before any
  section exists, and `/admin` still needs the root gate. Rejected as
  over-engineering for this prompt.

## 6. Architecture

```
Request /admin
  │
  ├─ src/app/admin/layout.tsx  (Server Component)
  │    ├─ requireAdminPageAccess('/admin')
  │    │    ├─ resolveActor()                         [cached per request]
  │    │    ├─ anonymous  → redirect(signInUrl)
  │    │    ├─ forbidden  → notFound()
  │    │    └─ allowed    → ActorContext
  │    ├─ filterAdminNavigation(ADMIN_NAVIGATION, actor)
  │    ├─ getAdminBreadcrumbs('/admin')
  │    ├─ getActiveSession() → name, email
  │    └─ <AdminShell navigation breadcrumbs user>{children}</AdminShell>
  │
  └─ src/app/admin/page.tsx  (Server Component)
       ├─ requireAdminPageAccess('/admin')           [re-check, cached actor]
       └─ overview content
```

`AdminShell` is a client component and performs no authorization. It renders the
server-provided navigation and breadcrumbs, tracks the active route, and owns
the mobile drawer and account menu.

## 7. Navigation Model

`src/components/admin/navigation.ts` is the single source of truth. It exports:

```ts
export type AdminNavEntry = Readonly<{
  id: string;
  label: string;
  href: string;
  permissions: readonly PermissionKey[]; // any-of; empty = admin-area access
  implemented: boolean;
}>;

export type AdminNavGroup = Readonly<{
  id: string;
  label: string;
  entries: readonly AdminNavEntry[];
}>;

export const ADMIN_NAVIGATION: readonly AdminNavGroup[];
export const ADMIN_AREA_PERMISSIONS: readonly PermissionKey[];
export function hasAdminAreaAccess(actor: ActorContext): boolean;
export function filterAdminNavigation(
  groups: readonly AdminNavGroup[],
  actor: ActorContext
): readonly AdminNavGroup[];
export function isAdminNavItemActive(pathname: string, href: string): boolean;
```

`ADMIN_AREA_PERMISSIONS` is derived from the union of all entry permissions, so
adding a future entry cannot silently leave the shell gate out of date.
`hasAdminAreaAccess` is true for Super Admin and for any actor holding at least
one of those keys; anonymous actors never qualify.

`filterAdminNavigation` drops entries that are not `implemented`, drops entries
whose permissions do not match, and drops a group when no entries remain. An
entry with an empty permission list renders only when the actor has admin-area
access. Group visibility therefore means "at least one relevant permitted
entry".

### 7.1 Model contents

| Group       | Entry                  | Route                        | Permissions (any-of)                              | Implemented |
| ----------- | ---------------------- | ---------------------------- | ------------------------------------------------- | ----------- |
| Dashboard   | Overview               | `/admin`                     | — (admin-area access)                             | **yes**     |
| Content     | Dramas                 | `/admin/dramas`              | `drama.read`                                      | no          |
| Content     | Movies                 | `/admin/movies`              | `movie.read`                                      | no          |
| Content     | Episodes               | `/admin/episodes`            | `episode.read`                                    | no          |
| Content     | Categories             | `/admin/categories`          | `category.read`                                   | no          |
| Content     | Platforms              | `/admin/platforms`           | `platform.read`                                   | no          |
| Moderation  | Reports                | `/admin/reports`             | `review.read`, `review.manage`                    | no          |
| Moderation  | Reviews                | `/admin/reviews`             | `review.read`, `review.manage`                    | no          |
| Users       | Users                  | `/admin/users`               | `user.read`, `user.manage`                        | no          |
| Analytics   | Analytics              | `/admin/analytics`           | `analytics.read`                                  | no          |
| Notifications | Notifications        | `/admin/notifications`       | `admin.manage`                                    | no          |
| System      | Settings               | `/admin/settings`            | `settings.read`, `settings.manage`, `admin.manage`| no          |
| System      | Roles & permissions    | `/admin/roles`               | `admin.manage`                                    | no          |
| System      | Information pages      | `/admin/information-pages`   | `settings.manage`, `admin.manage`                 | no          |

Every key is verified against `PERMISSIONS` in tests. Entries are hidden while
`implemented` is false, so no link can point at a route that does not exist.
Later prompts flip `implemented` when they add the page; they do not change the
permission model.

## 8. Access and Callback Rules

### 8.1 Access decision

`src/components/admin/admin-access.ts` exports a pure decision:

```ts
export type AdminPageAccess =
  | Readonly<{ status: 'allowed'; actor: ActorContext }>
  | Readonly<{ status: 'anonymous'; signInUrl: string }>
  | Readonly<{ status: 'forbidden' }>;

export function resolveAdminPageAccess(
  actor: ActorContext,
  requestedPath: string
): AdminPageAccess;
```

- `actor.userId === null` → `anonymous`, with
  `/auth/signin?callbackUrl=<encoded safe admin path>`.
- Authenticated but no admin-area permission → `forbidden`.
- Otherwise → `allowed` with the actor.

`src/app/admin/_access.ts` is the thin Next adapter:

```ts
export const getAdminActor = cache(resolveActor);

export async function requireAdminPageAccess(requestedPath: string): Promise<ActorContext>;
```

It calls `redirect()` for anonymous, `notFound()` for forbidden, and returns the
actor otherwise. `cache()` deduplicates the actor lookup when both the layout
and page render in the same request. Both entrypoints call it, so a layout
failure cannot leave the page unprotected.

### 8.2 Callback validation

`src/lib/redirects.ts` contains framework-free validation:

```ts
export function sanitizeLocalCallback(value: unknown): string | null;
export function sanitizeCallbackUrl(value: unknown, fallback?: string): string;
export function isAdminPath(path: string): boolean;
```

Rejected: non-strings, empty values, absolute URLs, protocol-relative `//`,
backslashes, control characters, values that do not start with `/`, values that
do not parse as a same-origin path, and paths outside `/admin` when used for the
admin redirect. Query strings and fragments on a valid admin path are kept.
`sanitizeCallbackUrl` returns the fallback (`/dashboard` by default) when
invalid.

### 8.3 Sign-in flow change

The shell's redirect is only useful if sign-in returns the user to `/admin`:

- `src/app/auth/signin/page.tsx` reads `callbackUrl`, sanitizes it, redirects an
  already signed-in user to it, and submits it as a hidden field.
- `googleSignIn()` reads the hidden field, sanitizes it again server-side, and
  uses it as Better Auth's `callbackURL`. `errorCallbackURL` preserves it.
- No new sign-out or authentication implementation is added.

This is the only change outside the admin area. It is required by the approved
"return to the intended destination" rule and is covered by unit tests.

## 9. Breadcrumbs

`src/components/admin/breadcrumbs.ts`:

```ts
export type AdminBreadcrumb = Readonly<{
  label: string;
  href?: string; // omitted for the current page
}>;

export const ADMIN_ROUTE_LABELS: Readonly<Record<string, string>>;
export function getAdminBreadcrumbs(
  pathname: string,
  labels?: Readonly<Record<string, string>>
): readonly AdminBreadcrumb[];
```

- Only implemented routes appear in `ADMIN_ROUTE_LABELS`; initially `/admin`.
- For `/admin`, the result is a single current item labelled `Admin`.
- For a known nested path, each known ancestor with an implemented route is a
  link and the final item has no `href`.
- Unknown paths fall back to a single current `Admin` item; no synthetic links
  are generated.
- The `labels` parameter lets tests exercise ancestor links with a fixture map
  without exposing future routes in production.
- The header renders `<nav aria-label="Breadcrumb"><ol>`; the current item has
  `aria-current="page"` and is plain text. The header does not repeat a separate
  page title.

Because only `/admin` exists, the layout passes `/admin`. The helper accepts any
admin path and is ready for nested routes; wiring the live pathname for future
pages is deferred with those pages.

## 10. Layout and Responsive Behaviour

```
lg and above                          below lg
┌──────────┬──────────────────────┐   ┌──────────────────────┐
│ sidebar  │ header (breadcrumbs, │   │ header (☰, crumbs,   │
│ (brand,  │         account)     │   │         account)     │
│ groups)  ├──────────────────────┤   ├──────────────────────┤
│          │ main                 │   │ main                 │
└──────────┴──────────────────────┘   └──────────────────────┘
                                        drawer slides over with
                                        overlay when ☰ is pressed
```

- Desktop sidebar: fixed, `w-64`, full height, border-right, brand at top,
  grouped links, `hidden lg:flex`.
- Content column: `lg:pl-64`; main has `id="main-content"` so the existing skip
  link works.
- Header: sticky, `h-14`, border-bottom, mobile menu button (`lg:hidden`),
  breadcrumbs, account menu. Backdrop blur and existing tokens match the public
  header.
- Mobile drawer: Base UI Dialog in modal mode, rendering from the left. It
  provides focus trapping, Escape handling, scroll locking, and focus return.
  The close button receives initial focus. `onOpenChange` is controlled by the
  shell; the drawer closes on navigation through a `usePathname` effect.
- Active link: `aria-current="page"`; `/admin` matches only exactly, other routes
  match exact or descendant paths.
- Reduced motion: slide/fade animations carry `motion-reduce:animate-none`.
- Tokens only: `background`, `card`, `popover`, `muted`, `border`, `primary`,
  `accent`, `foreground`, `destructive`. No hex values.

## 11. Account Menu

`src/components/admin/admin-account-menu.tsx` uses the new Base UI dropdown
wrapper:

- Trigger: initials circle derived from the user's name, plus the name on wider
  screens; `aria-label="Open account menu"`.
- Content: name and email, a separator, **Your account** → `/dashboard`,
  **View site** → `/`, a separator, and **Sign out**.
- Sign out is a form whose action is the existing `googleSignOut` Server Action.
  No second sign-out path is created.
- Menu items use `Menu.LinkItem` for navigation and `Menu.Item` for the sign-out
  submit button; the Base UI menu owns keyboard navigation and focus return.

## 12. Files

```
src/app/admin/layout.tsx                       new  server gate + shell composition
src/app/admin/page.tsx                         new  /admin overview
src/app/admin/_access.ts                       new  cached actor + redirect/notFound adapter
src/app/auth/signin/page.tsx                   edit callback URL handling
src/workflows/auth/google-oauth.ts             edit callback URL forwarding
src/lib/redirects.ts                           new  pure callback validation
src/components/admin/navigation.ts             new  model + filtering + active path
src/components/admin/admin-access.ts           new  pure access decision
src/components/admin/breadcrumbs.ts            new  label map + resolver
src/components/admin/admin-shell.tsx           new  client shell state and composition
src/components/admin/admin-sidebar.tsx         new  desktop sidebar + mobile dialog drawer
src/components/admin/admin-header.tsx          new  header, breadcrumbs, mobile trigger
src/components/admin/admin-account-menu.tsx    new  account dropdown
src/components/ui/dropdown-menu.tsx            new  Base UI menu wrapper
tests/unit/components/admin-navigation.test.ts new
tests/unit/components/admin-access.test.ts     new
tests/unit/components/admin-breadcrumbs.test.ts new
tests/unit/components/admin-shell.test.tsx     new
tests/unit/lib/redirects.test.ts               new
tests/e2e/admin-access.spec.ts                 new
docs/development/admin-shell.md                new
docs/README.md                                 edit index
docs/PROJECT_STATUS.md                         edit Prompt 049 row
docs/CHANGELOG.md                              edit 0.4.9
```

No existing UI primitive changes behaviour. The new dropdown wrapper follows the
existing Base UI + `cn` conventions and is the only new `ui/` file. During
implementation, `DialogContent` gained an optional `overlayClassName` prop (default
unchanged, existing call sites untouched) so the drawer can use a stronger scrim
instead of duplicating the dialog primitive.

## 13. Server/Client Boundary

- `layout.tsx`, `page.tsx`, `_access.ts`, `navigation.ts`, `admin-access.ts`, and
  `breadcrumbs.ts` are server-side or framework-free. None starts with
  `"use client"`.
- `admin-shell.tsx`, `admin-sidebar.tsx`, `admin-header.tsx`,
  `admin-account-menu.tsx`, and `ui/dropdown-menu.tsx` are client components.
- The layout passes plain serializable data: `AdminNavGroup[]`, breadcrumbs,
  `{ name, email }`, and `children`. No functions, icons, or actor objects cross
  the boundary. Icons are selected in the client from group/entry ids.
- `navigation.ts` imports `hasPermission` from
  `@/modules/authorization/guards`, `PermissionKey`/`isPermissionKey` from
  `@/modules/authorization/permissions`, and `ActorContext` as a type. It does
  not import the module index (which pulls in the database client), keeping the
  pure tests database-free.

## 14. Testing

### Pure unit

`admin-navigation.test.ts`

- Super Admin sees the Dashboard entry; anonymous and non-admin actors see none.
- Every catalog key used by the model passes `isPermissionKey`.
- No duplicate ids or hrefs; every href starts with `/admin`.
- Future entries remain hidden even when the actor holds their permission.
- With fixture groups marked implemented: any-of visibility for content,
  moderation, users, analytics, notifications, and system; group disappears when
  no entry matches; per-entry permissions are independent.
- Active-path helper: `/admin` exact, descendant matching, near-miss
  (`/administrator`) rejected.

`admin-access.test.ts`

- Anonymous → `anonymous` + encoded `/admin` callback.
- Authenticated without admin-area permissions → `forbidden`.
- Each operational permission grants access; Super Admin always allowed.
- Unsafe callback inputs (`https://evil`, `//evil`, `/\evil`, `/other`, control
  characters, non-strings) fall back to `/admin`.
- Valid nested admin paths with query strings are preserved.

`admin-breadcrumbs.test.ts`

- `/admin` → one current `Admin` item.
- Fixture `/admin/users` → `Admin` link + current `Users`.
- Unknown path → `Admin` only, no invented link.
- Trailing slash and query-string normalization; current item has no `href`.

`redirects.test.ts`

- Local paths accepted; absolute, protocol-relative, backslash, and malformed
  values rejected; fallback returned; query/hash preserved.

### RTL component tests

`admin-shell.test.tsx` with fixture navigation and user:

- Renders group labels and links; active link has `aria-current="page"`.
- Breadcrumb `nav` has the accessible name and current-page semantics.
- Desktop sidebar is present; mobile trigger is `lg:hidden`.
- Mobile trigger opens the dialog drawer; Escape closes it; overlay click closes
  it; focus returns to the trigger; the drawer closes when the pathname changes.
- Account menu opens with name/email and the two links; the sign-out control is
  a submit button inside a form.
- Body scroll is locked while the drawer is open and restored afterwards.

Base UI may need `matchMedia`, `ResizeObserver`, or `scrollIntoView` in jsdom;
minimal local polyfills are added only if required.

### Playwright

`admin-access.spec.ts`

- Anonymous `GET /admin` redirects to
  `/auth/signin?callbackUrl=%2Fadmin` and renders the sign-in heading.
- The hidden callback field contains `/admin`.
- No server 500 responses or uncaught page errors.

Authenticated admin and authenticated non-admin browser flows cannot run with the
placeholder Google credentials. Those rules are covered by `resolveAdminPageAccess`
unit tests and are reported as unverified in-browser.

## 15. Documentation

- New `docs/development/admin-shell.md`: file map, access model, permission
  mapping, how to expose a future entry, responsive behaviour, account menu,
  breadcrumb rules, testing, and the current `/admin`-only callback limitation.
- `docs/README.md`: add the admin shell link.
- `docs/PROJECT_STATUS.md`: Prompt 049 row and current prompt.
- `docs/CHANGELOG.md`: `0.4.9` with verification results.

## 16. Verification Gate

```
npm run typecheck
npm run lint
npm test
npm run test:integration
node "C:\Users\User\AppData\Local\Temp\opencode\dramascan-build.mjs"
npm run test:e2e
```

Pre-existing main-database `information_pages.position` build warnings are
reported separately. Cold dev-compile E2E timeouts, if they recur, are
distinguished from regressions. No test is weakened to accommodate the shell.

## 17. Risks and Mitigations

| Risk                                                        | Mitigation                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| `requireAdmin` too narrow for Content Managers/Analysts      | Shell uses derived admin-area permissions; operations keep their own guards |
| Nav model drifts from catalog                                | Every key validated against `PERMISSIONS` in unit tests                    |
| Future permissions accidentally exposed                       | `implemented: false` is required in addition to permission                 |
| Layout renders page without gate                             | Page calls the same cached `requireAdminPageAccess`                        |
| Open redirect through callback                               | Pure strict validator; sanitized again in the Server Action                |
| Base UI drawer/menu needs jsdom APIs                         | Minimal local polyfills only; production behaviour unchanged               |
| Breadcrumbs wrong for future nested pages                    | Only `/admin` is wired now; helper accepts nested paths and is tested      |
| Sign-out duplicated                                           | Account menu reuses the existing `googleSignOut` action                    |
| Dialog drawer introduces focus bugs                          | Base UI modal dialog handles trap, Escape, scroll lock, focus return       |

## 18. Git Plan

- One commit: `feat: build the admin layout (Prompt 049)`.
- Review `git status`, the full diff, and `git diff --check` for secrets,
  artifacts, and unrelated changes before committing.
- Report the commit hash and verification results, then request explicit
  approval before pushing.
