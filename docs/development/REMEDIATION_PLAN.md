# DramaScan Production Remediation Plan

**Document:** Audit finding register, implementation order, test strategy, and release gate

**Date:** 2026-11-16

**Baseline:** `main` at `1719598` (`feat: implement similar drama management (Prompt 071)`)

**Status:** Phase 0 in progress. No audit finding is marked resolved until regression evidence passes.

**Authority:** `AGENTS.md` → `docs/requirements/REQUIREMENTS.md` → `docs/decisions/DECISIONS.md` → `docs/architecture/ARCHITECTURE.md` → `docs/development/CONVENTIONS.md` → this plan. This plan does not replace those sources and must be corrected if it conflicts with them.

---

## 1. Operating Rules

1. Inspect the current implementation before changing it.
2. Never discard or overwrite the three pre-existing working-tree changes:
   - `src/app/admin/dramas/[id]/similar-dramas/page.tsx`
   - `src/modules/authorization/permissions.ts`
   - `src/workflows/admin/similar-dramas.ts`
3. Preserve the modular-monolith architecture and all prohibited-infrastructure constraints.
4. Use forward-only Drizzle migrations. Never rewrite an applied migration.
5. Use PostgreSQL integration tests for persistence and transaction guarantees. Mocks do not prove database correctness.
6. Every task follows RED → GREEN → regression → typecheck/lint → diff review → commit.
7. Do not mark a finding resolved merely because code changed. Require passing regression evidence.
8. Run the phase acceptance gate before beginning the next phase.
9. Use only `TEST_DATABASE_URL` for integration and E2E database operations. The database name must end in `_test`.
10. Never commit `.env` files, credentials, test artifacts containing secrets, or unrelated user changes.

---

## 2. Phase 0 Baseline

The complete baseline was executed against the current working tree before any remediation source change.

