# Content Publication Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit, non-cascading manual publish/unpublish control for dramas, seasons, episodes, and standalone movies, with a centralized public-availability rule and a database-enforced canonical state.

**Architecture:** Pure publication/availability rules live in the content module; persistence and authorization live in a workflow layer; a single REST route is a thin adapter. The database constrains `publication_status` to `draft|published|unpublished` with `draft` default, and backfills legacy values. Create/update payloads no longer accept publication state.

**Tech Stack:** Next.js App Router, TypeScript strict, Drizzle ORM + PostgreSQL, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-content-publication-controls-design.md`

## Global Constraints

- No admin UI is created or modified in this plan.
- Server-side authorization is the security authority; publish/unpublish require `<resource>.manage` (`drama.manage`, `season.manage`, `episode.manage`, `movie.manage`). Do not add permission keys, `PERMISSION_ACTIONS` entries, or role seeds.
- Publication status vocabulary is exactly `draft | published | unpublished`. No other value may be stored.
- A publication-ready source is an absolute HTTPS URL whose pathname ends in `.mp4` (case-insensitive), with no embedded credentials. Query strings and fragments are allowed.
- No server-side fetching, probing, proxying, or transcoding of video URLs. A `.mp4` suffix is a format requirement, not proof of playback.
- Publishing/unpublishing a parent never changes child publication state.
- Publication state is writable only by the publication workflow/endpoints. Create/update payloads reject `publication_status`.
- Do not introduce background workers, queues, scheduled publishing, or new dependencies.
- TypeScript strict mode; `server-only` for workflow/route modules; Pino JSON logging for failures.
- Never commit `.env`, credentials, or the two pre-existing untracked `docs/superpowers/{plans,specs}/2026-11-13-admin-form-patterns*.md` files.
- Use `TEST_DATABASE_URL` only; the test database name must end in `_test` and differ from `DATABASE_URL`.
- Production build requires HTTPS `APP_URL`/`TRUSTED_ORIGINS` overrides because `.env.local` uses `http://localhost`.
- Commit and push after every task that changes behavior, per `AGENTS.md`.

## Review Focus

These inputs are implied by the spec but are not obvious from any single task's code; each has a test pinned in the owning task.

1. A source like `https://media.example.com/movie.MP4?token=abc#t=1` is accepted; `https://user:pass@media.example.com/a.mp4` is rejected. → Task 1.
2. Publishing a trashed row must skip with `trashed`, never publish it. → Task 4.
3. Duplicate ids in one bulk request must not double-update or be silently dropped. → Task 4.
4. Two concurrent publishes of the same id must not produce inconsistent state; the second is `already_published`. → Task 4.
5. A metadata update (drama/season/episode/movie) must leave `publication_status` unchanged. → Task 6.
6. An invalid id must not prevent valid ids in the same request from succeeding. → Task 4.
7. A snapshot containing legacy `null`/`ongoing` publication values must restore without violating the CHECK constraint. → Task 7.
8. A published drama converted to a movie with a missing source must yield a draft movie, not a published one. → Task 7.

---

### Task 1: Publication source and request validation contract

**Files:**
- Modify: `src/modules/content/validation.ts`
- Modify: `src/modules/content/index.ts` (re-export new schemas/types)
- Test: `tests/unit/modules/content/movie-validation.test.ts` (extend existing), `tests/unit/modules/content/publication-validation.test.ts` (new)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `publicationReadyVideoSourceSchema` (Zod string schema)
  - `movieVideoSourceSchema` (alias of the above; keep the exported name)
  - `createEpisodeSchema` / `parseCreateEpisodeInput` with `video_source` using `publicationReadyVideoSourceSchema` and **no** `publication_status`
  - `createMovieSchema` / `updateMovieSchema` with `video_source` using `publicationReadyVideoSourceSchema` and **no** `publication_status`
  - `publicationRequestSchema`, `parsePublicationRequest`, `PublicationContentType`, `PublicationAction`, `PublicationRequest`

- [ ] **Step 1: Write the failing tests**

