# Changelog

All notable changes to the DramaScan project will be documented in this file.

## [0.5.0] - 2026-11-12

### feat: Super Admin-only admin surfaces and nested breadcrumbs (Prompt 050)

Made System Configuration and Roles & permissions Super Admin-only in the
centralized navigation and enforced the same rule at the API and service
boundaries, and made breadcrumbs correct for the planned nested admin routes.
No new admin pages, placeholder routes, permission keys, schema, or migrations.

- `AdminNavEntry` gains `superAdminOnly`. Settings and Roles & permissions set
  it; Information pages stays permission-based and the System group is not
  Super Admin-only. `filterAdminNavigation` hides a `superAdminOnly` entry from
  any actor without `isSuperAdmin`, regardless of permissions.
- `ADMIN_AREA_PERMISSIONS` now derives from non-Super-Admin-only entries, so a
  permission that exists only on a Super Admin-only surface (currently
  `settings.read`) no longer opens the admin shell.
- `requireSuperAdmin(actor)` added to `src/modules/authorization/guards.ts`
  (exported from the module index). It checks `actor.isSuperAdmin`, is not a
  permission check, and throws `AuthenticationError` (401) for anonymous
  actors and `AuthorizationError` (403) otherwise.
- Enforced at the API and service boundaries: every `/admin/api/roles` action
  and `src/workflows/admin/roles.ts` function; `authorize-admin` in
  `/admin/api/users` and `authorizeUserAsAdmin` in the users workflow. Ordinary
  user management (`deactivate-admin`, `reactivate-admin`) and `inspect-role`
  keep their canonical `admin.manage` requirement.
- `ADMIN_ROUTE_LABELS` extended to all thirteen planned static nested routes;
  `AdminShell` computes `getAdminBreadcrumbs(usePathname())`, so a future nested
  page gets the correct trail with no extra wiring. The `breadcrumbs` prop was
  removed from the shell and the layout. Unlabelled paths keep the `Admin`
  fallback.
- Decision D-025; `docs/development/admin-shell.md` updated.

Verification: `npm run typecheck` (exit 0); `npm run lint` (exit 0); unit tests
(40 files, 365 passed, 47 new); `npm run test:integration` (3 files, 40 passed);
production build (exit 0, known pre-existing `information_pages.position`
warning on the main database only); `npm run test:e2e` (11 passed in Chromium).
Authenticated browser flows remain unverified because local Google OAuth
credentials are placeholders; the Super Admin rule is covered by unit tests
that call the real guard through the route handlers and workflows.

## [0.4.9] - 2026-11-12

### feat: Admin layout (Prompt 049)

Added the protected, responsive foundation for the administration area:
`/admin` now has a server-enforced shell, a permission-filtered sidebar,
breadcrumbs, and an account menu, plus one functional overview page. No future
admin section, placeholder route, schema change, migration, or permission key
was added.

- `src/app/admin/layout.tsx` and `src/app/admin/page.tsx` both call
  `requireAdminPageAccess`, so a layout bypass cannot leave the page open. An
  anonymous visitor is redirected to `/auth/signin?callbackUrl=<admin path>`;
  an authenticated actor without admin-area access gets a 404.
- `src/app/admin/_access.ts` caches `resolveActor` and `getActiveSession` per
  request and translates the pure `resolveAdminPageAccess` decision into
  `redirect`/`notFound`.
- `src/components/admin/navigation.ts` is the single navigation model. It
  declares every planned entry with an `implemented` flag and canonical
  permission keys, derives `ADMIN_AREA_PERMISSIONS` from the entries, and
  filters unimplemented/unpermitted entries (and empty groups) before anything
  reaches the client.
- `src/components/admin/admin-shell.tsx`, `admin-sidebar.tsx`, and
  `admin-header.tsx` render the client chrome. The sidebar is persistent at
  `lg` and a Base UI modal-drawer below it; Base UI supplies focus trap, initial
  focus, Escape, scroll lock, outside-pointer dismissal, and focus return. The
  drawer closes on navigation.
- `src/components/admin/admin-account-menu.tsx` shows identity, Your account
  (`/dashboard`), View site (`/`), and Sign out through the existing
  `googleSignOut` action. `src/components/ui/dropdown-menu.tsx` wraps Base UI
  Menu for it.
- `src/components/admin/breadcrumbs.ts` resolves labels for implemented routes
  only and never links an unknown path. `/admin` renders one current `Admin`
  item and the header does not duplicate the page title.
- `src/lib/redirects.ts` sanitizes `callbackUrl` and
  `src/app/auth/signin/page.tsx` / `src/workflows/auth/google-oauth.ts` forward
  it, so the approved return-to-admin behaviour works. Absolute, protocol-
  relative, backslash, control-character, whitespace-padded, and non-admin
  destinations are rejected; `/admin/../other` normalizes to `/other`.