| Check                      | Result   | Evidence                                                                                                  |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`        | **FAIL** | 3 errors in `src/workflows/admin/similar-dramas.ts` at lines 209, 267, 313                                |
| `npm run lint`             | **FAIL** | 16 errors                                                                                                 |
| `npm test`                 | **FAIL** | 636 passed, 1 failed: `tests/unit/components/admin-navigation.test.ts:40`                                 |
| `npm run test:integration` | **PASS** | 14 files, 191/191 tests                                                                                   |
| `npm run build`            | **FAIL** | `useState`/`useEffect` imported into an async Server Component                                            |
| `npm run test:e2e`         | **FAIL** | 16 passed, 15 failed; admin crash from `Dynamic href '/admin/dramas/[id]/similar-dramas' found in <Link>` |

**Baseline conclusion:** TEST-01 is a blocker. The failures are consequences of the confirmed defects, not independent infrastructure gaps.

**Working-tree state at baseline:**

```text
M src/app/admin/dramas/[id]/similar-dramas/page.tsx
M src/modules/authorization/permissions.ts
M src/workflows/admin/similar-dramas.ts
```

Diff: 3 files, 36 insertions, 19 deletions. The modifications do not resolve the similar-drama defects: the page still violates the Server/Client boundary, ignores the dynamic drama ID, the search SQL is invalid, mutation mapping remains incompatible, and the database permission catalog still diverges.

---

## 3. Finding Register

### 3.1 Critical Findings

| ID   | Severity | Status    | Phase | Affected files                                                                                                                                 | Root cause → required correction                                                                                                                                                                                                                                                                                                       | Regression coverage                                                                                                                                                                               |
| ---- | -------- | --------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-01 | Critical | Confirmed | P1    | `src/components/admin/navigation.ts`, `src/components/admin/admin-sidebar.tsx`, `tests/unit/components/admin-navigation.test.ts`               | The sidebar renders the unresolved dynamic path `/admin/dramas/[id]/similar-dramas` through `next/link`, crashing the admin layout. Remove it from top-level navigation; expose the feature from a concrete drama workflow; permit only implemented, statically resolvable destinations.                                               | Reject dynamic tokens and absent pages in the navigation unit test; restore admin overview, drama, user, and conversion E2E coverage.                                                             |
| C-02 | Critical | Confirmed | P2    | `src/app/public/api/dramas/route.ts`, `src/modules/content/publication.ts`, `src/modules/content/schema.ts`, `src/app/(public)/drama/page.tsx` | The public API queries raw dramas, trusts caller publication/visibility filters, is unbounded, and returns raw snake_case rows. Route every public visibility decision through one hierarchy-aware availability service, ignore client attempts to weaken visibility, use approved public DTOs, and paginate with a unique tiebreaker. | Availability unit cases plus anonymous API integration tests for published, draft, unpublished, hidden, trashed, ancestor-unpublished, empty-drama, crafted-filter, DTO, and pagination behavior. |

### 3.2 High-Severity Findings

| ID   | Severity | Status    | Phase | Affected files                                                                                                               | Root cause → required correction                                                                                                                                                                                                                                                                                                                                                                                                          | Regression coverage                                                                                                                |
| ---- | -------- | --------- | ----- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| H-01 | High     | Confirmed | P1    | Similar-drama page, API route, workflow, table contracts, `src/app/admin/_access.ts`, `src/components/admin/admin-access.ts` | An async Server Component calls hooks, does not await/use `params.id`, expects the wrong envelope, requests nonexistent endpoints, links to a nonexistent edit route, uses the wrong search parameter, exposes unsupported sorting, and lacks `similar_drama.manage`. Split server loading from client interaction; await route parameters; align contracts; implement valid Add/Remove/Reorder; enforce permission in page and workflow. | Server/Client page tests and a full similar-drama E2E workflow.                                                                    |
| H-02 | High     | Confirmed | P1    | `src/workflows/admin/similar-dramas.ts`, `src/app/admin/api/similar-dramas/route.ts`, `src/modules/content/schema.ts`        | Search inserts a bare `SELECT` into a boolean predicate; Add/Update return flat association rows while the mapper expects joined `dramas`; position validation is not applied. Correct the join/`EXISTS` predicate, map joined rows, validate target/position, and map before committing/returning success.                                                                                                                               | PostgreSQL search, add, update, duplicate, self-reference, deleted-target, invalid-position, rollback, and response-mapping tests. |
| H-03 | High     | Confirmed | P3    | `src/workflows/admin/roles.ts`, `src/workflows/admin/users.ts`, role/user API routes, authorization/auth schemas             | Role, permission, and user-management workflows return placeholders and false success. Implement real persistence with target IDs, transactions, permission assignment/revocation, multiple roles, deactivation/reactivation, and last-active-Super-Admin locking. Use POST/PATCH/DELETE, never GET mutations.                                                                                                                            | Persisted-state role/user integration tests plus API authorization/method tests.                                                   |
| H-04 | High     | Confirmed | P4    | `src/workflows/admin/dramas.ts`, `src/modules/content/validation.ts`, `src/modules/content/schema.ts`, baseline migration    | Drama creation drops category/platform arrays; update writes associations non-atomically; duplicates and invalid targets are unchecked. Persist both sets in one transaction, deduplicate IDs, validate targets, and make replacement atomic.                                                                                                                                                                                             | Create-association, rollback, invalid-target, duplicate-input, and simultaneous replacement integration tests.                     |
| H-05 | High     | Confirmed | P4    | `src/workflows/admin/episodes.ts`, `src/modules/content/schema.ts`                                                           | Episode duplicate-number validation compares `episodes.drama_id` to the episode ID; season ownership compares `seasons.drama_id` to the episode ID. Load the episode's real parent drama and validate the season and number against that drama.                                                                                                                                                                                           | Same-drama duplicate, valid own-season, foreign-season, and cross-drama integration tests.                                         |
| H-06 | High     | Confirmed | P4    | `src/workflows/admin/seasons.ts`, `src/modules/content/schema.ts`, requirements                                              | Season deletion soft-deletes only the season and nulls episode parents. Atomically move the season and active episode hierarchy to Trash while preserving restorable relationships and reporting the accurate affected count.                                                                                                                                                                                                             | Delete rollback, count, restoration-eligibility, and unrelated-episode isolation tests.                                            |
| H-07 | High     | Confirmed | P4    | `src/workflows/admin/episodes.ts`, `src/modules/content/schema.ts`                                                           | Create/reorder/renumber/move use unlocked max calculations and independent updates; duplicate reorder IDs are accepted. Serialize the relevant parent/range, reject duplicate IDs, and add uniqueness guarantees.                                                                                                                                                                                                                         | Sequential and concurrent create, renumber, reorder, and move tests.                                                               |
| H-08 | High     | Confirmed | P4    | Content and authorization schemas, migrations `0000`/`0004`, database documentation                                          | Hierarchy/taxonomy/similar-drama FKs and scoped uniqueness/indexes are missing; `user_roles.user_id` lacks its FK. Add forward-only constraints and indexes after auditing/reconciling existing invalid rows.                                                                                                                                                                                                                             | Populated-database migration and schema constraint tests.                                                                          |
| H-09 | High     | Confirmed | P4    | `src/modules/users/schema.ts`, analytics/playback schemas, baseline migration, D-020                                         | Generic `content_type`/`content_id` replaces typed nullable drama/movie relationships, without exactly-one checks, FKs, or per-user/target uniqueness. Migrate via expand/contract with a documented reconciliation path for ambiguous rows.                                                                                                                                                                                              | Typed user-content and analytics persistence/migration tests.                                                                      |
| H-10 | High     | Confirmed | P7    | Episode/movie workflows, user/playback schemas, requirements                                                                 | Source replacement is a single update with no preview evidence, confirmation, transaction, progress/watched reset, preserved-history assertion, or audit event; ordinary update paths accept a new source. Build one authoritative replacement workflow and remove bypasses.                                                                                                                                                              | Source-replacement persistence and browser workflow tests.                                                                         |
| H-11 | High     | Confirmed | P7    | Content validation/publication/schema, admin publication workflow                                                            | An HTTPS `.mp4` URL is treated as sufficient publication evidence. Persist browser playback/seek evidence bound to a source fingerprint, invalidate it on source change, and require valid evidence plus confirmation to publish.                                                                                                                                                                                                         | Invalidation unit tests, publication integration tests, and real Chromium playback verification.                                   |
| H-12 | High     | Confirmed | P5    | Drama/season/episode API routes, content validation, table contracts                                                         | Route IDs are passed into strict payload schemas; identifiers mix casing; GET parses JSON; malformed JSON becomes 500. Separate route parameters from DTOs, map camelCase API DTOs, use query parameters for GET, and map malformed JSON to 400.                                                                                                                                                                                          | Full contract tests for every drama, season, and episode operation.                                                                |
| H-13 | High     | Confirmed | P5    | Admin API `_shared.ts` files and mutation routes, security documentation                                                     | Same-origin helpers exist but are not invoked; the helper accepts requests with neither header. Invoke the check on every protected mutation and implement a documented fail-closed/non-browser policy consistently.                                                                                                                                                                                                                      | Table-driven same-origin tests for cross-site, same-origin, and missing-header cases across mutation routes.                       |
| H-14 | High     | Confirmed | P6    | `src/platform/auth/session.ts`, authorization actors/session management, config schema, auth schema                          | Pages enforce timeout while REST/Server Actions do not; session enrichment selects an arbitrary user session, measures maximum lifetime from last activity, and refreshes all sessions; invalid config can become `NaN`. Centralize exact-cookie session resolution and enforce both limits everywhere.                                                                                                                                   | Concurrent-session, expiry, maximum-lifetime, config-validation, and cross-entrypoint tests.                                       |
| H-15 | High     | Confirmed | P6    | Login monitoring, Better Auth/auth hooks, Google OAuth workflow, auth route/schema                                           | Monitoring has no authentication call sites; window and expiry calculations are wrong; success deletes audit history; dashboard counts recent failures as locked. Wire recording/restriction into the real lifecycle, use the configured window, anchor expiry at threshold crossing, and preserve audit history.                                                                                                                         | Real-flow failed/success login integration tests and lockout recovery tests.                                                       |
| H-16 | High     | Confirmed | P1/P5 | `src/app/admin/api/dramas/_shared.ts`, drama/episode/similar-drama routes                                                    | Delete handlers send `{ok:true}` with status 204, which cannot contain a body. Add a bodyless 204 path and use the standard envelope only for non-204 responses.                                                                                                                                                                                                                                                                          | Delete response-construction and route contract tests.                                                                             |
| H-17 | High     | Confirmed | P5    | `src/app/admin/api/episodes/route.ts`, `src/workflows/admin/episodes.ts`                                                     | Exports named `PUT_renumber`, `PUT_reorder`, and `POST_move` are unreachable. Create dedicated route files with standard method exports and distinct DTOs.                                                                                                                                                                                                                                                                                | Route-dispatch/contract tests and episode E2E coverage.                                                                            |
| H-18 | High     | Confirmed | P3    | Authorization permissions/schema, migration `0004`, navigation, similar-drama workflow                                       | Working tree adds `similar-drama.manage`, but the applied CHECK does not allow it and the resource violates lowercase snake-case naming. Adopt `similar_drama.manage`, update all references, and add a forward CHECK migration.                                                                                                                                                                                                          | Permission catalog tests and migration tests for accepted catalog keys and rejected unknown keys.                                  |

### 3.3 Medium-Severity Findings

| ID   | Severity | Status    | Phase | Affected files                                                                | Root cause → required correction                                                                                                                                                                                                          | Regression coverage                                                                     |
| ---- | -------- | --------- | ----- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| M-01 | Medium   | Confirmed | P4    | `src/workflows/admin/dramas.ts`, `src/workflows/admin/episodes.ts`            | Raw title/slug or number `OR` expressions sit directly inside `and(...)`, allowing SQL precedence to bypass parent/publication/deleted predicates. Group search alternatives in an explicit `or(...)`.                                    | Integration tests proving search cannot escape active parent and publication scope.     |
| M-02 | Medium   | Confirmed | P4    | `src/workflows/admin/seasons.ts`                                              | Season position validation compares `seasons.drama_id` to the season ID. Load the real parent drama and exclude the current season from the conflict check.                                                                               | Same-drama duplicate, cross-drama allowed, and self-exclusion tests.                    |
| M-03 | Medium   | Confirmed | P2    | `src/app/(public)/drama/page.tsx`, public API route                           | The page requests `/api/public/dramas`, but the route is `/public/api/dramas`; no rewrite exists. Call the public query service directly from the Server Component.                                                                       | Public catalogue E2E with no failed network request/error state.                        |
| M-04 | Medium   | Confirmed | P2    | Public drama listing and expected detail routes                               | Cards link to `/drama/{slug}` without the stable ID and contain an `href="#"` nested inside the card anchor. Use `/drama/{id}/{slug}` and remove nested interactive elements.                                                             | Canonical href and nested-anchor E2E assertions.                                        |
| M-05 | Medium   | Confirmed | P1    | `src/components/admin/navigation.ts`, sidebar, navigation test                | Movies and Episodes are marked implemented without pages. Mark absent destinations unimplemented or implement them, and validate implemented flags against route existence.                                                               | Navigation consistency test against existing pages and static resolvability.            |
| M-06 | Medium   | Confirmed | P1/P9 | `src/components/dialogs/confirmation-dialog.tsx`, admin callers, dialog tests | The confirm control is an `AlertDialogPrimitive.Close`, so it can close before an async operation settles. Await the operation; keep pending and failure visible; close only after explicit success.                                      | Deferred success and failure dialog tests.                                              |
| M-07 | Medium   | Confirmed | P4    | `src/modules/reviews/schema.ts`, baseline migration                           | Ratings lack a 1–5 CHECK; reactions/reports lack FKs and uniqueness; reports have no active/resolved lifecycle. Add constraints, FKs, partial uniqueness, and report state after auditing invalid rows.                                   | PostgreSQL constraint tests for ratings, reactions, reports, and lifecycle replacement. |
| M-08 | Medium   | Confirmed | P4    | `src/workflows/admin/dramas.ts`, content schema/indexes                       | Admin drama pagination lacks a unique final tiebreaker. Add row ID as the last ordering key and a matching index where justified.                                                                                                         | Repeated equal-sort-value pagination tests in both directions.                          |
| M-09 | Medium   | Confirmed | P2    | Similar-drama API/workflow/page                                               | A missing drama is returned as an empty success, and the route ignores workflow failure. Return standard 404 for missing parents and reserve 200 plus empty collection for a valid drama with no recommendations; render distinct states. | Missing-parent and valid-empty API/integration/UI tests.                                |

### 3.4 Accessibility and Responsive Findings

| ID     | Severity | Status    | Phase | Affected files                                                            | Root cause → required correction                                                                                                                                                                                         | Regression coverage                                                                  |
| ------ | -------- | --------- | ----- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| ACC-01 | Medium   | Confirmed | P9    | `src/components/public/PublicNavbar.tsx`, public E2E                      | The custom mobile dialog has no focus trap or opener-focus restoration. Use an accessible modal primitive or implement Tab containment, Escape, and focus restoration.                                                   | Keyboard open, focus cycle, Escape, and reopen E2E tests.                            |
| ACC-02 | Medium   | Confirmed | P9    | `src/app/layout.tsx`, sign-in/dashboard/admin-shell routes                | The global skip link targets `#main-content`, which several routes do not provide. Ensure every route exposing the link has a unique main-content target.                                                                | Route-level skip-link focus E2E tests.                                               |
| ACC-03 | Medium   | Confirmed | P9    | `src/app/(public)/categories/page.tsx`                                    | `aria-labelledby` IDs derive from heading text and contain spaces. Generate stable identifier-safe IDs independent of display text.                                                                                      | Component assertions that every ARIA token is whitespace-free and resolves uniquely. |
| ACC-04 | Medium   | Confirmed | P9    | `src/components/public/PublicNavbar.tsx`, public E2E                      | Desktop and mobile header breakpoints overlap, overflowing at tablet width. Use non-overlapping breakpoints.                                                                                                             | Tablet-boundary header completeness/overflow E2E test.                               |
| ACC-05 | Low      | Confirmed | P9    | `src/app/(public)/drama/page.tsx`, `public/placeholder-drama.svg`         | Poster images lack dimensions, use a missing fallback, and crop portrait art as landscape. Add a real fallback, intrinsic dimensions, and portrait aspect ratio.                                                         | Missing/broken poster E2E assertions for fallback, dimensions, and layout stability. |
| ACC-06 | Low      | Confirmed | P9/P1 | Similar-drama page/table                                                  | Poster images specify only height. Add intrinsic width/height or a fixed aspect ratio.                                                                                                                                   | Image-dimension component assertion.                                                 |
| ACC-07 | Low      | Confirmed | P9    | `src/components/ui/button.tsx`, `src/components/ui/tabs.tsx`              | Shared controls use broad `transition-all`. Replace with only the properties each state animates.                                                                                                                        | Static regression review plus existing component suites.                             |
| ACC-08 | Medium   | Confirmed | P9    | Public drama page, similar-drama page, confirmation dialog, shared states | Error states offer no working retry; request failures are shown as empty; confirmation failures can disappear with the modal. Implement distinct error/empty states, a retry action, and persistent confirmation errors. | Error/retry component tests, public E2E, and similar-drama failure E2E.              |

