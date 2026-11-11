# Admin Sidebar and Breadcrumbs (Prompt 050) — Design

**Status:** Proposed — awaiting approval
**Date:** 2026-11-12
**Requirement:** `docs/requirements/REQUIREMENTS.md` §8.1, §8.9, §8.10
**Builds on:** Prompt 049 (`docs/superpowers/specs/2026-11-12-admin-layout-design.md`)

## 1. Intent

Prompt 049 built the admin shell, the centralized navigation model, the access
gate, and a breadcrumb resolver. Prompt 050 closes the three §8.1 gaps that 049
left open, without creating any new admin page:

1. **Super Admin-only surfaces.** System Configuration and Roles & permissions
   must be hidden from every non-Super-Admin regardless of permissions, and the
   privileged operations behind them must be enforced server-side, not by
   visibility.
2. **Server-side enforcement.** A reusable `requireSuperAdmin` guard, used by
   the same authoritative definition in navigation filtering, API routes, and
   service (workflow) functions.
3. **Breadcrumb readiness.** The label map covers the planned nested routes, and
   the shell renders correct nested breadcrumbs so a future page needs no
   breadcrumb wiring.

## 2. Goals / Non-goals / Anti-goals

**Goals**

- Explicit `superAdminOnly` on the centralized nav model; applied to Settings
  and Roles & permissions only, not the whole System group.
- `requireSuperAdmin(actor)` in `src/modules/authorization/guards.ts`, exported
  from the module index, based on `actor.isSuperAdmin` (the authoritative
  definition).
- Super Admin-only enforcement at the route and service boundaries for role and
  permission management, and for the user-role assignment operation.
- Planned nested breadcrumb labels; path-aware breadcrumbs.
- Tests for visibility, guard behavior, route enforcement, service enforcement,
  nested breadcrumbs, and regression of 049.

**Non-goals**

- No new admin pages, placeholder routes, links, or dead links.
- No System Configuration feature, no settings API, no content features.
- No new permission keys, no schema changes, no migrations.
- No change to `googleSignOut`, the access gate semantics, or the responsive
  shell behavior beyond the breadcrumb source.

**Anti-goals (failure even if tests pass)**

- Treating permission possession (e.g. `admin.manage`, `settings.manage`) as
  equivalent to Super Admin for a Super Admin-only surface.
- Hiding a surface in the sidebar while leaving its API or service callable.
- Weakening any existing restriction to make the change easier.
- Duplicating authorization logic instead of extending the existing guards.

## 3. Constraints

- `requireSuperAdmin` must not be a permission check; `isSuperAdmin` is the
  authoritative flag (D-022).
- Existing canonical guards and last-Super-Admin protections are preserved.
- The nav model stays the single source of truth; the label map stays the single
  source of breadcrumb labels.
- `no-extra-parens` / `arrow-body-style` lint rules shape the code style.
- One commit for Prompt 050; no push until hash and verification are shown and
  approved.

## 4. Decisions already made by you

- Harden in place; no new pages.
- Super Admin-only: **System Configuration** and **Roles & permissions**.
  **Information pages** stays permission-based (`settings.manage` /
  `admin.manage`).
- API enforcement: add the guard and apply it selectively — all `api/roles`
  actions, and only the role/permission-affecting `api/users` action(s).
  Ordinary user management keeps its current `admin.manage` requirement.

## 5. Approaches considered

### 5.1 Breadcrumb path source

The 049 layout hard-coded `getAdminBreadcrumbs('/admin')` because only `/admin`
existed; a server layout cannot read its own pathname.

- **A. Client resolution from `usePathname()` (chosen).** The shell already uses
  `usePathname()`; the resolver and label map are shared, framework-free
  modules. Client components are pre-rendered on the server, so breadcrumbs
  remain in the initial HTML. Any future nested page gets correct breadcrumbs
  with zero extra wiring.
- **B. Middleware writes the path into a request header; layout reads
  `headers()`.** Keeps the composer in the server layout but introduces a new
  middleware file and a new request-scoped mechanism for a layout concern.
- **C. Keep back-end hard-coded `/admin`; only extend labels and unit-test the
  resolver.** Smallest change, but nested pages would show only "Admin" until a
  later prompt remembers to rewire the layout, which contradicts "show
  breadcrumbs on nested admin pages."

A is chosen: no new mechanism, correct by construction for future pages, and it
reuses the existing pure resolver.

### 5.2 Admin-area permission union

- **A. Derive `ADMIN_AREA_PERMISSIONS` from non-Super-Admin-only entries
  (chosen).** A permission that only ever appears on a Super Admin-only surface
  (`settings.read`) must not grant entry to the admin area. Least privilege;
  matches "do not treat permission possession as a substitute for the Super
  Admin role check."