In `tests/unit/modules/content/publication-validation.test.ts` add tests:
- `accepts an absolute HTTPS .mp4 URL with query and fragment` → `https://media.example.com/a/b.MP4?token=1#t=1` parses successfully.
- `rejects HTTP`, `rejects relative URL`, `rejects non-.mp4 path`, `rejects embedded credentials`, `rejects malformed URL`.
- `createMovieSchema rejects publication_status` → `validMovie({ publication_status: 'published' })` is `success === false`.
- `createMovieSchema defaults video_source to null and requires .mp4` → `video_source: 'https://media.example.com/film'` fails.
- `createEpisodeSchema rejects publication_status` and accepts `video_source: 'https://media.example.com/e/1.mp4'`; `video_source: 'http://media.example.com/e/1.mp4'` fails.
- `publicationRequestSchema` accepts `{ contentType: 'episode', action: 'publish', ids: [uuid] }`; rejects unknown `contentType`, unknown `action`, empty `ids`, more than 200 ids, and non-array `ids`.

In `tests/unit/modules/content/movie-validation.test.ts` update the source tests to the `.mp4` + no-credentials contract (replace any HTTP/non-`.mp4` accepted case).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/modules/content/publication-validation.test.ts tests/unit/modules/content/movie-validation.test.ts`
Expected: FAIL (schema/reject assertions not satisfied).

- [ ] **Step 3: Implement the source and request schemas in `src/modules/content/validation.ts`**

- Add `publicationReadyVideoSourceSchema` (trim, 1–2048, absolute URL, `protocol === 'https:'`, empty `username`/`password`, `pathname.toLowerCase().endsWith('.mp4')`). Error message: `Video source must be an absolute HTTPS URL whose path ends in .mp4.`
- Point `movieVideoSourceSchema` at the same schema.
- Remove `publication_status` from `createMovieSchema`; use the shared source schema for `video_source`.
- Remove `publication_status` from `createEpisodeSchema` and `episodeStatusSchema` usage; use the shared source schema for `video_source` (keep it optional so drafts can exist without a source).
- Add `publicationContentTypeSchema = z.enum(['drama','season','episode','movie'])`, `publicationActionSchema = z.enum(['publish','unpublish'])`, `publicationRequestSchema = z.strictObject({ contentType, action, ids: z.array(z.string().min(1)).min(1).max(200) })`, `parsePublicationRequest`, and the inferred types. Malformed UUIDs are classified later, not here.
- Export the new schemas/types from `src/modules/content/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/modules/content/publication-validation.test.ts tests/unit/modules/content/movie-validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/content/validation.ts src/modules/content/index.ts tests/unit/modules/content/publication-validation.test.ts tests/unit/modules/content/movie-validation.test.ts
git commit -m "feat: tighten video source and publication request validation (Prompt 068)"
```

---

### Task 2: Pure publication and availability rules

**Files:**
- Create: `src/modules/content/publication.ts`
- Modify: `src/modules/content/index.ts`
- Test: `tests/unit/modules/content/publication.test.ts` (new)

**Interfaces:**
- Consumes: `publicationReadyVideoSourceSchema`, `PublicationContentType`, `PublicationAction` from Task 1 (imported, not redefined).
- Produces:
  - `PUBLICATION_STATUSES`, `PublicationStatus`
  - `normalizePublicationStatus(value: string | null | undefined): PublicationStatus`
  - `isPublicationReadySource(value: string | null): boolean`
  - `evaluatePublicationEligibility(input: { contentType: PublicationContentType; action: PublicationAction; publicationStatus: PublicationStatus; videoSource: string | null }): { eligible: boolean; reason: 'eligible'|'already_published'|'already_unpublished'|'missing_source'|'invalid_source'; message: string }`
  - `AvailabilityBlocker`, `evaluatePublicAvailability(input: { contentType; publicationStatus; deleted; parentDrama?: { publicationStatus; deleted } | null; parentSeason?: { publicationStatus; deleted } | null }): { publiclyAvailable: boolean; blockers: AvailabilityBlocker[] }`

- [ ] **Step 1: Write the failing tests**

`tests/unit/modules/content/publication.test.ts`:
- `normalizePublicationStatus` maps `null`, `undefined`, `''`, `'ongoing'`, `'completed'`, `'bogus'` → `'draft'`; passes through the three canonical values.
- `isPublicationReadySource` accepts `https://media.example.com/a.MP4?q=1`, rejects `http://…`, `https://user:pass@…`, `https://media.example.com/a.mov`, `null`, `'not a url'`.
- `evaluatePublicationEligibility`:
  - drama/season publish is eligible in `draft`/`unpublished`; already `published` → `already_published`.
  - episode publish with `videoSource: null` → `missing_source`; with an HTTP URL → `invalid_source`; with a valid HTTPS `.mp4` → `eligible`.
  - movie publish follows the same source rule.
  - unpublish is eligible unless already `unpublished` → `already_unpublished`; source is irrelevant for unpublish.