### 3.5 Missing Initial-Scope Functionality

#### Public Product

| ID        | Severity | Status    | Phase | Affected files                                                             | Root cause → required correction                                                                                                                                                                                                    | Regression coverage                                                          |
| --------- | -------- | --------- | ----- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| SCOPE-P01 | High     | Confirmed | P8    | Public route group; expected drama/movie/episode detail routes             | Only catalogue placeholders exist. Implement stable-ID canonical drama, movie, and episode/watch pages with availability checks, metadata, related data, slug redirects, and parent validation.                                     | Public detail/watch E2E suites.                                              |
| SCOPE-P02 | High     | Confirmed | P8    | Expected player components, playback module/workflow/API                   | No Vidstack player or progress service exists. Implement direct external-MP4 playback, seeking, bounded/debounced progress, stale-write rejection, completion logic, and Retry.                                                     | Player unit, playback integration, and Chromium playback E2E tests.          |
| SCOPE-P03 | High     | Confirmed | P8    | Expected watch-history/continue-watching pages and user/playback queries   | No authenticated Continue Watching or Watch History workflow exists. Implement owner-scoped queries/pages with shared completion logic and history independent of progress resets.                                                  | Owner isolation, completion, and history-preservation integration/E2E tests. |
| SCOPE-P04 | High     | Confirmed | P8    | `src/app/(public)/bookmark/page.tsx`, user services, detail actions        | The page is a permanent guest empty state; no bookmark mutation or owner-scoped list exists. Implement drama/movie bookmarks with add/remove and publication-aware rendering.                                                       | Bookmark persistence/owner-isolation integration tests and E2E flows.        |
| SCOPE-P05 | High     | Confirmed | P8    | Expected search page/query/suggestions route                               | No database-backed full-text/trigram search, suggestions, or results exist. Implement published-only search across approved fields with bounded pagination and allowlisted filters/sorts.                                           | Search integration tests and autocomplete/results E2E.                       |
| SCOPE-P06 | High     | Confirmed | P8    | Public home/trending/movie/drama pages; analytics ranking services         | Home is effectively empty; Trending is not activity-ranked; Movies tabs are static; complete-series counts all dramas. Implement real rankings, Recently Added using `published_at`, Highest Rated, and completed-series filtering. | Ranking/count integration tests and discovery E2E.                           |
| SCOPE-P07 | Medium   | Confirmed | P8    | Public categories/platforms pages; taxonomy queries                        | Public taxonomy is hardcoded. Query active, visible, published-content-backed taxonomy and show real empty states.                                                                                                                  | Taxonomy integration tests and public E2E.                                   |
| SCOPE-P08 | Medium   | Confirmed | P8/P9 | Expected public `loading.tsx`, `error.tsx`, `not-found.tsx`, shared states | Public route groups lack framework-level loading, error, and not-found boundaries. Add them with useful recovery.                                                                                                                   | Failure/retry/loading E2E and shared-state component tests.                  |