- **B. Keep the union of every entry.** A `settings.read`-only actor enters the
  shell and sees only the Dashboard, because visibility is filtered. Consistent
  with 049's documented "any read permission grants shell access" limitation,
  but lets a Super Admin-only permission open the shell.

A is chosen. **Behaviour change to flag:** the one permission removed from the
union is `settings.read` (exclusive to the Super Admin-only Settings entry).
An actor holding only `settings.read` moves from *allowed* to *forbidden* at the
gate. `settings.manage` and `admin.manage` stay in the union via
Information pages / Notifications, so no other actor changes.

## 6. Detailed design

### 6.1 Guard

`src/modules/authorization/guards.ts`:

```ts
/**
 * Require that the actor is the Super Admin. Throws AuthenticationError when
 * anonymous, AuthorizationError when authenticated but not Super Admin.
 * Not a permission check: isSuperAdmin is the authoritative definition.
 */
export function requireSuperAdmin(actor: ActorContext): ActorContext;
```

- `userId === null` → `AuthenticationError` (401).
- `!actor.isSuperAdmin` → `AuthorizationError` (403).
- otherwise returns the actor.

Exported from `src/modules/authorization/index.ts` beside `requireAdmin`.

### 6.2 Navigation model

- `AdminNavEntry` gains `superAdminOnly?: boolean` (readonly).
- `superAdminOnly: true` on `settings` and `roles`; **not** on
  `information-pages`; not on the System group itself.
- `isEntryVisible`: after the `implemented` check, `superAdminOnly && 
  !actor.isSuperAdmin` → invisible, regardless of permissions.
- `ADMIN_AREA_PERMISSIONS` derives from entries where `!superAdminOnly`
  (per 5.2A). Super Admin still passes `hasAdminAreaAccess` via the flag.

### 6.3 Route and service enforcement

- `src/app/admin/api/roles/route.ts`: replace `requirePermission(actor,
  'admin.manage')` with `requireSuperAdmin(actor)` for every action (all are
  role/permission management). Missing `action` still requires the guard, then
  returns 400.
- `src/app/admin/api/users/route.ts`: parse `action` first; `authorize-admin`
  (assigns the admin role) → `requireSuperAdmin(actor)`; every other action
  (`deactivate-admin`, `reactivate-admin`, `inspect-role`) keeps
  `requirePermission(actor, 'admin.manage')`. Missing `action` uses the
  `admin.manage` guard, then 400.
- `src/workflows/admin/roles.ts`: all six functions switch their service-level
  guard from `requirePermission('admin.manage')` to `requireSuperAdmin`; remove
  the now-unused `requirePermission`/`toPermissionKey` imports.
- `src/workflows/admin/users.ts`: `authorizeUserAsAdmin` switches to
  `requireSuperAdmin`; the other three functions keep the existing guard.

**My call (check this):** `inspect-role` stays permission-based, because your
instruction limited the change to operations that "assign, change, or manage
user roles and permissions," and inspection is none of those. §8.10 lists
"inspect assigned roles" among Super Admin capabilities, which is the opposite
lean; the two requirements conflict. If you want inspection to be Super
Admin-only too, say so and I will include it.

