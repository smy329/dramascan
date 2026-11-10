# Changelog

All notable changes to the DramaScan project will be documented in this file.

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