#### Admin Product

| ID        | Severity | Status    | Phase  | Affected files                                             | Root cause → required correction                                                                                                                                                       | Regression coverage                                                         |
| --------- | -------- | --------- | ------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| SCOPE-A01 | High     | Confirmed | P8     | Expected admin seasons/episodes pages; existing workflows  | Only API workflows exist. Build server-paginated season/episode tables and forms for CRUD, numbering, ordering, movement, and source status using canonical contracts.                 | Season and episode E2E suites.                                              |
| SCOPE-A02 | High     | Confirmed | P8     | Expected admin movies page, movie workflow/API             | Movies have an API but no administrator UI. Add movie CRUD, taxonomy, publication, subtitles, and source-replacement entry points without modeling movies as dramas.                   | Movie administration E2E.                                                   |
| SCOPE-A03 | Medium   | Confirmed | P8     | Expected admin categories/platforms pages; content schema  | No administrator taxonomy CRUD exists. Add name/slug/position/visibility forms with uniqueness and referenced-deletion protection.                                                     | Taxonomy E2E and referenced-deletion integration tests.                     |
| SCOPE-A04 | High     | Confirmed | P8     | Expected admin Trash surfaces and soft-delete workflows    | No complete Trash, restore, permanent-delete, or consequence-preview workflow exists. Implement it for dramas, seasons, episodes, and movies with Super-Admin-only permanent deletion. | Trash E2E and transactional cleanup integration tests.                      |
| SCOPE-A05 | High     | Confirmed | P7/P8  | Expected source-preview components and episode/movie forms | Forms have no browser preview, evidence display, or replacement confirmation. Build the complete UI over the H-10/H-11 workflow.                                                       | Source-replacement and playback-verification E2E.                           |
| SCOPE-A06 | High     | Confirmed | P3     | Expected roles page, users page, role/user workflows       | The roles page is absent and user administration lacks status/role controls. Build persistent multiple-role administration with last-Super-Admin protection.                           | Roles E2E and expanded users E2E.                                           |
| SCOPE-A07 | High     | Confirmed | P1/P8  | Similar-drama page/API/workflow                            | Remove exists in broken form; Add, search, edit, sort, and ordered reorder are absent. Implement the full workflow on repaired H-01/H-02 contracts.                                    | Add, Remove, Search, Sort, and Reorder E2E plus persisted order assertions. |
| SCOPE-A08 | Low      | Confirmed | P9/P10 | `src/app/(public)/help/page.tsx`, public navbar            | Help documents a nonexistent header account/sign-out menu. Implement the approved control or correct the instructions to the real authentication flow.                                 | Public E2E proving any documented sign-out path exists and works.           |