- `evaluatePublicAvailability`:
  - drama published → available; draft/unpublished or `deleted: true` → not.
  - season: needs itself and `parentDrama` published and neither deleted; `parentSeason` ignored.
  - episode: needs itself, drama, and (when `parentSeason` supplied) season published and none deleted; with `parentSeason: null` the drama alone gates.
  - movie: same as drama.
  - Each unavailable case returns a non-empty `blockers` array.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/unit/modules/content/publication.test.ts`
Expected: FAIL (`publication.ts` does not exist).

- [ ] **Step 3: Implement `src/modules/content/publication.ts`**

Pure functions only; no database imports. `normalizePublicationStatus` returns `'draft'` for anything outside `PUBLICATION_STATUSES`. `isPublicationReadySource` uses `publicationReadyVideoSourceSchema.safeParse(value).success` and returns `false` for `null`. `evaluatePublicationEligibility` checks the current state first, then the source only for `publish` of `episode`/`movie`. `evaluatePublicAvailability` checks own state/deleted, then ancestors in hierarchy order.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- tests/unit/modules/content/publication.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/content/publication.ts src/modules/content/index.ts tests/unit/modules/content/publication.test.ts
git commit -m "feat: add publication eligibility and public availability rules (Prompt 068)"
```

---

### Task 3: Normalize publication columns and migration 0007

**Files:**
- Modify: `src/modules/content/schema.ts`
- Create: `drizzle/0007_*.sql`, `drizzle/meta/0007_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Test: `tests/integration/content/publication-schema.integration.test.ts` (new)

**Interfaces:**
- Consumes: `PUBLICATION_STATUSES` vocabulary from Task 2 (values only).
- Produces: `dramas.publication_status`, `seasons.publication_status`, `episodes.publication_status`, `movies.publication_status` are `NOT NULL`, default `'draft'`, and `CHECK` in `('draft','published','unpublished')`.

- [ ] **Step 1: Write the failing integration tests**

`tests/integration/content/publication-schema.integration.test.ts` (follows the `vi.hoisted` + `vi.mock('server-only', () => ({}))` pattern from `movies.integration.test.ts`):
- `inserts a drama with default publication_status draft` — insert without the column, assert `'draft'`.
- `rejects a null publication_status` — raw `INSERT … publication_status` omitted is fine, but an explicit `NULL` must reject with a not-null violation.
- `rejects a legacy ongoing value` — explicit `'ongoing'` must reject with a check violation.
- Repeat the null/legacy rejection for `seasons`, `episodes`, and `movies`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:integration -- tests/integration/content/publication-schema.integration.test.ts`
Expected: FAIL (columns are still nullable/unconstrained).

- [ ] **Step 3: Update the Drizzle schema**

In `src/modules/content/schema.ts`, change the four columns to `text('publication_status').notNull().default('draft')` and add a table callback with
`checkConstraint('<table>', 'publication_status', sql`${table.publication_status} in ('draft', 'published', 'unpublished')`)`
using the existing `checkConstraint` helper. Keep `dramas.status` unchanged.

- [ ] **Step 4: Generate and hand-edit migration 0007**

Run: `npx drizzle-kit generate` (accept the generated filename).
Then edit the generated SQL so that, **before** any `SET NOT NULL` or `ADD CONSTRAINT`, each of the four tables runs:
```sql
UPDATE "<table>" SET "publication_status" = 'draft' WHERE "publication_status" IS NULL OR "publication_status" NOT IN ('draft', 'published', 'unpublished');
```
Add a SQL comment stating that this maps legacy `NULL` and episode `ongoing`/`completed` values to `draft` without touching other metadata. Leave the generated `SET DEFAULT`, `SET NOT NULL`, and `ADD CONSTRAINT` statements.

- [ ] **Step 5: Apply the migration to the test database and run tests**

Run: `npm run test:integration -- tests/integration/content/publication-schema.integration.test.ts`
Expected: PASS. Also run `npm run typecheck` (exit 0).

- [ ] **Step 6: Commit**

