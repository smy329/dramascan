# Changelog

All notable changes to the DramaScan project will be documented in this file.

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

- `package.json`, `package-lock.json` ΓÇö Tailwind v4
- `postcss.config.js` ΓÇö `@tailwindcss/postcss`
- `tailwind.config.js` ΓÇö removed
- `src/app/globals.css` ΓÇö Tailwind v4 import, tokens, base styles
- `src/app/layout.tsx` ΓÇö Geist variable, dark class, skip link
- `src/components/public/Layout.tsx` ΓÇö public shell, hero, browse, how-it-works, footer
- `src/components/public/PublicNavbar.tsx` ΓÇö new responsive navigation
- `src/app/(public)/{page,drama,movie,categories,platforms,trending,bookmark,help}/page.tsx` ΓÇö page structure and token styling
- `src/components/ui/tabs.tsx` ΓÇö Base UI orientation variants
- `playwright.config.ts`, `tests/e2e/public-site.spec.ts` ΓÇö deterministic shell coverage

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

### Changed Files

- `src/components/public/Layout.tsx` — Rewrote layout with PublicNavbar component, added Trending/Bookmark to NAV_ITEMS, simplified function signatures
- `src/app/(public)/page.tsx` — Removed `description` prop from `PublicPageLayout`
- `src/app/(public)/drama/page.tsx` — Removed `description` prop from `PublicPageLayout`
- `src/app/(public)/movie/page.tsx` — Removed `description` prop from `PublicPageLayout`
- `src/app/(public)/categories/page.tsx` — Removed `description` prop from `PublicPageLayout`
- `src/app/(public)/platforms/page.tsx` — Removed `description` prop from `PublicPageLayout`