- `DialogContent` gained an optional `overlayClassName` prop (default
  unchanged) for the drawer scrim.
- Documentation: `docs/development/admin-shell.md`.

Verification: `npm run typecheck` (exit 0); `npm run lint` (exit 0); unit tests
(36 files, 318 passed); `npm run test:integration` (3 files, 40 passed);
production build (exit 0, known pre-existing `information_pages.position`
warning on the main database only); `npm run test:e2e` (11 passed in Chromium).
Authenticated admin/non-admin browser flows were not verified because local
Google OAuth credentials are placeholders; those decisions are covered by unit
tests.

## [0.4.8] - 2026-11-11

### feat: Shared confirmation dialogs (Prompt 048)

Added two reusable confirmation primitives for consequential administrator
operations. This prompt delivers the components and their documentation only:
no admin shell, no page wiring, and no operation-specific presets.

- Added `ConfirmationDialog`, a client component with a fully controlled
  `open`/`onOpenChange` lifecycle and an optional Base UI trigger.
  `defaultOpen` exists for tests and stories only.
- `onConfirm` is synchronous and caller-owned. The dialog calls it once, never
  awaits a return value, never derives state from a Promise, and only requests
  closure through `onOpenChange`; the caller decides whether to close.
- Cancel is focused on open; Base UI's default `finalFocus` returns focus to the
  trigger. Confirm and Cancel both request closure through Base UI `Close`.
- While `isPending`: Confirm and Cancel are disabled, Confirm is `aria-busy`
  with a `motion-reduce:animate-none` spinner and pending label, duplicate
  confirmation is blocked in the handler as well as by `disabled`, and Escape
  does not close the dialog.
- Configurable title, description, affected-content section, consequences
  section, eyebrow labels, confirm/cancel labels, pending label, and
  `variant="default" | "destructive"`. Sections render only when content is
  supplied and use `h3` inside labelled `section` elements under the dialog
  `h2`.
- Added `ConsequenceList`, a server-compatible neutral `<ul>` that renders
  nothing for an empty list and accepts an accessible label and `className`.
- No new dependencies, no schema changes, and no modifications to
  `src/components/ui/**`.

### Changed Files

- `src/components/dialogs/confirmation-dialog.tsx` — controlled dialog
- `src/components/dialogs/consequence-list.tsx` — neutral consequence list
- `tests/unit/components/confirmation-dialog.test.tsx` — 16 lifecycle tests
- `tests/unit/components/consequence-list.test.tsx` — 4 list tests
- `tests/unit/components/dialog-boundary.test.ts` — client/server boundary guard
- `docs/development/confirmation-dialogs.md` — API and usage guide
- `docs/README.md`, `docs/PROJECT_STATUS.md` — documentation index and status

### Verification

- `npm run typecheck` — pass
- `npm run lint` — pass
- Unit tests — 230 passed (22 new)
- Integration tests — 40 passed
- Playwright E2E — 9 passed (regression; no route was added)
- `npm run build` — pass (pre-existing main-database `information_pages.position`
  warnings persist and degrade gracefully)
- Two initial E2E navigation failures were cold dev-compile timeouts after the
  production build invalidated the dev cache; the affected spec passed on rerun
  and the full suite then passed 9/9. No Prompt 048 code is involved.

## [0.4.7] - 2026-11-11

### feat: Shared loading and empty states (Prompt 047)

Added reusable, accessible state primitives for later use by public and admin
interfaces. This prompt delivers the components only: no page wiring, no route
`loading.tsx`/`error.tsx` boundaries, and no migration of the existing
`Layout.EmptyState`.

- Added `Skeleton` (`text`, `circle`, `rectangle`) and `SkeletonGroup`, which
  owns one `role="status"` / `aria-live="polite"` announcement for any number of
  decorative bones and imposes no layout of its own.
- Added `ContentCardSkeleton`, mirroring `ContentCard`'s 2:3 poster,
  `rounded-xl` frame, `gap-3`, and metadata rhythm to limit layout shift. The
  whole block is decorative.
- Added `LoadingIndicator` with `inline` and `block` variants and `sm`/`md`/`lg`
  spinner sizes. The spinner is `aria-hidden`; the accessible name is `sr-only`
  text inside the component's single status region.
- Added `EmptyState` mirroring the existing public API (`icon`, `title`,
  `description`, `children`) plus optional `description`, `className`, and
  `headingLevel` (1–6, default 2, out-of-range falls back to `h2`).
- Added server-compatible `RetryState` (`role="alert"`) and a separate
  `RetryButton` client island. The button disables and sets `aria-busy` while
  retrying, blocks duplicate clicks, and announces `Retrying…`.