#### Data and Operational Scope

| ID        | Severity | Status    | Phase     | Affected files                                                         | Root cause → required correction                                                                                                                                                                                                                   | Regression coverage                                     |
| --------- | -------- | --------- | --------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| SCOPE-D01 | Medium   | Confirmed | P4/P8/P10 | Content schema, migrations, database documentation                     | `published_at` is missing, so Recently Added is not representable. Add it to applicable tables, set it on first successful publication, preserve it across ordinary edits, and document unpublish/republication policy and existing-data backfill. | Publication-time migration/workflow tests.              |
| SCOPE-D02 | Medium   | Confirmed | P8/P10    | Better Auth config, expected platform rate limiter, abuse-prone routes | No general PostgreSQL-backed application limiter exists. Add shared identity/context-keyed limits with 429 and `Retry-After`, fail-closed for sensitive operations, and bounded cleanup without Redis/workers.                                     | Rate-limit integration and endpoint-specific API tests. |

### 3.6 Test and Quality Gaps

| ID      | Severity | Status    | Phase           | Affected files                                                     | Root cause → required correction                                                                                                                                                          | Regression coverage                                                                 |
| ------- | -------- | --------- | --------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| TEST-01 | Blocker  | Confirmed | P0 + every gate | Public drama page/API, similar-drama page/API/workflow             | Baseline gates are red as a consequence of confirmed defects. Re-establish each gate as its phase lands and run the full suite at release milestones.                                     | Typecheck, lint, unit, integration, build, and E2E full gate.                       |
| TEST-02 | High     | Confirmed | P1              | Expected similar-drama integration/API/E2E suites                  | No direct similar-drama tests exist. Add list/search/add/update/remove/order/permission/missing-target coverage with persisted-state assertions.                                          | `tests/integration/content/similar-dramas.integration.test.ts`, API and E2E suites. |
| TEST-03 | High     | Confirmed | P4/P5           | Expected season/episode integration and route-contract tests       | No direct persistence tests exist for season/episode CRUD, parent scope, numbering, reorder, move, rollback, or concurrency. Add them.                                                    | Season and episode integration plus route contract suites.                          |
| TEST-04 | High     | Confirmed | P7              | Expected source-replacement persistence and E2E tests              | No test proves preview, confirmation, atomic source update, progress/watched reset, history preservation, or audit recording. Add both levels.                                            | Source-replacement integration and admin E2E.                                       |
| TEST-05 | Critical | Confirmed | P2              | Expected public API integration and public E2E                     | Public listing/API were not covered before the security defect. Add anonymous visibility, crafted-filter, hierarchy, pagination, and DTO tests.                                           | Public drama API integration and public-site E2E.                                   |
| TEST-06 | High     | Confirmed | P8              | Expected public detail/watch E2E and query tests                   | Required routes do not exist and have no coverage. Add canonical URL, redirect, unavailable-content, and parent-validation tests with implementation.                                     | Public detail and watch-page suites.                                                |
| TEST-07 | High     | Confirmed | P3              | Role/user unit and API tests                                       | Tests assert truthy placeholders or mock workflows. Replace with PostgreSQL assertions on roles, permissions, status, and assignments.                                                    | Role/user administration integration tests plus API authorization tests.            |
| TEST-08 | Medium   | Confirmed | P1              | `tests/unit/components/admin-navigation.test.ts`, navigation model | The test expects five implemented entries while the working tree has six. Do not merely update the count; assert route existence, static resolvability, and the approved implemented set. | Navigation unit test synchronized with the corrected model.                         |

