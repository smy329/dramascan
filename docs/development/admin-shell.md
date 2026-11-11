# Admin Shell

**Project:** DramaScan — International Drama & Movie Streaming Platform
**Version:** 1.0
**Date:** 2026-11-12

This document describes the protected administration shell created by Prompt 049:
the `/admin` layout, the permission-filtered sidebar, the header and breadcrumbs,
the account menu, and the overview page. It is the foundation later admin
prompts extend; it does not implement any future admin section.

---

## 1. Principles

- **The server decides, the client renders.** The layout resolves the actor,
  enforces access, filters the navigation, and computes breadcrumbs on the
  server. The client shell owns only drawer and menu interactions.
- **Navigation is never authorization.** A visible link is a convenience. The
  layout and the page both call the server gate, and every future operation
  keeps its own canonical guard.
- **One navigation model.** All planned entries are declared centrally with an
  explicit `implemented` flag. Only implemented, permitted entries render, so a
  rendered link cannot point at a route that does not exist yet.
- **No placeholder routes.** Prompt 049 adds exactly `/admin` (layout + page).
  Existing `/admin/api/*` route handlers are untouched because layouts do not
  apply to route handlers.

---

## 2. Files

| File                                             | Responsibility                                                | Boundary |
| ------------------------------------------------ | ------------------------------------------------------------- | -------- |
| `src/app/admin/layout.tsx`                       | Resolves the actor, gates access, filters nav, renders the shell | Server   |
| `src/app/admin/page.tsx`                         | Overview page; calls the gate again before rendering           | Server   |
| `src/app/admin/_access.ts`                       | Shared cached gate (`requireAdminPageAccess`)                  | Server   |
| `src/components/admin/navigation.ts`             | Nav model, permission union, filtering, active-path matching   | Shared   |
| `src/components/admin/admin-access.ts`           | Pure access decision (`allowed`/`anonymous`/`forbidden`)       | Shared   |
| `src/components/admin/breadcrumbs.ts`            | Route label map and breadcrumb resolver                        | Shared   |
| `src/components/admin/admin-shell.tsx`           | Client chrome: drawer state, layout composition                | Client   |
| `src/components/admin/admin-sidebar.tsx`         | Persistent sidebar and mobile drawer navigation                | Client   |
| `src/components/admin/admin-header.tsx`          | Sticky header, breadcrumbs, mobile trigger, account-menu slot   | Client   |
| `src/components/admin/admin-account-menu.tsx`    | Identity, account links, sign out                              | Client   |
| `src/components/ui/dropdown-menu.tsx`            | Base UI Menu wrapper used by the account menu                  | Client   |
| `src/lib/redirects.ts`                           | Callback sanitizer and admin sign-in URL builder               | Shared   |

Direct imports only; there is no barrel `index.ts` in `src/components/admin`.

---

## 3. Request Flow

```
Request /admin
  └─ layout.tsx
       └─ requireAdminPageAccess('/admin')            (cached resolveActor + getActiveSession)
            ├─ anonymous  → redirect('/auth/signin?callbackUrl=%2Fadmin')
            ├─ forbidden  → notFound()
            └─ allowed    → { actor, user }
       ├─ filterAdminNavigation(ADMIN_NAVIGATION, actor)
       ├─ getAdminBreadcrumbs('/admin')
       └─ <AdminShell navigation breadcrumbs user>{children}</AdminShell>
  └─ page.tsx
       └─ requireAdminPageAccess('/admin')            (same cached reads)
       └─ <h1>Overview</h1> + actor roles
```

`_access.ts` wraps `resolveActor` and `getActiveSession` in React `cache`, so the
layout and page share one actor read and one session read per request.

If the session disappears between the actor read and the session read, the gate
redirects to a fresh admin sign-in URL instead of rendering with missing
identity.

---

## 4. Access Rules

| Actor state                         | Result                                            |
| ----------------------------------- | ------------------------------------------------- |
| No session (`userId === null`)      | `307` to `/auth/signin?callbackUrl=<admin path>`  |
| Authenticated, no admin permission  | `notFound()` (404)                                |
| Any admin-area permission           | Allowed                                           |
| Super Admin                         | Allowed                                           |

An anonymous actor is anonymous even if a malformed actor object sets
`isSuperAdmin: true`. `hasAdminAreaAccess` checks `userId === null` first.

