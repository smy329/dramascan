# Content Publication Controls — Design (Prompt 068)

**Status:** Proposed, awaiting approval
**Date:** 2026-11-15
**Prompt:** 068 — Implement Content Publication Controls
**Related:** `REQUIREMENTS.md` §4.7, §5.2, §8.1; `DECISIONS.md` D-022, D-029, D-030; `CONVENTIONS.md`

---

## 1. Scope

Deliver manual publication control for dramas, seasons, episodes, and standalone movies as
**workflows, REST endpoints, validation, a database migration, tests, and documentation**.

No admin UI, buttons, tables, or pages are added or changed. Publication business logic is
written once in the workflow layer so the later content-management UI prompts can reuse it.

### 1.1 Non-goals

- Admin UI for publication.
- Public catalogue, search, discovery, playback authorization, or sitemap queries (none exist
  yet; those routes are placeholders). A shared availability predicate is introduced now and
  will be consumed by those future prompts.
- Notification events, scheduled publishing, cascading publish/unpublish, background workers.
- New RBAC permissions.

---

## 2. Decisions (proposed as D-031)

1. **Own state vs effective availability are distinct.** `publication_status` is the item's own
   state. Effective public availability is derived from the whole hierarchy plus Trash.
2. **No cascading.** Publishing/unpublishing a parent changes only that parent's own state.
3. **Episode publish eligibility depends only on the episode's own readiness** — a valid
   publication-ready source. Ancestor publication is an *availability* condition, not an
   eligibility condition. A published episode under a draft/unpublished parent stays
   `published` and is simply not publicly available.
4. **Publication-ready source = absolute HTTPS URL, pathname ending `.mp4` (case-insensitive),
   no embedded credentials.** Applied consistently to episode and movie create, update,
   source replacement, and publication.
5. **Canonical state vocabulary everywhere:** `draft | published | unpublished`, enforced by the
   database, with `draft` as the default.
6. **Bulk publish/unpublish is in scope**, with per-item skip/fail reporting.
7. **Authorization reuses `<resource>.manage`** (`drama.manage`, `season.manage`,
   `episode.manage`, `movie.manage`). The permission catalog and role seeds are untouched.
8. **Dedicated endpoints are the only publication write path.** Create/update payloads reject
   `publication_status`; metadata edits never change publication state.
9. **Drama→movie conversion downgrade rule (compatibility for D-030):** if the mapped state is
   `published` but the single episode's source is missing or not publication-ready, the movie is
   created as `draft` and the preview warns. Otherwise Prompt 067 behavior is preserved.

---

## 3. Domain rules (pure module)

New file `src/modules/content/publication.ts` (no database access):

- `PUBLICATION_STATUSES` — `['draft', 'published', 'unpublished']`.
- `PublicationStatus` type.
- `normalizePublicationStatus(value: string | null | undefined): PublicationStatus` — maps any
  non-canonical/legacy value to `draft`. Used when reading old conversion snapshots so a stored
  `null`/`ongoing`/`completed` can never be written back into a constrained column.
- `isPublicationReadySource(value: string | null): boolean` — delegates to the shared Zod
  source schema.
- `evaluatePublicationEligibility(input)` → `{ eligible, reason, message }`:
  - drama/season: eligible (unpublish always eligible).
  - episode/movie publish: eligible only when the source is publication-ready; otherwise
    `missing_source` or `invalid_source`.
  - unpublish: always eligible for all types.
- `evaluatePublicAvailability(input)` → `{ publiclyAvailable, blockers[] }`:
  - drama: own `published` and not trashed.
  - season: own `published`, parent drama `published`, neither trashed.
  - episode: own `published`, parent drama `published`, season (if any) `published`, none trashed.
  - movie: own `published` and not trashed.

`Content availability is centralized here`; future public queries, playback authorization,
search, discovery, and sitemap generation must call these predicates instead of comparing one
column.

---

## 4. Source validation contract

In `src/modules/content/validation.ts`:

- Add `publicationReadyVideoSourceSchema`: trimmed string, 1–2048 chars, parses as a URL,
  `protocol === 'https:'`, no username/password, `pathname.toLowerCase().endsWith('.mp4')`.
  Query strings and fragments are allowed.
- Reuse it for `movieVideoSourceSchema` (keep the exported name as an alias so existing imports
  and tests stay valid), episode `createEpisodeSchema.video_source`, episode
  `updateEpisodeSchema.video_source`, and `replaceEpisodeVideoSource`.
- Remove `publication_status` from `createMovieSchema`/`updateMovieSchema` and from the episode
  schemas. Strict objects already reject unknown keys on drama/season schemas.
