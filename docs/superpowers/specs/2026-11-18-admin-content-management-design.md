# Admin content management: categories, platforms, seasons, episodes

**Date:** 2026-11-18
**Status:** Awaiting approval
**Scope owner:** approved change (not a numbered prompt in the pack)

## Intent and why

The admin panel can create a drama and nothing else in its content hierarchy. An administrator
cannot create a category or a platform (so the drama form's taxonomy checkboxes are always empty),
cannot add a season, and cannot add an episode (so no drama can ever become playable). The backend
for seasons and episodes already exists; the taxonomy backend does not.

The goal is to make the admin panel sufficient to publish a first playable drama without touching
SQL: create categories and platforms, add seasons and episodes to a drama, reorder them, and remove
mistakes.

Similar-drama management stays exactly as it is: the approved answer was "keep it". Nothing in this
work touches its page, routes, workflow, or permission.

## What exists today (verified)

- Sidebar (`src/components/admin/navigation.ts`) already declares Seasons, Episodes, Categories and
  Platforms, all `implemented: false` with no routes behind them.
- `seasons` and `episodes` tables, workflows (`src/workflows/admin/seasons.ts`,
  `src/workflows/admin/episodes.ts`) and REST routes (`/admin/api/seasons`, `/admin/api/episodes`)
  exist. The workflows already cover create, update, soft delete, reorder, move between seasons,
  renumber, and source replacement.
- Taxonomy has only the tables (`categories` with `visibility`/`position`, `platforms` with
  `position`, both soft-deletable, unique slug per active row) and one read,
  `listDramaTaxonomy`, used by the drama form.
- No drama detail page exists; the drama list links only to convert, convert-to-movie and
  similar-dramas pages.
- Reusable admin kit: `AdminForm` (React Hook Form + Zod + Server Action), `AdminFormField`,
  `AdminDataTable`, `AdminTableToolbar`, `AdminTablePagination`, `ConfirmationDialog`.

## Goals

1. `/admin/categories` and `/admin/platforms`: list, create, edit, reorder, soft delete.
2. `/admin/dramas/[id]`: drama summary plus season and episode management for that drama.
3. Seasons: create, edit, reorder, soft delete (with affected-episode count shown in the
   confirmation).
4. Episodes: create, edit, reorder within their scope, move between seasons of the same drama,
   explicit renumber, soft delete.
5. Categories and platforms are immediately available in the drama create form's checkbox groups.
6. Every route and mutation is gated by the canonical permission and re-checked server-side.
7. Unit, integration and Playwright coverage for the new surfaces, following existing test layout.

## Non-goals (this pass)

- Publication/unpublication, Trash restore and permanent deletion, bulk actions.
- Movies admin pages (`/admin/movies` stays unimplemented).
- Subtitle tracks, thumbnails, and source replacement preview for episodes. `episodes` has no
  thumbnail or subtitle columns yet, and source replacement requires the browser-preview flow from
  a later prompt.
- Any REST route for taxonomy. Server Actions are the transport for the new screens.
- Any database migration. Every column needed already exists.
- Similar-drama changes of any kind.
- Reworking `/admin/api/**` behaviour.

## Anti-goals

- A control that silently does nothing (for example a publish toggle without publication rules).
- A slug input. Slugs are derived from names, as the administrator already decided for dramas.
- Drag-and-drop as the only reorder mechanism.
- Client-side authorization.

## Constraints

- App Router, React Server Components by default; client components only for interactive forms and
  rows.
- `components/**` may import only `lib` and `lib/contracts`; domain schemas stay in modules.
- Server Actions resolve the actor and re-check permissions; the page guard is not the boundary.
- Soft delete only; never hard delete taxonomy or content rows.
- No new dependencies.

## Approaches considered

**A. Server Actions on three new pages (chosen).** Two taxonomy pages plus one drama detail page,
each rendering a client manager built on the existing form kit, calling new Server Actions that wrap
workflows. Matches the most recent admin work (`createDramaAction`) and keeps authorization,
validation and error mapping in one place.

**B. REST-first taxonomy.** Add `/admin/api/categories` and `/admin/api/platforms` plus fetch-based
clients. More transport code for no gain: nothing outside the admin panel consumes taxonomy CRUD
today.

**C. One combined "Content settings" page** with category/platform tabs. Fewer routes, but the
sidebar already models them as separate destinations, and a combined page would need its own
navigation concept.

A was chosen: it adds no transport surface, reuses the tested kit, and keeps each screen behind its
own canonical permission.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Slugs for categories/platforms are derived from the name with the same rules as dramas; no slug field. | Matches the administrator's explicit instruction for dramas; one slug rule in the app. |
| 2 | Extract `slugFromText`/`SLUG_MAX_LENGTH` into `src/lib/contracts/slug.ts`; `dramaSlugFromTitle` delegates. | Avoid a second copy of the derivation rules; existing imports keep working. |
| 3 | Taxonomy name uniqueness is checked case-insensitively among active rows and reported on `name`. | Requirement 4.4 requires unique names; the database only enforces slug. |
| 4 | Category `visibility` is exposed as `visible`/`hidden`, default `visible`. | Requirement 8.6 names visibility for categories. Nothing reads it yet, so the field carries a hint that public category browse will enforce it; documented as stored-but-not-yet-enforced. |
| 5 | Taxonomy delete is soft delete; association rows are kept so a restore keeps links. Confirmation shows how many dramas/movies use the row. | Requirement 5.x soft-deletion rule; deleting must not silently detach content. |
| 6 | Ordering uses explicit "Move up"/"Move down" buttons calling a two-phase reorder workflow; no drag-and-drop. | Accessible, keyboard-operable, testable, no new dependency; requirements accept an equivalent. |
| 7 | Seasons are managed only when the drama's structure is `season_based`; a flat drama shows an explanation and a link to structure conversion. | A flat drama must never be forced into seasons (requirement 4.2). Conversion already creates Season 1. |
| 8 | `createSeason` allocates the next free position when none is supplied, inside the existing drama lock. | Today it defaults to `0`, so a second season collides. The admin UI should not ask for a position on create. |
| 9 | New `reorderSeasons` workflow clears positions then rewrites them in one transaction. | `uq_seasons_drama_id_position_active` makes naive swaps collide. |
| 10 | Episode create/edit exposes title, description, season (season-based only), episode number (optional, auto), position (auto), and video source URL. Publication state is not editable here and stays `draft`. | Publication rules and browser-preview verification belong to a later prompt; showing a toggle now would create published-but-unverified episodes. |
| 11 | Episode season changes go through `moveEpisodesToSeason` after the metadata update, so the episode is appended inside the target season. | `updateEpisode` sets `season_id` without reallocating position, which can duplicate a position. |
| 12 | Episode reorder passes only the ids of the episode's own scope (one season, or the seasonless set). | `reorderEpisodes` assigns `0..n-1` to exactly the ids given; passing a whole drama would flatten per-season positions. |
| 13 | A "Renumber episodes" button calls the existing drama-wide `renumberEpisodes`. | Requirement 4.7 allows explicit renumbering; numbering is drama-wide (D-032). |
| 14 | `/admin/dramas/[id]` requires `drama.manage`; season and episode sections and mutations require `season.manage` / `episode.manage` respectively. | Simplest coherent boundary with the existing dramas list. A role holding only `episode.manage` gets admin-area access through the drill-down permission list but cannot reach the page; recorded as a limitation. |
| 15 | Extract the drama form's local select field into `AdminFormSelectField` and reuse it. | Three new forms need selects; copying the pattern three more times invites drift. |

## Design

### Taxonomy data layer

`src/workflows/admin/taxonomy.ts` (server-only, `category.manage` / `platform.manage`):

- `listCategories(actor, query)` / `listPlatforms(actor, query)` — active rows ordered by position
  then name, optional search, usage counts for the confirmation text.
- `createCategory(actor, input)` / `createPlatform(actor, input)` — input `{ name, visibility? }`
  (visibility categories only); derives the slug; rejects a duplicate active name or slug with a
  `validation_error` carrying field errors; allocates `position = max + 1`.
- `updateCategory` / `updatePlatform` — name and visibility only; re-derives the slug; same
  duplicate checks, excluding the row itself.
- `deleteCategory` / `deletePlatform` — sets `deleted_at`, returns the usage count.
- `reorderCategories` / `reorderPlatforms` — two-phase position rewrite for the named ids.

`src/workflows/admin/taxonomy-actions.ts` — Server Actions (`createCategoryAction`,
`updateCategoryAction`, `deleteCategoryAction`, `reorderCategoriesAction`, and platform
equivalents). Each resolves the actor, re-checks the permission, validates with the client-safe
schema, calls the workflow, and maps errors through the existing `mapErrorToActionResult`, remapping
a `slug` conflict onto `name` (the only visible field).

`src/lib/contracts/taxonomy-form.ts` — client-safe Zod schemas (name 1–80 chars, category visibility
enum), defaults, and `taxonomySlugFromName`.

### Taxonomy pages

- `src/app/admin/categories/page.tsx`, `src/app/admin/platforms/page.tsx` — `force-dynamic`, gate
  with `requireAdminPageAccess` + the resource's `manage` permission (404 otherwise), load rows and
  render the manager.
- `src/components/admin/taxonomy/taxonomy-manager.tsx` — client component parameterised by
  resource: a create form (`AdminForm` + `AdminFormField` + `AdminFormSelectField` for visibility),
  a table of rows with name, position, usage and actions, inline edit forms, move up/down, and a
  `ConfirmationDialog` delete that names the affected usage count.
- Navigation: flip `categories` and `platforms` to `implemented: true`.

### Drama detail page

- `getDramaForAdmin(actor, dramaId)` in `src/workflows/admin/dramas.ts` — drama fields, category and
  platform names, active season and episode counts, `drama.manage`.
- `src/app/admin/dramas/[id]/page.tsx` — summary card (title, slug, structure, status, visibility,
  categories, platforms), links to convert / convert-to-movie / similar-dramas, then the season and
  episode sections. Episodes are grouped by season for season-based dramas and rendered as one list
  for flat dramas.
- Dramas list: the title becomes a link to the detail page; the action column keeps its existing
  links (similar-dramas untouched).

### Seasons

- `src/workflows/admin/seasons.ts`: position optional on create with next-free allocation;
  new `reorderSeasons(actor, dramaId, seasonIds)`.
- `src/workflows/admin/season-actions.ts`: create, update, delete, reorder Server Actions, each
  re-checking `season.manage` and mapping errors.
- `src/components/admin/dramas/season-manager.tsx`: create form, rows with title/position/episode
  count, inline edit, move up/down, delete confirmation showing the affected episode count (the
  workflow trashes the season and its episodes together).

### Episodes

- `src/workflows/admin/episode-actions.ts`: create, update (metadata plus optional season move),
  delete, reorder, and renumber Server Actions over the existing workflows, each re-checking
  `episode.manage`. Video source uses `publicationReadyVideoSourceSchema`, so an invalid or non-HTTPS
  URL is a field error, never a stored value.
- `src/components/admin/dramas/episode-manager.tsx`: create form (season select populated from the
  drama's seasons, or hidden for flat dramas; title, description, optional number, optional video
  URL), grouped rows with number, title, season, source status, publication state, edit, delete,
  move up/down, plus a drama-wide renumber button.

### Shared pieces

- `src/lib/contracts/slug.ts` — one slug rule; `dramaSlugFromTitle` and `taxonomySlugFromName`
  delegate to it.
- `src/components/admin/forms/admin-form-select-field.tsx` — extracted from the drama form's local
  `SelectField`, used by the drama form and the new forms.

## Files

New: `src/lib/contracts/slug.ts`, `src/lib/contracts/taxonomy-form.ts`,
`src/lib/contracts/season-form.ts`, `src/lib/contracts/episode-form.ts`,
`src/workflows/admin/taxonomy.ts`, `src/workflows/admin/taxonomy-actions.ts`,
`src/workflows/admin/season-actions.ts`, `src/workflows/admin/episode-actions.ts`,
`src/components/admin/taxonomy/taxonomy-manager.tsx`,
`src/components/admin/dramas/season-manager.tsx`,
`src/components/admin/dramas/episode-manager.tsx`,
`src/components/admin/forms/admin-form-select-field.tsx`,
`src/app/admin/categories/page.tsx`, `src/app/admin/platforms/page.tsx`,
`src/app/admin/dramas/[id]/page.tsx`, and matching tests.

Modified: `src/components/admin/navigation.ts`, `src/app/admin/dramas/page.tsx`,
`src/workflows/admin/dramas.ts`, `src/workflows/admin/seasons.ts`,
`src/lib/contracts/drama-form.ts` (delegate the slug helper),
`src/components/admin/dramas/drama-create-form.tsx` (use the shared select),
`tests/unit/components/admin-navigation.test.ts`, `docs/CHANGELOG.md`, `docs/PROJECT_STATUS.md`,
`docs/decisions/DECISIONS.md`.

No migration, no REST route, no permission catalog change (every needed key already exists).

## Verification

- `npm run typecheck`, `npm run lint`, `npm test`.
- Integration tests against `TEST_DATABASE_URL`: taxonomy CRUD, duplicate-name rejection, soft
  delete preserving associations, season position allocation and reorder, episode create with
  auto-numbering, move between seasons, reorder scoping, renumber, permission denials.
- Playwright (Chromium, managed dev server): create a category, create a platform, see both in the
  drama create form, create a season-based drama, add two seasons, add episodes to each, reorder
  one, and delete a category.
- Production build with the HTTPS `APP_URL`/`TRUSTED_ORIGINS` overrides.

## Risks and limitations

- Category `visibility` is stored but not yet enforced anywhere; the field says so.
- A role with only `season.manage`/`episode.manage` cannot open `/admin/dramas/[id]` because the
  list and detail pages require `drama.manage`.
- Episodes stay `draft`, so nobody can publish from these screens yet; the panel explains this.
- Season delete trashes its episodes and offers no restore UI in this pass.