### 3.7 Documentation Gaps

| ID     | Severity | Status    | Phase  | Affected files                                                               | Root cause → required correction                                                                                                                                                            | Regression coverage                                        |
| ------ | -------- | --------- | ------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| DOC-01 | Medium   | Confirmed | P10    | `docs/development/API.md`, all admin/public API routes                       | API documentation claims no REST endpoints, Server Actions, auth, or OpenAPI. Rebuild from the real route inventory and final contracts.                                                    | OpenAPI-to-documentation consistency test.                 |
| DOC-02 | Medium   | Confirmed | P10    | `docs/development/DATABASE.md`, `docs/PROJECT_STATUS.md`                     | Documentation claims FKs, uniqueness, and indexes absent from migrations. Document only guarantees actually enforced by the final migration chain.                                          | Test that documented constraint names exist in migrations. |
| DOC-03 | High     | Confirmed | P10    | Expected OpenAPI and Swagger UI routes, API docs                             | No machine-readable API contract or Swagger UI exists. Generate OpenAPI from real DTOs and expose UI appropriately.                                                                         | OpenAPI parse/schema/route smoke tests.                    |
| DOC-04 | Medium   | Confirmed | P5/P10 | API docs, public/admin routes                                                | Documentation requires camelCase `{data}`/`{data,meta}` envelopes, but routes use raw rows and multiple incompatible envelopes. Standardize runtime and documented contracts.               | Envelope/error assertions across contract tests.           |
| DOC-05 | Low      | Confirmed | P10    | `docs/PROJECT_STATUS.md`, duplicate implementation status/tracker, changelog | Canonical status trails HEAD, a duplicate is stale, and progress sources conflict. Establish one authoritative progress document and record remediation accurately without erasing history. | Project-status consistency test.                           |

### 3.8 Supplemental Finding

| ID     | Severity | Status    | Phase | Affected files                                                                              | Root cause → required correction                                                                                                                                                                                                                                                                                                                   | Regression coverage                                            |
| ------ | -------- | --------- | ----- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| SUP-01 | High     | Confirmed | P4/P9 | `src/components/admin/dramas/drama-conversion-panel.tsx`, conversion workflow/domain module | The fingerprint covers database structure, not the administrator's previewed distribution; apply can rebuild a different distribution. Removing a season silently reassigns episodes. Bind apply to an immutable preview payload/digest including the distribution, disable editing while pending, and require explicit reassignment confirmation. | Delayed-preview/concurrent-edit integration and UI race tests. |

**Register total:** 69 findings — 2 critical, 18 high, 9 medium, 8 accessibility, 18 initial-scope, 8 test/quality, 5 documentation, 1 supplemental.

---

## 4. Dependencies and Implementation Order