```bash
git add src/modules/content/schema.ts drizzle/0007_*.sql drizzle/meta/0007_snapshot.json drizzle/meta/_journal.json tests/integration/content/publication-schema.integration.test.ts
git commit -m "feat: normalize content publication status columns (Prompt 068)"
```

---

### Task 4: Publication workflows (single and bulk)

**Files:**
- Create: `src/workflows/admin/publication.ts`
- Test: `tests/integration/content/publication.integration.test.ts` (new)
- Modify: `tests/integration/content/dramas.integration.test.ts` (fixtures must use `.mp4` sources where episodes are inserted)

**Interfaces:**
- Consumes: `publicationRequestSchema`, `parsePublicationRequest`, `evaluatePublicationEligibility`, `evaluatePublicAvailability`, `PublicationStatus`, `PublicationContentType`, `PublicationAction` from Tasks 1–2.
- Produces:
  - `PublicationItemStatus = 'succeeded' | 'skipped' | 'failed'`
  - `PublicationItemReason = 'invalid_id' | 'not_found' | 'trashed' | 'already_published' | 'already_unpublished' | 'missing_source' | 'invalid_source' | 'duplicate_id' | 'update_failed'`
  - `PublicationItemResult = { id: string; status: PublicationItemStatus; reason: PublicationItemReason | null; message?: string; publicationStatus?: PublicationStatus; publiclyAvailable?: boolean }`
  - `PublicationSummary = { requested: number; succeeded: number; skipped: number; failed: number }`
  - `PublicationResult = { contentType: PublicationContentType; action: PublicationAction; summary: PublicationSummary; results: PublicationItemResult[] }`
  - `publishContent(actor: ActorContext, input: unknown): Promise<PublicationResult>`
  - `unpublishContent(actor: ActorContext, input: unknown): Promise<PublicationResult>`
  - `updatePublication(actor: ActorContext, input: unknown): Promise<PublicationResult>`

- [ ] **Step 1: Write the failing integration tests**

`tests/integration/content/publication.integration.test.ts` (real test DB, `vi.mock('server-only', () => ({}))`, actors: `managerActor` with `drama.manage|season.manage|episode.manage|movie.manage`, `readerActor` with only `.read`):
- `publishes a drama and marks it publicly available` — after publish, row is `published` and the result has `publiclyAvailable: true`.
- `unpublishes a drama without touching its seasons or episodes` — child `publication_status` values are unchanged and their `publiclyAvailable` becomes `false`.
- `publishes an episode with a valid source and reports availability from its ancestors` — with the drama draft and season published, the episode result is `succeeded` with `publiclyAvailable: false`; after publishing the drama it is available without a new publish call.
- `skips an episode with no source with reason missing_source` and `skips an episode with an HTTP source with reason invalid_source` — neither row changes.
- `skips an already-published id with reason already_published` and an already-unpublished id with `already_unpublished`.
- `skips trashed rows with reason trashed`.
- `reports duplicates once and does not double-apply` — two identical ids yield one `succeeded` and one `duplicate_id` skipped; `summary.requested === 2`.
- `reports missing ids as not_found and invalid ids as failed without blocking valid ids`.
- `rejects an actor without the matching manage permission` with `AuthorizationError` for each content type.
- `serializes concurrent publishes` — `Promise.all` of two publishes returns one `succeeded` and one `already_published`, and the row is `published`.
- `bulk publish applies only eligible items and returns accurate counts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:integration -- tests/integration/content/publication.integration.test.ts`
Expected: FAIL (`publication.ts` does not exist).

- [ ] **Step 3: Implement `src/workflows/admin/publication.ts`**

- Map `contentType` → `{ table, permission: 'drama.manage'|'season.manage'|'episode.manage'|'movie.manage', sourceBearing: boolean }`. All four tables share the same shape (`id`, `publication_status`, `deleted_at`, `updated_at`; episodes/movies also `video_source`).
- `updatePublication(actor, input)`: `requirePermission` is checked per content type inside; parse via `parsePublicationRequest`; dedupe ids while keeping the first occurrence order; duplicates get a `skipped`/`duplicate_id` result.
- Process unique ids in batches of 100. Each batch in `db.transaction`:
  - `SELECT` the target rows `FOR UPDATE` for the batch ids.
  - Classify each id using `evaluatePublicationEligibility`; malformed uuid → `failed`/`invalid_id`; absent → `skipped`/`not_found`; `deleted_at` set → `skipped`/`trashed`; ineligible → its `reason`.
  - `UPDATE` the eligible ids with a single statement: `set({ publication_status: target, updated_at: new Date() })` and `where(and(inArray(table.id, eligible), ne(table.publication_status, target)))`, returning rows.
  - Load ancestor rows needed for availability: for `season`, `dramas`; for `episode`, `dramas` plus `seasons` when `season_id` is set; compute `publiclyAvailable` with `evaluatePublicAvailability`.