- All animated elements carry `motion-reduce:animate-none`.
- No new runtime or dev dependencies, no schema changes, and no modifications to
  `src/components/ui/**` or the existing `Layout.EmptyState`.

### Changed Files

- `src/components/states/heading.ts` — heading level type and tag resolver
- `src/components/states/skeleton.tsx` — `Skeleton` and `SkeletonGroup`
- `src/components/states/content-card-skeleton.tsx` — card placeholder
- `src/components/states/loading-indicator.tsx` — inline and block loading
- `src/components/states/empty-state.tsx` — shared empty state
- `src/components/states/retry-state.tsx` — server-compatible retry block
- `src/components/states/retry-button.tsx` — client retry island
- `tests/unit/components/*.test.ts(x)` — six new state-component test files
- `docs/development/state-components.md` — component API and usage guide
- `docs/README.md`, `docs/PROJECT_STATUS.md` — documentation index and status

### Verification

- `npm run typecheck` — pass
- `npm run lint` — pass
- Unit tests — 208 passed (68 component tests)
- Integration tests — 40 passed
- Playwright E2E — 9 passed (regression; no route was added)
- `npm run build` — pass (pre-existing main-database `information_pages`
  migration warnings persist and degrade gracefully)

## [0.4.6] - 2026-11-11

### feat: Shared content cards (Prompt 046)

Added one reusable, presentational card for drama and movie content. The card is
layout-agnostic so discovery grids and scroll-snap carousels can own sizing and
scrolling, and it never fabricates ratings, lifecycle status, or posters.

- Added `ContentCard` with a 2:3 portrait poster, title, content-type label,
  optional caller-supplied rating, optional drama lifecycle badge, and optional
  link. Movies never render a lifecycle badge.
- Ratings render only for a finite 1–5 average and a positive finite count;
  averages use one decimal and counts abbreviate without rounding up
  (`4.5 (1.2K)`). The full value is exposed to assistive technology.
- Posters use a plain `<img>` with `object-cover`; no Next.js image optimization
  or Sharp. A client-side island catches load errors and falls back to a muted
  placeholder when the URL is missing, empty, invalid, or fails to load.
- The card accepts an optional safe `href`; absent or invalid values render a
  non-interactive article, and no detail route is derived inside the component.
- Added React Testing Library and jsdom as dev-only dependencies. Vitest keeps
  `node` as the default environment; component tests opt into jsdom per file.
- No data fetching, page wiring, schema changes, or runtime dependencies.

### Changed Files

- `src/components/public/ContentCard.tsx` — card composition and optional link
- `src/components/public/ContentPoster.tsx` — client image island and fallback
- `src/components/public/content-card.ts` — types, labels, URL/rating helpers
- `tests/unit/components/content-card.test.tsx` — jsdom/RTL component coverage
- `tests/unit/components/content-card-helpers.test.ts` — helper coverage
- `vitest.config.ts` — discover `.test.tsx` unit tests; Node remains the default
- `package.json`, `package-lock.json` — dev-only test tooling
- `docs/development/testing-conventions.md` — component-test conventions

### Verification

- `npm run typecheck` — pass
- `npm run lint` — pass
- Unit tests — 172 passed
- Integration tests — 40 passed
- Playwright E2E — 9 passed (regression; no card-specific route was added)
- `npm run build` — pass

## [0.4.5] - 2026-11-11

### feat: Public footer links and information pages (Prompt 045)

The public footer now renders a configurable "Legal & information" row from the
database instead of hard-coded URLs. Six canonical pages are seeded as published
placeholders so every footer destination resolves; administrators can edit,
unpublish, hide, and reorder them later through a permission-protected API.

- Added `position` to `information_pages`, a partial unique slug index for
  active rows, and a partial footer index for the public query.
- Added migration `0002_information_page_footer_links.sql` with an idempotent
  seed (`ON CONFLICT … DO NOTHING`) for `terms`, `privacy`,
  `community-guidelines`, `copyright-dmca`, `about`, and `contact`. The seed
  never overwrites administrator-edited content.
- Added the `content` module's public API and service layer: footer query,
  published-page lookup, admin list/update/reorder, Zod validation, and
  `settings.manage` authorization at both the entrypoint and service level.
- Added `/information/[slug]` rendering published rows only; missing,
  unpublished, deleted, and malformed slugs return 404.
- `PublicFooter` keeps the Browse/Discover/Support columns, adds a wrapping
  legal row above the copyright line, and degrades to no legal links if the
  configuration cannot be loaded.
- Added admin REST endpoints for listing, updating, and transactionally
  reordering pages. No admin UI was added in this prompt.

### Changed Files