1. **P1 before admin gates:** C-01, H-01, H-02, H-16, M-05, M-06, TEST-02, TEST-08, SCOPE-A07.
2. **H-18 before permission persistence/UI:** code catalog, database CHECK, navigation, and workflows must agree on `similar_drama.manage`.
3. **H-08 before data-integrity work:** supplies FKs, uniqueness, and indexes required by H-03 through H-07, H-09, M-07, and M-08.
4. **H-09 before source replacement and watching features:** typed progress/history identity is prerequisite for safe resets and owner-scoped queries.
5. **H-10 and H-11 form one P7 safety workflow:** source replacement and publication both require fingerprint-bound browser evidence and explicit confirmation.
6. **P5 before P8 page implementation:** pages consume stable methods, DTOs, envelopes, errors, and same-origin behavior.
7. **P9 after final pages exist:** accessibility and recovery tests require stable routes and interactions.
8. **P10 last:** OpenAPI and documentation must describe verified contracts, not intended ones.

**Execution sequence:** P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 → P9 → P10 → final release-readiness report.

---

## 5. Test Strategy

| Layer                   | Purpose                                                                        | Required evidence                                                      |
| ----------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Unit                    | Validation, availability, permissions, pure business rules, component behavior | Focused failures first, then passing regression tests                  |
| Workflow                | Service-level behavior and error mapping                                       | Non-database logic with real types; database cases move to integration |
| PostgreSQL integration  | Persistence, constraints, transactions, concurrency, migrations                | Real `TEST_DATABASE_URL`; assert actual rows and rollback              |
| API                     | Methods, authorization, DTOs, envelopes, status codes, origin checks           | Real route handlers against isolated data                              |
| Playwright E2E          | Complete administrator and viewer workflows in Chromium                        | Browser console/network checks and screenshots on failure              |
| Build and static checks | TypeScript, ESLint, production build, migration application                    | Commands must exit successfully                                        |

**Critical rules:** Do not mock persistence. Do not accept truthy placeholders. Assert successful and failed transactions. Test anonymous/unauthorized/cross-parent access. Test concurrent numbering/reordering. Test successful mutation after response serialization. Test migration against populated isolated data.

---

## 6. Phase Acceptance Criteria

### Phase 0 — Baseline and planning

- All 69 findings registered with status, phase, files, root cause/correction, and tests.
- Baseline commands and failures recorded.
- Dependencies and migration risks documented.
- Existing uncommitted work preserved.

### Phase 1 — Restore application availability

- C-01, H-01, H-02, H-16, M-05, M-06, TEST-02, TEST-08, SCOPE-A07 resolved.
- Admin overview, drama, user, and conversion routes load.
- Similar-drama valid ID loads; invalid ID returns not-found.
- Typecheck, lint, production build, and relevant admin E2E pass.

### Phase 2 — Public API security and availability

- C-02, M-03, M-04, M-09, TEST-05 resolved.
- No anonymous access to draft/unpublished/hidden/trashed/unavailable-ancestor content.
- Public routes are canonical; DTOs are explicit camelCase; pagination bounded and deterministic.

### Phase 3 — Authorization and user administration

- H-03, H-18, SCOPE-A06, TEST-07 resolved.
- Real role/permission/user persistence; multiple roles; last-active-Super-Admin protection under concurrency.
- Restricted management remains Super-Admin-only.

### Phase 4 — Database integrity and hierarchy

- H-04..H-09, M-01, M-02, M-07, M-08, SCOPE-D01, SUP-01, TEST-03 resolved.
- No orphan/cross-parent hierarchy, duplicate scoped numbers/positions, or partial replacements.
- D-020 typed relationships and exactly-one checks enforced.
- Forward migrations verified against populated isolated data.

### Phase 5 — REST contract corrections

- H-12, H-13, H-16, H-17, DOC-04 resolved.
- Natural DTOs, query-based GET filters, reachable methods, bodyless 204, standard envelopes, and same-origin checks.
- No state-changing GET remains.

### Phase 6 — Authentication and session security

- H-14 and H-15 resolved.
- Exact current session enforced consistently across pages, actions, and REST.
- Monitoring is invoked; timeout/lockout calculations match policy; tests cover concurrency/recovery.

### Phase 7 — Video safety and publication

- H-10, H-11, SCOPE-A05, TEST-04 resolved.
- No source bypass; replacement requires playback preview and confirmation; progress/watched reset; history preserved; audit event atomic.
- Unverified or changed sources cannot publish.

### Phase 8 — Missing initial scope

- SCOPE-P01..P08, SCOPE-A01..A04, SCOPE-D02, TEST-06 resolved.
- Required public, admin, discovery, search, playback, bookmark, history, Trash, and movie/taxonomy workflows exist.
- No placeholder catalogue data in production paths.

### Phase 9 — Accessibility and recovery UX

- ACC-01..ACC-08 and remaining UX dependencies resolved.
- Keyboard, screen-reader semantics, mobile/tablet/desktop, focus management, retry, and error distinctions verified.

### Phase 10 — Documentation and API contracts

- DOC-01..DOC-05 resolved.
- OpenAPI and Swagger UI reflect runtime; API/database/status docs describe only enforced behavior.
- Single authoritative progress source established.

### Final release gate

- TypeScript, ESLint, unit, integration, production build, Playwright E2E all pass.
- Public visibility, RBAC persistence, session security, database integrity, source replacement, publication verification, API contracts, accessibility, and documentation accuracy all verified.
- No skipped/environment-blocked check is reported as a pass.
- `docs/development/FINAL_RELEASE_READINESS_REPORT.md` produced.