- A thrown batch error marks that batch `failed`/`update_failed`, logs through the workflow logger, and processing continues with the next batch.
- `publishContent`/`unpublishContent` call `updatePublication` with the fixed action. Return the full result object; never throw for per-item ineligibility.
- Do not write `publication_status` anywhere else.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:integration -- tests/integration/content/publication.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflows/admin/publication.ts tests/integration/content/publication.integration.test.ts tests/integration/content/dramas.integration.test.ts
git commit -m "feat: add publish and unpublish workflows with bulk reporting (Prompt 068)"
```

---

### Task 5: Publication REST endpoint

**Files:**
- Create: `src/app/admin/api/publication/route.ts`, `src/app/admin/api/publication/_shared.ts`
- Test: `tests/integration/content/publication-api.integration.test.ts` (new), `tests/unit/app/admin-api-publication.test.ts` (new)

**Interfaces:**
- Consumes: `publishContent`, `unpublishContent`, `PublicationResult` from Task 4.
- Produces: `POST /admin/api/publication` accepting `{ contentType, action, ids }` and returning `200` with `{ data: PublicationResult }`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/app/admin-api-publication.test.ts`: mock `resolveActor` and `@/workflows/admin/publication`; assert the route calls `publishContent`/`unpublishContent`, returns `200` with `{ data: result }`, and maps thrown `ValidationError`/`AuthorizationError` through `errorResponse`.
`tests/integration/content/publication-api.integration.test.ts`: call the route handler directly with a manager actor and a reader actor; assert `200` + summary for the manager and `403` for the reader; assert malformed body yields `400`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/app/admin-api-publication.test.ts` and `npm run test:integration -- tests/integration/content/publication-api.integration.test.ts`
Expected: FAIL (route does not exist).

- [ ] **Step 3: Implement the route and local shared helpers**

`src/app/admin/api/publication/_shared.ts` mirrors the movie `_shared.ts` pattern: `beginAdminRequest`, `assertSameOrigin`, `readJsonBody`, `jsonResponse`, `errorResponse`, and `authorizePublication(actor, contentType)` mapping content type to the `.manage` permission via `requirePermission`.
`route.ts` exports `dynamic = 'force-dynamic'`, `revalidate = 0`, and a `POST` handler that: begins the request, asserts same-origin, resolves the actor, reads the JSON body, parses `contentType`/`action`/`ids` with `parsePublicationRequest`, authorizes, dispatches `publishContent`/`unpublishContent`, and returns `jsonResponse({ data: result }, 200, requestId)`; catch via `errorResponse`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/unit/app/admin-api-publication.test.ts` and `npm run test:integration -- tests/integration/content/publication-api.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/api/publication tests/unit/app/admin-api-publication.test.ts tests/integration/content/publication-api.integration.test.ts
git commit -m "feat: expose publication workflow through admin API (Prompt 068)"
```

---

### Task 6: Admin read models and filter fixes

**Files:**
- Modify: `src/workflows/admin/dramas.ts`, `src/workflows/admin/seasons.ts`, `src/workflows/admin/episodes.ts`, `src/workflows/admin/movies.ts`
- Modify: `tests/integration/content/dramas.integration.test.ts`, `tests/integration/content/movies.integration.test.ts`, `tests/e2e/support/drama-fixture.mjs`

**Interfaces:**
- Consumes: `evaluatePublicAvailability`, `PublicationStatus` from Task 2.
- Produces: admin list DTOs expose `publicationStatus` and `publiclyAvailable`; create/update DTOs return the unchanged own `publicationStatus`; list filters use the canonical vocabulary.

- [ ] **Step 1: Write the failing tests**