- Add `publicationRequestSchema`: `contentType: 'drama'|'season'|'episode'|'movie'`,
  `action: 'publish'|'unpublish'`, `ids: string[]` (1–200 unique-or-duplicate UUIDs). Malformed
  ids are classified per item rather than rejected at the schema level, so valid ids in the same
  request still succeed.

---

## 5. Database migration 0007

Generated with `drizzle-kit generate`, then hand-edited so the backfill runs **before**
`SET NOT NULL` / `ADD CONSTRAINT`.

For `dramas`, `seasons`, `episodes`, `movies`:

1. Backfill before any constraint change:
   - `publication_status IS NULL` → `'draft'`.
   - Episode legacy `'ongoing'`/`'completed'` → `'draft'` (these are lifecycle values, not
     publication states).
   - Any other non-canonical value → `'draft'` (documented in the migration comment; the
     application has never produced other values, and a non-destructive deterministic mapping
     is safer than blocking the deploy).
   - Drama `status` (Ongoing/Completed) is untouched.
2. `ALTER COLUMN publication_status SET DEFAULT 'draft'`.
3. `ALTER COLUMN publication_status SET NOT NULL`.
4. `ADD CONSTRAINT ck_<table>_publication_status CHECK (publication_status IN ('draft',
   'published', 'unpublished'))`.

Drizzle schema: `publication_status: text('publication_status').notNull().default('draft')`
plus a `checkConstraint` callback on each of the four tables.

No indexes are added in this prompt: there are no public publication queries yet, so an index
would be speculative. The list filters are admin-side and bounded by `pageSize`.

---

## 6. API contract

### 6.1 `POST /admin/api/publication`

Route: `src/app/admin/api/publication/route.ts` (+ local `_shared.ts` with `beginAdminRequest`,
`assertSameOrigin`, `readJsonBody`, `jsonResponse`, `errorResponse`, `authorizePublication`).

Request:

```json
{ "contentType": "episode", "action": "publish", "ids": ["uuid", "..."] }
```

Response `200`:

```json
{
  "data": {
    "contentType": "episode",
    "action": "publish",
    "summary": { "requested": 5, "succeeded": 2, "skipped": 2, "failed": 1 },
    "results": [
      { "id": "...", "status": "succeeded", "reason": null, "publicationStatus": "published", "publiclyAvailable": false },
      { "id": "...", "status": "skipped", "reason": "missing_source", "message": "Episode has no video source." },
      { "id": "...", "status": "skipped", "reason": "duplicate_id", "message": "Duplicate id ignored." },
      { "id": "not-a-uuid", "status": "failed", "reason": "invalid_id", "message": "Id must be a UUID." }
    ]
  }
}
```

Statuses: `succeeded | skipped | failed`; counts always sum to `requested` (duplicates get their
own skipped result).

Reasons: `invalid_id`, `not_found`, `trashed`, `already_published`, `already_unpublished`,
`missing_source`, `invalid_source`, `duplicate_id`, `update_failed`.

Status codes: `400` malformed body, `401` anonymous, `403` missing `<resource>.manage`,
`200` otherwise (partial success is reported, not hidden).

### 6.2 Workflow

`src/workflows/admin/publication.ts` (server-only):

- `updatePublication(actor, input)` — validates, resolves the permission key from `contentType`,
  checks it once at entry, then processes batches of at most 100 unique ids.
- Per batch transaction:
  - `SELECT ... FOR UPDATE` on the target rows (skips non-matching/deleted rows safely).
  - Classify each id: malformed id → `failed/invalid_id`; missing → `skipped/not_found`;
    `deleted_at IS NOT NULL` → `skipped/trashed`; already in the target state →
    `skipped/already_*`; source check for publish of episodes/movies → `skipped/missing_source` or
    `skipped/invalid_source`.
  - `UPDATE <table> SET publication_status, updated_at WHERE id IN (...) AND publication_status
    <> target RETURNING *` — atomic and concurrency-safe; the row lock plus conditional predicate
    means concurrent publish/unpublish cannot produce inconsistent states.
  - Load ancestor rows (drama for seasons; drama + optional season for episodes) and compute
    `publiclyAvailable` for the response.
- A batch that throws marks its items `failed/update_failed` (logged) and the next batch still
  runs. Eligibility never fails the whole request.
- `publishContent` / `unpublishContent` thin aliases are exported for the future UI.

Authorization is enforced in the workflow (`requirePermission`), not only in the route, and the
route re-checks before dispatch.

---

## 7. Admin read models