---

## 7. Migration and Data-Compatibility Risks

| Risk                                                               | Affected findings                  | Required handling                                                                                                                             |
| ------------------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing hierarchy/taxonomy/similar-drama FKs and scoped uniqueness | H-08, H-04..H-07, M-02, M-07, M-08 | Audit orphans, cross-parent rows, duplicates, and invalid positions before constraint creation; report and reconcile; forward-only migrations |
| Generic content references must become typed drama/movie targets   | H-09                               | Expand/contract; backfill only unambiguous rows; preserve ambiguous records for explicit reconciliation; never discard history                |
| Existing published content lacks browser-verification evidence     | H-11                               | Record an explicit grandfathering/re-verification policy; do not silently unpublish existing content                                          |
| `published_at` absent for existing published rows                  | SCOPE-D01                          | Document backfill policy; do not fabricate dates; handle null explicitly in Recently Added ordering                                           |
| Duplicate/null similar-drama positions and stale permission rows   | H-02, H-18, SCOPE-A07              | Audit before uniqueness/CHECK changes; replace applied CHECK through a new migration                                                          |
| Existing session rows may lack reliable activity metadata          | H-14                               | Handle defaults/cleanup explicitly; never copy session tokens into new tables/logs                                                            |
| Existing reports lack an active/resolved state                     | M-07                               | Preserve report history; introduce state with a documented default/backfill                                                                   |
| Ambiguous `content_type = NULL` conversion rows                    | H-09, SUP-01                       | Do not guess ownership; reconcile explicitly and preserve provenance                                                                          |
| Same-origin policy for requests with neither header                | H-13                               | Choose fail-closed browser policy or narrow documented non-browser exception; test consistently                                               |
| PostgreSQL-backed rate limiting requires retention/cleanup         | SCOPE-D02                          | Use bounded cleanup and short-lived maintenance commands only; no Redis/worker/queue                                                          |

---

## 8. Decisions Requiring Explicit Resolution Before Affected Work

These are recorded so implementation does not silently choose product behavior. They do not reopen already-settled architecture.

1. **Legacy published content without browser evidence:** grandfather temporarily or require re-verification before the next publication action. Do not silently unpublish.
2. **Missing `Origin` and `Sec-Fetch-Site` on REST mutations:** fail closed for browser policy or define a narrow, documented non-browser exception.
3. **Ambiguous legacy user-content rows:** define an operational reconciliation path before the D-020 backfill; do not guess a drama/movie target.

All other requirements, phase ordering, architecture, and scope are fixed by the master remediation prompt and existing specification.

---

## 9. Progress Ledger

| Phase | Status      | Findings                                                        | Files                              | Migrations                                           | Tests executed          | Commit  | Remaining issues                  |
| ----- | ----------- | --------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------- | ----------------------- | ------- | --------------------------------- |
| P0    | In progress | Register only                                                   | This document, documentation index | None                                                 | Baseline recorded above | Pending | Complete review, commit, and push |
| P1    | Not started | C-01, H-01, H-02, H-16, M-05, M-06, TEST-02, TEST-08, SCOPE-A07 | Pending                            | None expected                                        | Pending                 | —       | —                                 |
| P2    | Not started | C-02, M-03, M-04, M-09, TEST-05                                 | Pending                            | Pending                                              | Pending                 | —       | —                                 |
| P3    | Not started | H-03, H-18, SCOPE-A06, TEST-07                                  | Pending                            | Permission CHECK migration                           | Pending                 | —       | —                                 |
| P4    | Not started | H-04..H-09, M-01, M-02, M-07, M-08, SCOPE-D01, SUP-01, TEST-03  | Pending                            | Integrity/typed-relationship/published-at migrations | Pending                 | —       | —                                 |
| P5    | Not started | H-12, H-13, H-16, H-17, DOC-04                                  | Pending                            | None expected                                        | Pending                 | —       | —                                 |
| P6    | Not started | H-14, H-15                                                      | Pending                            | Possible monitoring-state migration                  | Pending                 | —       | —                                 |
| P7    | Not started | H-10, H-11, SCOPE-A05, TEST-04                                  | Pending                            | Verification/audit/progress migrations               | Pending                 | —       | —                                 |
| P8    | Not started | SCOPE-P01..P08, SCOPE-A01..A04, SCOPE-D02, TEST-06              | Pending                            | Search/rate-limit/published-at support               | Pending                 | —       | —                                 |
| P9    | Not started | ACC-01..ACC-08                                                  | Pending                            | None expected                                        | Pending                 | —       | —                                 |
| P10   | Not started | DOC-01..DOC-05                                                  | Pending                            | Documentation only                                   | Pending                 | —       | —                                 |

---

## 10. Immediate Next Task

**Phase 1, Task 1:** Correct the admin navigation model and its regression test.

- Remove `/admin/dramas/[id]/similar-dramas` from ordinary sidebar navigation.
- Mark Movies and Episodes as not implemented until their pages exist, or implement the pages in the appropriate phase.
- Expose similar-drama management from a concrete drama row/page.
- Update `tests/unit/components/admin-navigation.test.ts` to assert the approved implemented set, static resolvability, and no dynamic route tokens.
- Run focused unit tests, typecheck, and lint; review the diff; commit and push.