- In `tests/integration/content/dramas.integration.test.ts`: `listDramas` with `status: 'published'` returns only published dramas; `status: 'unpublished'` only unpublished; `status: 'draft'` only drafts; `status: 'trashed'` only soft-deleted rows; default excludes trashed. Each returned item has `publicationStatus` and `publiclyAvailable`.
- In `tests/integration/content/movies.integration.test.ts`: create without `publication_status` yields `draft`; a payload containing `publication_status` is rejected; `updateMovie` does not change `publication_status`; `toMovie().publiclyAvailable` matches own state.
- In `tests/integration/content/publication.integration.test.ts`: `listSeasons` and `listEpisodes` return `publiclyAvailable` derived from the parent rows (a published episode under a draft drama is `false`); the episode list filter accepts `publication_status: 'published'` and rejects `'ongoing'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:integration -- tests/integration/content/dramas.integration.test.ts tests/integration/content/movies.integration.test.ts tests/integration/content/publication.integration.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update the workflows**

- `dramas.ts`: `toDrama` adds `publicationStatus: row.publication_status` and `publiclyAvailable` (own state; the default list excludes trashed). Fix `listDramas` so `status === 'trashed'` filters `isNotNull(dramas.deleted_at)` and otherwise filters `publication_status`; sort `status` maps to `dramas.publication_status`.
- `seasons.ts`: `listSeasons` joins `dramas`, reads the parent state, and returns `publiclyAvailable` computed with `evaluatePublicAvailability`; `toSeason` keeps the item's own `publicationStatus`.
- `episodes.ts`: `listEpisodes` joins `dramas` and left-joins `seasons`, and returns `publiclyAvailable` computed with `evaluatePublicAvailability`; `toEpisode` keeps the item's own `publicationStatus`; change the `publication_status` filter enum to `['draft','published','unpublished']`; update create/update to stop writing `publication_status` and to use the shared source schema (create parses via `parseCreateEpisodeInput`; the inline update schema switches to `publicationReadyVideoSourceSchema`).
- `movies.ts`: `toMovie` adds `publiclyAvailable` (own state; movies have no ancestors); `createMovie`/`updateMovie` stop writing `publication_status` (database default applies).
- `tests/e2e/support/drama-fixture.mjs`: episode fixture `video_source` must end in `.mp4` (or be null when no source is intended).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:integration -- tests/integration/content/dramas.integration.test.ts tests/integration/content/movies.integration.test.ts tests/integration/content/publication.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflows/admin/dramas.ts src/workflows/admin/seasons.ts src/workflows/admin/episodes.ts src/workflows/admin/movies.ts tests/integration/content/dramas.integration.test.ts tests/integration/content/movies.integration.test.ts tests/integration/content/publication.integration.test.ts tests/e2e/support/drama-fixture.mjs
git commit -m "feat: expose publication and availability in admin read models (Prompt 068)"
```

---

### Task 7: Conversion compatibility

**Files:**
- Modify: `src/modules/content/movie-conversion.ts`, `src/modules/content/conversion.ts`, `src/workflows/admin/movie-conversion.ts`, `src/workflows/admin/conversion.ts`
- Modify: `tests/unit/modules/content/movie-conversion.test.ts`, `tests/unit/modules/content/conversion.test.ts`, `tests/integration/content/movie-conversion.integration.test.ts`, `tests/integration/content/movie-conversion-api.integration.test.ts`

**Interfaces:**
- Consumes: `normalizePublicationStatus`, `isPublicationReadySource`, `PublicationStatus` from Task 2.
- Produces: conversion never writes a non-canonical or source-invalid publication state.

- [ ] **Step 1: Write the failing tests**