There is no 403 page and no redirect to the public dashboard. Hiding the admin
area behind a 404 avoids advertising it to signed-in users who have no business
there.

### 4.1 Why not `requireAdmin`

`requireAdmin` is narrower than the admin area: it is the Super Admin /
administration-management gate. Content Managers and Analysts legitimately need
the shell. The shell therefore uses the broader derived permission set below.
Operations inside future admin pages must still call their own canonical guard;
the shell gate is not a substitute.

### 4.2 `ADMIN_AREA_PERMISSIONS`

The union of every navigation entry's permission keys, de-duplicated, derived at
module load:

```ts
ADMIN_AREA_PERMISSIONS = unique(
  ADMIN_NAVIGATION.flatMap(group =>
    group.entries.flatMap(entry => entry.permissions)
  )
);
```

**Documented limitation:** holding any one of these read permissions is enough
to enter the admin area and see the Overview page. This is intentional for the
shell and does not grant access to any future operation, which keeps its own
guard. Adding a navigation entry automatically widens the set; do not add a
permission that should not grant shell access.

---

## 5. Navigation Model

`ADMIN_NAVIGATION` is a `readonly` array of groups, each with a `readonly` array
of entries:

```ts
type AdminNavEntry = Readonly<{
  id: string;
  label: string;
  href: string;
  permissions: readonly PermissionKey[]; // any-of; empty = admin-area access
  implemented: boolean;
}>;
```

| Group         | Entry               | Href                       | Permissions (any of)                               | Implemented |
| ------------- | ------------------- | -------------------------- | -------------------------------------------------- | ----------- |
| Dashboard     | Overview            | `/admin`                   | — (admin-area access)                              | Yes         |
| Content       | Dramas              | `/admin/dramas`            | `drama.read`                                       | No          |
| Content       | Movies              | `/admin/movies`            | `movie.read`                                       | No          |
| Content       | Episodes            | `/admin/episodes`          | `episode.read`                                     | No          |
| Content       | Categories          | `/admin/categories`        | `category.read`                                    | No          |
| Content       | Platforms           | `/admin/platforms`         | `platform.read`                                    | No          |
| Moderation    | Reports             | `/admin/reports`           | `review.read`, `review.manage`                     | No          |
| Moderation    | Reviews             | `/admin/reviews`           | `review.read`, `review.manage`                     | No          |
| Users         | Users               | `/admin/users`             | `user.read`, `user.manage`                         | No          |
| Analytics     | Analytics           | `/admin/analytics`         | `analytics.read`                                   | No          |
| Notifications | Notifications       | `/admin/notifications`     | `admin.manage`                                     | No          |
| System        | Settings            | `/admin/settings`          | `settings.read`, `settings.manage`, `admin.manage` | No          |
| System        | Roles & permissions | `/admin/roles`             | `admin.manage`                                     | No          |
| System        | Information pages   | `/admin/information-pages` | `settings.manage`, `admin.manage`                  | No          |

### 5.1 Exposing a future section

1. Create the route under `src/app/admin/<section>/`.
2. Flip that entry's `implemented` to `true` in `navigation.ts`.
3. Gate the new route's layout/page with `requireAdminPageAccess`.
4. Add the route to `ADMIN_ROUTE_LABELS` if it needs a breadcrumb.

Do not add an entry whose permission key is not in the catalog; a test asserts
every key is canonical.

### 5.2 Filtering

`filterAdminNavigation(groups, actor)` drops entries where `implemented` is
false, drops entries whose permissions do not match, and drops groups left with
no entries. An entry with no permissions requires admin-area access.

`isAdminNavItemActive(pathname, href)` matches `/admin` exactly and other
sections on themselves or their descendants (`/admin/dramas/42`), never on
lookalike prefixes (`/admin/dramas-two`).

---

## 6. Callback Preservation

The sign-in page and `googleSignIn` already accepted a `callbackURL` at the
Better Auth layer, but the page ignored the query value and the Server Action
hard-coded `/dashboard`. `src/lib/redirects.ts` fixes that without enabling an
open redirect:

- `sanitizeLocalCallback(value)` accepts only same-origin absolute paths
  (max 2048 chars, starts with a single `/`, no `//`, no backslash, no control
  characters, no surrounding whitespace). It parses against a fixed base and
  returns `pathname + search + hash`, so `/admin/../other` normalizes to
  `/other`.