- `toDrama` gains `publicationStatus` and `publiclyAvailable`.
- `listDramas`: fix the filter — `status=draft|published|unpublished` filters
  `publication_status`; `status=trashed` selects `deleted_at IS NOT NULL` (and the default
  excludes trashed). Sort by `status` now sorts `publication_status`. The current code filters
  `dramas.status` against publication values, which matches nothing.
- `listSeasons`: join `dramas` and expose `publiclyAvailable`.
- `listEpisodes`: join `dramas` and left-join `seasons`, expose `publiclyAvailable`; fix the
  `publication_status` filter enum from `ongoing|completed` to the canonical values.
- `toSeason`/`toEpisode` keep returning the item's own `publicationStatus`; the list and
  publication endpoints provide the derived availability.
- Movies have no list endpoint; `toMovie` gains `publiclyAvailable` (trivial: own state).
- Create/update responses return the unchanged `publicationStatus`, proving a metadata edit cannot
  change publication state.

---

## 8. Conversion compatibility

- `resolveMoviePublicationStatus` keeps its defensive normalization but delegates to
  `normalizePublicationStatus`.
- `computeMovieConversionFingerprint` and `buildMovieConversionPlan` resolve the **effective**
  status: mapped `published` is downgraded to `draft` when the episode source is not
  publication-ready. Preview adds an explicit warning naming the resulting draft state.
- Apply recomputes the same effective status inside the transaction from the locked source, so a
  changed source between preview and apply cannot produce a published movie.
- Structure-conversion snapshot restore writes
  `normalizePublicationStatus(season.publication_status)`; the `null` used for newly planned
  flat→season seasons becomes `draft`. Old snapshots therefore restore without violating the
  CHECK constraint.

---

## 9. Files

**New**

- `src/modules/content/publication.ts` — pure publication/availability rules.
- `src/workflows/admin/publication.ts` — single + bulk publish/unpublish workflows.
- `src/app/admin/api/publication/route.ts`, `src/app/admin/api/publication/_shared.ts`.
- `drizzle/0007_*.sql`, `drizzle/meta/0007_snapshot.json`, `drizzle/meta/_journal.json` update.
- `tests/unit/modules/content/publication.test.ts`
- `tests/integration/content/publication.integration.test.ts`
- `tests/integration/content/publication-schema.integration.test.ts`
- `tests/e2e/publication-api.spec.ts`

**Modified**

- `src/modules/content/schema.ts`, `src/modules/content/validation.ts`,
  `src/modules/content/index.ts`, `src/modules/content/movie-conversion.ts`,
  `src/modules/content/conversion.ts`.
- `src/workflows/admin/{dramas,seasons,episodes,movies,conversion,movie-conversion}.ts`.
- `tests/unit/modules/content/{movie-validation,conversion,movie-conversion}.test.ts`.
- `tests/integration/content/{movies,dramas,movie-conversion,movie-conversion-api,conversion}.integration.test.ts`
  (fixture sources must end in `.mp4`; movie payloads stop sending `publication_status`).
- `tests/e2e/support/drama-fixture.mjs` (episode source defaults to an `.mp4` URL).
- Docs: `DECISIONS.md` (D-031), `DATABASE.md`, `API.md`, `SECURITY.md`, `CHANGELOG.md`,
  `PROJECT_STATUS.md`.

---

## 10. Verification plan

- Unit: eligibility matrix, availability hierarchy matrix, source validator (HTTP, credentials,
  non-`.mp4`, uppercase `.MP4`, query string, malformed), request schema, conversion downgrade.
- Integration: real PostgreSQL test DB; single/bulk publish and unpublish per type; episode with
  missing/invalid source skipped; published child under unpublished parent is unavailable;
  publish/unpublish never cascades; trashed items skipped; duplicates reported; malformed and
  missing ids reported; concurrent publishes serialize; permission denial; `NOT NULL`/default/
  CHECK enforcement; backfill behavior reviewed via the migration SQL.
- E2E: anonymous request → 401/403; Super Admin session publishes and unpublishes a seeded drama
  through the real route, database, and permission guard.
- Typecheck, lint, unit, integration, E2E, and production build.

## 11. Risks

- **Migration on existing rows:** mitigated by ordering the backfill before the constraints.
- **Breaking API change** (removing `publication_status` from movie create/update and the episode
  `ongoing|completed` filter): documented in `API.md` and reflected in OpenAPI later.
- **Existing tests** using HTTP or non-`.mp4` sources must be updated; changing fixtures is
  expected and required by the new contract.
- **Conversion fingerprints** change for planned/legacy states; preview and apply recompute
  identically, so a valid preview still applies.