- Unit `movie-conversion.test.ts`: `resolveMoviePublicationStatus` delegates to `normalizePublicationStatus`; `buildMovieConversionPlan` downgrades `published` to `draft` when the episode source is null/invalid and adds a warning that names the draft result; `computeMovieConversionFingerprint` includes the effective status.
- Unit `conversion.test.ts`: `normalizePublicationStatus` is applied when a snapshot season payload carries `null`/`'ongoing'`; the resulting fingerprint/state uses `'draft'`.
- Integration `movie-conversion.integration.test.ts`: a published drama whose episode has no source converts to a **draft** movie; the same drama with a valid `.mp4` source converts to a **published** movie; the preview reports the downgrade warning.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- tests/unit/modules/content/movie-conversion.test.ts tests/unit/modules/content/conversion.test.ts` and the two conversion integration files
Expected: FAIL.

- [ ] **Step 3: Implement the compatibility rules**

- `movie-conversion.ts`: `resolveMoviePublicationStatus` returns the normalized canonical state; add the effective-state helper used by plan/fingerprint/apply that downgrades to `draft` when `isPublicationReadySource(episode.videoSource) === false` and the mapped state is `published`.
- `movie-conversion.ts` (apply): recompute the effective status inside the transaction from the actual `episode.video_source`; keep the fingerprint comparison.
- `conversion.ts`: `snapshotSeasonPayloadSchema.publication_status` stays `z.string().nullable()` (old snapshots must parse), but the restore plan normalizes it with `normalizePublicationStatus`; planned flat→season seasons use `draft`, not `null`.
- `workflows/admin/conversion.ts`: when restoring seasons, write the normalized value; the `seasonState` built from the plan uses the effective value.

- [ ] **Step 4: Run tests to verify they pass**

Run: the four conversion test files plus `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/content/movie-conversion.ts src/modules/content/conversion.ts src/workflows/admin/movie-conversion.ts src/workflows/admin/conversion.ts tests/unit/modules/content/movie-conversion.test.ts tests/unit/modules/content/conversion.test.ts tests/integration/content/movie-conversion.integration.test.ts tests/integration/content/movie-conversion-api.integration.test.ts
git commit -m "feat: reconcile conversions with publication readiness (Prompt 068)"
```

---

### Task 8: Documentation and decision record

**Files:**
- Modify: `docs/decisions/DECISIONS.md`, `docs/development/DATABASE.md`, `docs/development/API.md`, `docs/development/SECURITY.md`, `docs/CHANGELOG.md`, `docs/PROJECT_STATUS.md`, `docs/implementation/implementation-plan.md`
- Create: `docs/superpowers/specs/2026-11-15-content-publication-controls-design.md` (already written; commit it)

**Interfaces:**
- Consumes: nothing.
- Produces: documented contract and D-031.

- [ ] **Step 1: Record D-031**

Add `D-031 Content publication controls` to `DECISIONS.md` covering: canonical vocabulary and DB enforcement; own state vs ancestor-gated availability; non-cascading; episode eligibility = source only; `.mp4` + HTTPS + no-credentials source contract; dedicated publication endpoint as the only write path; bulk skip/fail reporting; reuse of `.manage` permissions; movie-conversion downgrade rule; snapshot normalization.

- [ ] **Step 2: Update the reference docs**

- `DATABASE.md`: document the four normalized columns, default, CHECK, and the 0007 backfill.
- `API.md`: document `POST /admin/api/publication`, the response/summary shape, reason codes, status codes, and the removal of `publication_status` from create/update payloads and the episode list filter change.
- `SECURITY.md`: publish/unpublish authorization, ancestor-gated availability, trashed exclusion, and that availability checks are centralized.
- `CHANGELOG.md` and `PROJECT_STATUS.md`: add the Prompt 068 entry.
- `implementation-plan.md`: add the prompt row.

- [ ] **Step 3: Verify docs are consistent**

Run: `git diff --stat` and re-read each edited section against this plan. Confirm no statement claims an admin UI exists.

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/DECISIONS.md docs/development/DATABASE.md docs/development/API.md docs/development/SECURITY.md docs/CHANGELOG.md docs/PROJECT_STATUS.md docs/implementation/implementation-plan.md docs/superpowers/specs/2026-11-15-content-publication-controls-design.md
git commit -m "docs: record publication controls decision and contracts (Prompt 068)"
```

---

### Task 9: Full verification and push

**Files:**
- None (verification only).

- [ ] **Step 1: Run the complete gate**

Run, in order:
```
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run test:e2e
npm run build
```
Expected: all pass (lint may keep the pre-existing `MODULE_TYPELESS_PACKAGE_JSON` warning). If a check fails, fix the failure caused by Prompt 068 and re-run.

- [ ] **Step 2: Review the diff**

Run: `git status --porcelain` and `git diff origin/main...HEAD`
Confirm: no `.env`/secrets; the two pre-existing untracked `docs/superpowers/.../2026-11-13-admin-form-patterns*.md` files are still untracked and untouched; only intended files changed.

- [ ] **Step 3: Push**

Run: `git push origin HEAD`
Expected: push succeeds. Report the commit hashes and push status.

- [ ] **Step 4: Report**

Report implementation, verification results, commit hashes, push status, and any limitation (for example: the 0007 backfill is exercised by the migration on the dev/test databases, not by a reversible test that re-inserts pre-migration rows).