- `sanitizeCallbackUrl(value, fallback?)` returns the fallback (then
  `/dashboard`) when either value is unsafe.
- `isAdminPath(value)` accepts `/admin`, `/admin/…`, `/admin?…`, `/admin#…` and
  rejects `/administrator`, `/adminish`, `/other/admin`.
- `buildAdminSignInUrl(path)` falls back to `/admin` for unsafe or non-admin
  requests.

The sign-in page sanitizes `searchParams.callbackUrl`, redirects an already
signed-in user to the destination, and renders a hidden `callbackUrl` input.
`googleSignIn(formData)` sanitizes the field again before passing
`callbackURL` to Better Auth and preserves it in `errorCallbackURL`.

---

## 7. Breadcrumbs

`getAdminBreadcrumbs(pathname, labels?)`:

- strips query/hash and trailing slashes;
- returns `[{ label: 'Admin' }]` outside `/admin` or for an unlabelled path;
- emits one crumb per labelled ancestor;
- gives every crumb except the current one an `href`;
- never invents a link for an unknown segment.

`ADMIN_ROUTE_LABELS` currently maps only `/admin → Admin`. The resolver already
supports nested paths, so a future section only adds labels.

The header renders `<nav aria-label="Breadcrumb"><ol>` with
`aria-current="page"` on the current crumb. The page supplies the only `h1`; the
header does not duplicate the page title.

---

## 8. Responsive Behaviour

| Breakpoint | Navigation                                                       |
| ---------- | ---------------------------------------------------------------- |
| `lg` and up | Persistent 256px (`w-64`) sidebar; content offset by `lg:pl-64`  |
| below `lg` | Off-canvas drawer opened from the header trigger                 |

The drawer is the vendored Base UI modal Dialog, so focus trap, initial focus,
Escape, outside-pointer dismissal, body scroll lock, and focus return come from
the primitive. No hand-rolled scroll lock exists. `DialogContent` gained an
optional `overlayClassName` prop for a stronger scrim; the default is unchanged
and existing call sites are untouched.

The shell closes the drawer when `usePathname()` changes, so selecting a link
navigates and dismisses the drawer.

---

## 9. Account Menu

The header trigger shows the user's initials and, on `sm+`, their name. The menu
shows name and email, then:

- **Your account** → `/dashboard`
- **View site** → `/`
- **Sign out** → submit inside `<form action={googleSignOut}>`

Sign out reuses the existing Server Action; there is no second sign-out path.
Initials come from the display name (first + last word), then the email's first
letter, then `?`.

---

## 10. Tests

| Area                | File                                                        |
| ------------------- | ----------------------------------------------------------- |
| Callback sanitizer  | `tests/unit/lib/redirects.test.ts`                          |
| Sign-in forwarding  | `tests/unit/workflows/auth/google-oauth.test.ts`            |
| Navigation model    | `tests/unit/components/admin-navigation.test.ts`            |
| Access decision     | `tests/unit/components/admin-access.test.ts`                |
| Breadcrumbs         | `tests/unit/components/admin-breadcrumbs.test.ts`           |
| Menu primitive      | `tests/unit/components/dropdown-menu.test.tsx`              |
| Shell/drawer        | `tests/unit/components/admin-shell.test.tsx`                |
| Account menu        | `tests/unit/components/admin-account-menu.test.tsx`         |
| Page gate           | `tests/unit/app/admin-page.test.tsx`                        |
| Anonymous redirect  | `tests/e2e/admin-access.spec.ts`                            |

Run the focused suites:

```
npx vitest run tests/unit/lib/redirects.test.ts tests/unit/components/admin-navigation.test.ts
npx playwright test tests/e2e/admin-access.spec.ts
```

### 10.1 Unverified in a browser

Authenticated admin and non-admin browser flows are **not** covered by
Playwright in this environment: `.env.local` still holds placeholder Google
OAuth credentials, so a real Google consent cannot be completed. Those
decisions are covered by unit tests against the pure access and navigation
functions instead. This limitation is not a claim that the flows were verified
in a browser.

---

## 11. Related Documents

- [Confirmation Dialogs](confirmation-dialogs.md)
- [State Components](state-components.md)
- [Testing Conventions](testing-conventions.md)
- [Coding Conventions](coding-conventions.md)
- Design: `docs/superpowers/specs/2026-11-12-admin-layout-design.md`
- Plan: `docs/superpowers/plans/2026-11-12-admin-layout.md`