- `src/modules/content/schema.ts` — `position`, partial unique slug index, partial footer index
- `src/modules/content/information-pages.shared.ts` — canonical definitions, slug rules, validation
- `src/modules/content/information-pages.ts` — public queries and admin services
- `src/modules/content/index.ts` — module public API
- `src/app/admin/api/information-pages/` — protected list/update/reorder REST
- `src/app/(public)/information/[slug]/page.tsx` — published-only public page
- `src/components/public/Layout.tsx` — async footer with ordered legal row and fallback
- `drizzle/0002_information_page_footer_links.sql` — schema changes and idempotent seed
- `tests/unit/modules/content/information-pages.test.ts`, `tests/integration/content/information-pages.integration.test.ts`, `tests/e2e/information-pages.spec.ts` — coverage
- `docs/development/DATABASE.md`, `docs/development/API.md`, `docs/decisions/DECISIONS.md` — schema/API/decision records

### Verification

- `npm run typecheck` — pass
- `npm run lint` — pass
- Unit tests — 33 passed
- Integration tests — 40 passed
- Playwright E2E — 9 passed (responsive footer, navigation, 404, unauthenticated API)
- `npm run build` — pass with production-shaped environment

## [0.4.4] - 2026-11-11

### fix: Public site shell, navigation, and missing design tokens

The public site was rendering without a visible header or bottom navigation, and
most utilities in the vendored shadcn components produced no CSS. Root causes
were a Tailwind v3 runtime against Tailwind-v4-style components, a four-variable
token set, a missing base text colour, and a navigation component that was never
mounted.

- Upgraded `tailwindcss` from 3.4 to 4.3.5 and switched PostCSS to
  `@tailwindcss/postcss`; removed `tailwind.config.js` in favour of the
  CSS-first configuration in `src/app/globals.css`.
- Defined the full design-token set (`background`, `foreground`, `card`,
  `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`,
  `input`, `ring`), base body colours, heading typography, and the Geist font
  variable.
- Activated class-based dark mode on `<html>` and added a keyboard skip link.
- Rebuilt the public navigation as a client component: desktop header with
  primary links and account state, mobile bottom bar, and an accessible
  slide-over menu with Escape-to-close and scroll lock.
- Mounted the navigation in `PublicPageLayout`; made home-only marketing
  sections home-only; removed the duplicate home `<h1>`.
- Added `/trending`, `/bookmark`, and `/help` pages so every navigation and
  footer link resolves.
- Fixed Base UI tab orientation variants (`data-orientation` instead of the
  stale `data-horizontal` attributes), which had collapsed the tab layout.
- Extended the Playwright public-site spec to assert header visibility, desktop
  navigation, mobile bottom bar, menu open/close/navigate, readable colours,
  and every public route.

### Changed Files

- `package.json`, `package-lock.json` — Tailwind v4
- `postcss.config.js` — `@tailwindcss/postcss`
- `tailwind.config.js` — removed
- `src/app/globals.css` — Tailwind v4 import, tokens, base styles
- `src/app/layout.tsx` — Geist variable, dark class, skip link
- `src/components/public/Layout.tsx` — public shell, hero, browse, how-it-works, footer
- `src/components/public/PublicNavbar.tsx` — new responsive navigation
- `src/app/(public)/{page,drama,movie,categories,platforms,trending,bookmark,help}/page.tsx` — page structure and token styling
- `src/components/ui/tabs.tsx` — Base UI orientation variants
- `playwright.config.ts`, `tests/e2e/public-site.spec.ts` — deterministic shell coverage

## [0.4.3] - 2026-11-11

### feat: Desktop Navigation with Auth State Handling

- Added desktop navigation with Home, Trending, Bookmark, Category, and Login/Profile items
- Navigation items support state-aware rendering via `action` property on `NavItem`:
  - `none` — simple navigation (default)
  - `signin` — redirects to sign-in page (shown to guests)
  - `protected` — requires authentication (shown to authenticated users)
- Bookmark item has `action: 'protected'` — visible to guests, requires sign-in for functionality
- Login/Profile items show conditionally based on session state
- Secondary destinations placed in hamburger/overflow menu
- PublicNavbar component created with session state handling via `getActiveSession`
- Mobile navigation drawer implemented as static list
- TypeScript typecheck passes for all new functionality
- Updated NAV_ITEMS to include Trending and Bookmark
- Modified public page components to use simplified `PublicPageLayout` without `description` prop

### feat: Mobile Navigation

- Added mobile bottom navigation bar with Home, Trending, Bookmark, and Profile
- Category, Platform, and other secondary destinations placed in hamburger menu
- Navigation does not overlap the player, dialogs, or mobile browser safe areas
- TypeScript typecheck passes for all new functionality

### Changed Files

- `src/components/public/Layout.tsx` — Rewrote layout with mobile bottom navigation, hamburger menu, and PublicNavbar component
- `docs/PROJECT_STATUS.md` — updated current prompt and added entries for 043 and 044
- `docs/CHANGELOG.md` — documented prompt 043 and 044 changes