**My call (check this):** `deactivate-admin` / `reactivate-admin` stay
permission-based, per §8.5 ("authorized administrators may … deactivate/
reactivate users according to permissions") and your "do not make every
`api/users` endpoint Super Admin-only."

### 6.4 Breadcrumbs

- Extend `ADMIN_ROUTE_LABELS` with the planned static nested routes:
  `/admin/dramas` Dramas, `/admin/movies` Movies, `/admin/episodes` Episodes,
  `/admin/categories` Categories, `/admin/platforms` Platforms,
  `/admin/reports` Reports, `/admin/reviews` Reviews, `/admin/users` Users,
  `/admin/analytics` Analytics, `/admin/notifications` Notifications,
  `/admin/settings` Settings, `/admin/roles` Roles & permissions,
  `/admin/information-pages` Information pages. `/admin` stays `Admin`.
- `AdminShell` computes `getAdminBreadcrumbs(usePathname())`; the `breadcrumbs`
  prop is removed from `AdminShell` and from `layout.tsx`. `AdminHeader` keeps
  its `breadcrumbs` prop.
- Resolver behavior is unchanged: unlabelled or non-admin paths still fall back
  to `[{ label: 'Admin' }]`; only labelled full paths render crumbs. Detail
  routes with id segments (e.g. `/admin/users/42`) are not labelled in this
  prompt and keep the fallback until a later prompt extends the resolver.

### 6.5 Documentation

- `docs/decisions/DECISIONS.md`: new **D-025** — System Configuration and Roles
  & permissions are Super Admin-only; enforced in navigation, API routes, and
  services via `requireSuperAdmin`; Information pages stays permission-based.
- `docs/development/admin-shell.md`: `superAdminOnly`, the deferred
  `ADMIN_AREA_PERMISSIONS` rule, the client breadcrumb source and label map.
- `docs/CHANGELOG.md` `0.5.0`; `docs/PROJECT_STATUS.md` Prompt 050 row.

## 7. Files affected

| File | Change |
| ---- | ------ |
| `src/modules/authorization/guards.ts` | Add `requireSuperAdmin` |
| `src/modules/authorization/index.ts` | Export `requireSuperAdmin` |
| `src/components/admin/navigation.ts` | `superAdminOnly`; visibility; derived union |
| `src/components/admin/breadcrumbs.ts` | Planned nested labels |
| `src/components/admin/admin-shell.tsx` | Compute breadcrumbs from `usePathname()` |
| `src/app/admin/layout.tsx` | Drop breadcrumbs computation/prop |
| `src/app/admin/api/roles/route.ts` | `requireSuperAdmin` for all actions |
| `src/app/admin/api/users/route.ts` | `requireSuperAdmin` for `authorize-admin` |
| `src/workflows/admin/roles.ts` | Service guard → `requireSuperAdmin` |
| `src/workflows/admin/users.ts` | `authorizeUserAsAdmin` guard → `requireSuperAdmin` |
| `tests/unit/modules/authorization/guards.test.ts` | `requireSuperAdmin` cases |
| `tests/unit/components/admin-navigation.test.ts` | Super Admin-only visibility/union |
| `tests/unit/components/admin-breadcrumbs.test.ts` | Planned nested labels |
| `tests/unit/components/admin-shell.test.tsx` | Nested-path breadcrumbs; prop removal |
| `tests/unit/components/admin-access.test.ts` | `settings.read`-only now forbidden |
| `tests/unit/app/admin-api-roles.test.ts` (new) | Route enforcement |
| `tests/unit/app/admin-api-users.test.ts` (new) | Selective route enforcement |
| `tests/unit/workflows/admin/roles.test.ts` (new) | Service enforcement |
| `tests/unit/workflows/admin/users.test.ts` (new) | Selective service enforcement |
| `docs/decisions/DECISIONS.md`, `docs/development/admin-shell.md`, `docs/CHANGELOG.md`, `docs/PROJECT_STATUS.md` | Docs |

## 8. Expected behavior

- A non-Super-Admin holding `admin.manage`, `settings.read`, `settings.manage`
  sees no Settings and no Roles & permissions entry, but does see Information
  pages when permitted.
- A Super Admin sees Settings and Roles & permissions.
- `GET /admin/api/roles` and `GET /admin/api/users?action=authorize-admin`:
  unauthenticated → 401; authenticated non-Super-Admin (even with
  `admin.manage`) → 403; Super Admin passes the guard.
- `GET /admin/api/users?action=deactivate-admin` keeps its `admin.manage`
  behavior for a permitted non-Super-Admin.
- The same guard failures occur when the workflow functions are called directly
  (service boundary), not only through the route.
- On `/admin` the breadcrumb is a single current `Admin`; on a future
  `/admin/users` it is `Admin` (link) › `Users` (current, `aria-current="page"`);
  an unknown path still renders a single `Admin`.
- No new route exists; the dev server still returns 404 for unbuilt nested paths
  while the shell's label map already knows them.

## 9. Test plan

- **Guards:** anonymous → `AuthenticationError`; non-Super-Admin with
  `admin.manage` → `AuthorizationError`; Super Admin → returns actor.
- **Navigation:** non-Super-Admin with `settings.manage`/`admin.manage` cannot
  see Settings or Roles & permissions; Super Admin can; Information pages
  visible to a permitted non-Super-Admin; `ADMIN_AREA_PERMISSIONS` excludes
  `settings.read`.
- **Access:** `settings.read`-only actor → forbidden; `admin.manage` actor →
  allowed.
- **Breadcrumbs:** planned nested paths produce correct ancestor link + current
  item; unknown paths unchanged.
- **Shell:** nested `usePathname` renders `Admin › Users` with `aria-current` on
  the current crumb and an ancestor link; existing 049 shell tests still pass.
- **Routes:** roles all-actions 401/403/pass; users `authorize-admin` 401/403,
  other actions retain `admin.manage`.
- **Services:** roles functions reject non-Super-Admin and unauthenticated;
  `authorizeUserAsAdmin` rejects non-Super-Admin with `admin.manage`;
  `deactivateAdminUser` still accepts `admin.manage`; super admin passes.
- **Regression:** full unit suite, integration suite, build, E2E.

## 10. Out of scope / left to the builder

- No new permission keys or schema.
- No real settings persistence, no last-Super-Admin rework (the placeholder
  `validateSuperAdminAccess` keeps its Super Admin guard).
- No dynamic-segment breadcrumbs.
