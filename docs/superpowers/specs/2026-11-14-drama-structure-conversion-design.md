# Drama Structure Conversion (Prompt 066) — Design

**Status:** Approved (implemented in Prompt 066; see `D-029` in `docs/decisions/DECISIONS.md`)
**Date:** 2026-11-14
**Requirement:** `docs/requirements/REQUIREMENTS.md` §4.6, §8.1
**Builds on:** Prompt 065 (`D-028`, API-first content administration), Prompt 052 (admin form patterns)

## 1. Intent

Administrators need to move a drama between the two supported drama structures without
losing content identity or user state:

- **Season-based → flat:** merge seasons into one ordered episode sequence, renumber
  sequentially, and store an exact snapshot of the season structure so it can be restored.
- **Flat → season-based:** either restore a valid snapshot exactly, or create a new season
  structure from an administrator-supplied distribution map.

The conversion must be previewable, explicitly confirmed, transactional, and safe under
concurrent edits. Episode IDs, viewing records, and episode metadata are never rewritten.

## 2. Confirmed decisions

| Area | Decision |
| --- | --- |
| Surface | REST API **and** a minimal admin UI (`/admin/dramas`, `/admin/dramas/[id]/convert`) |
| Season → flat order | `season.position`, then `episode.position`, then `episode_number`, then `created_at`, then `id`; seasonless episodes last |
| Season → flat numbering | Sequential `1..N` with no gaps; `position` set to the same 0-based order |
| Flat → season payload | Full distribution map; default is one Season 1 containing every active episode |
| Reversibility | Persist an exact snapshot before every season → flat conversion |
| Restorable snapshot | Only when the current flat structure exactly matches the stored post-conversion fingerprint |
| Snapshot retention | One `available` snapshot per drama; history kept as `superseded`/`restored` |
| Snapshot vs distribution | If an `available` snapshot exists, `strategy` is mandatory on every flat → season request |
| Trashed rows | Excluded and left untouched in both directions |
| Permission | `drama.manage` on every API, Server Action, and page |
| Stale preview | `fingerprint` mandatory on apply; mismatch returns `409 Conflict` |
| Scope | Season ↔ flat only. Drama → movie is excluded |

## 3. Goals / non-goals

### Goals

1. Predictable, deterministic conversion in one transaction.
2. Exact, auditable snapshots with an explicit lifecycle.
3. Stale-preview and stale-snapshot rejection instead of silent overwrites.
4. A minimal admin surface that makes the feature usable and fixes the current
   `/admin/dramas` navigation 404.
5. Unit, integration, component, and end-to-end coverage of the conversion rules.

### Non-goals

- Drama → standalone movie conversion.
- Full drama CRUD UI, publishing, deletion, bulk actions, or episode editing UI.
- Background jobs or scheduled snapshot cleanup.
- Rewriting episode metadata, IDs, viewing records, ratings, reviews, or bookmarks.
- Restoring soft-deleted seasons or episodes as part of conversion.

### Anti-goals

- Merging seasons by title or any heuristic.
- Renumbering on flat → season conversion.
- Applying a preview whose underlying structure changed.
- Restoring a snapshot after any structural edit.
- Deleting historical snapshots.

## 4. Domain rules

### 4.1 Season-based → flat

Active rows only (`deleted_at IS NULL`).

1. Order seasons by `position ASC NULLS LAST, created_at ASC, id ASC`.
2. Order episodes assigned to a season by that season's order, then
   `position ASC NULLS LAST, episode_number ASC NULLS LAST, created_at ASC, id ASC`.
3. Append seasonless active episodes after all season-assigned episodes, ordered by
   `position, episode_number, created_at, id`.
4. Resolve the final order once. Set:
   - `season_id = NULL`
   - `episode_number = index + 1`
   - `position = index`
   - `updated_at = now()`
5. Soft-delete every active season (`deleted_at = now(), updated_at = now()`).
6. Set `dramas.structure_type = 'flat'`, `updated_at = now()`.

The snapshot is written in the same transaction before the seasons are soft-deleted.

### 4.2 Flat → season-based (`convert`)

Active rows only.

1. The request supplies `seasons: [{ key, title, position? }]` and
   `assignments: [{ episodeId, seasonKey }]`.
2. If `distribution` is omitted, synthesise one season
   `{ key: 'season-1', title: 'Season 1', position: 0 }` and assign every active episode.
3. Validate: at least one season, at most 100; non-empty unique `key`; trimmed title
   1–100 characters; unique `position >= 0` (defaults to array index); every active
   episode assigned exactly once; no unknown episode, trashed episode, or foreign episode;
   no unknown season key.
4. Create season rows with new UUIDs and `publication_status = NULL`.
5. Set each active episode's `season_id`; **do not** change `episode_number` or `position`.
6. Set `dramas.structure_type = 'season_based'`.
7. If an `available` snapshot existed, mark it `superseded` in the same transaction.

### 4.3 Flat → season-based (`restore_snapshot`)

1. Resolve the drama's `available` snapshot. `snapshotId`, when supplied, must match it.
2. Require `status = 'available'`, no `restored_at`/`superseded_at`, and the drama currently
   `flat`.
3. Recompute the current structure fingerprint. It must equal
   `snapshot.post_conversion_fingerprint`; otherwise `409 Conflict` and the snapshot is kept.
4. Require every snapshot season row to still exist for the drama, and every snapshot
   episode row to still exist and be active. Any missing row means the snapshot is stale.
5. Require the current active episode ID set to equal the snapshot episode ID set.
6. Restore, in one transaction:
   - seasons: `deleted_at = NULL`, `title`, `position`, `publication_status` from the
     snapshot, `updated_at = now()` (IDs preserved);
   - episodes: `season_id`, `episode_number`, `position` from the snapshot,
     `updated_at = now()` (IDs and all other metadata preserved);
   - `dramas.structure_type = 'season_based'`;
   - snapshot: `status = 'restored'`, `restored_at = now()`.
7. If a snapshot season can no longer be reactivated (row missing), reject before writing.

### 4.4 Trashed records

- Trashed episodes are excluded from ordering, renumbering, distribution, fingerprints,
  and snapshots. Their `season_id`, numbers, metadata, IDs, and deleted state are untouched.
- Trashed seasons are excluded from active structure and snapshots. Conversion never
  restores or permanently deletes them.
- Restoring a snapshot reactivates the seasons in that snapshot only. Seasons that were
  already trashed before the snapshot are not part of the snapshot.

## 5. Fingerprint

SHA-256 over canonical JSON, sorted by ID:

```json
{
  "dramaId": "…",
  "structureType": "flat",
  "seasons": [
    { "id": "…", "title": "…", "position": 0, "publicationStatus": null }
  ],
  "episodes": [
    { "id": "…", "seasonId": null, "episodeNumber": 1, "position": 0 }
  ]
}
```

- Active rows only.
- Nulls are explicit.
- Episode title, description, publication status, video source, and timestamps are excluded
  because conversion never changes them.
- Season title, position, and publication status are included because snapshot restore
  restores them.
- The same function is used for preview, apply verification, and the post-conversion
  snapshot fingerprint.

## 6. Snapshot model

New table `structure_conversion_snapshots` (content module):

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | UUIDv7 |
| `drama_id` | uuid not null | FK to `dramas.id`, `ON DELETE CASCADE` |
| `source_structure_type` | text not null | `season_based` |
| `target_structure_type` | text not null | `flat` |
| `season_data` | jsonb not null | array of `{ id, title, position, publication_status, created_at, updated_at }`; timestamps are audit metadata only |
| `episode_data` | jsonb not null | array of `{ id, season_id, episode_number, position, title }`; title is audit metadata only |
| `post_conversion_fingerprint` | text not null | fingerprint after conversion |
| `status` | text not null default `available` | `available` / `restored` / `superseded` |
| `restored_at` | timestamptz null | set on restore |
| `superseded_at` | timestamptz null | set on supersede |
| `created_at`, `updated_at` | timestamptz not null | standard |

Constraints and indexes:

- `ck_structure_conversion_snapshots_status`:
  `status IN ('available', 'restored', 'superseded')`.
- `ck_structure_conversion_snapshots_direction`: source/target fixed to `season_based`/`flat`.
- `idx_structure_conversion_snapshots_drama_id` on `drama_id`.
- `uq_structure_conversion_snapshots_drama_id_available`: partial unique on `drama_id`
  where `status = 'available'`.
- JSON payloads are validated with Zod on read; malformed data is a server error, never a
  silent restore.

Lifecycle:

```
(none) --season->flat apply--> available
available --restore--> restored        (terminal)
available --new season->flat apply--> superseded
available --flat->season `convert`--> superseded
restored/superseded are never restorable and are never deleted by conversion
```

Status changes and conversion writes share one transaction. If any step fails, no snapshot
row is created and no status changes.

## 7. Preview and apply contract

`POST /admin/api/dramas/convert`

```json
{
  "dramaId": "uuid",
  "mode": "preview | apply",
  "targetStructureType": "flat | season_based",
  "strategy": "convert | restore_snapshot",
  "fingerprint": "sha256 hex (required on apply)",
  "snapshotId": "uuid (optional; defaults to the available snapshot)",
  "distribution": {
    "seasons": [{ "key": "s1", "title": "Season 1", "position": 0 }],
    "assignments": [{ "episodeId": "uuid", "seasonKey": "s1" }]
  }
}
```

Rules:

- `targetStructureType` must differ from the current `structure_type`, otherwise `409`.
- `flat` target: `strategy` must be `convert` (or omitted); distribution is ignored.
- `season_based` target with an `available` snapshot: `strategy` is mandatory; missing or
  invalid strategy is `400`.
- `season_based` target without an available snapshot: `strategy` must be `convert`
  (or omitted); `restore_snapshot` is `400`.
- `restore_snapshot` rejects distribution input.
- Apply requires `fingerprint`; preview returns it.
- All requests are strict Zod objects; unknown fields are rejected.
- For a stale snapshot, preview still returns the saved plan with
  `snapshot.restorable = false` and a `warnings` entry explaining the mismatch, so the
  administrator can see why restore is blocked; apply rejects it with `409`.

Preview response (HTTP 200):

```json
{
  "data": {
    "dramaId": "uuid",
    "currentStructureType": "season_based",
    "targetStructureType": "flat",
    "strategy": "convert",
    "fingerprint": "sha256 hex",
    "seasons": [{ "key": "s1", "id": "uuid|null", "title": "…", "position": 0, "episodeCount": 12 }],
    "episodes": [{
      "id": "uuid", "title": "…",
      "fromSeasonId": "uuid|null", "toSeasonKey": "s1",
      "fromEpisodeNumber": 3, "toEpisodeNumber": 1,
      "fromPosition": 2, "toPosition": 0
    }],
    "counts": { "activeEpisodes": 12, "seasonsAffected": 2, "seasonsCreated": 0 },
    "snapshot": { "id": "uuid|null", "status": "available", "createdAt": "…", "restorable": true },
    "warnings": ["…"]
  }
}
```

Apply response (HTTP 200): the same plan shape plus
`applied: true`, `newFingerprint`, `snapshotId`, and `snapshotStatus`.

Errors use the existing mapping: `400` validation, `401` unauthenticated, `403` forbidden,
`404` drama/snapshot not found, `409` structure conflict / stale fingerprint / stale
snapshot / serialization conflict, `500` unexpected.

Concurrency:

- Apply runs in a `serializable` transaction.
- The drama row is locked `FOR UPDATE`; active seasons and episodes are read in the same
  transaction.
- The fingerprint is recomputed after the lock and before any write.
- PostgreSQL `40001` and `23505` are mapped to `409 Conflict`.
- A failed apply changes nothing.

## 8. Admin UI

### 8.1 `/admin/dramas`

- Server component; `drama.manage` required; otherwise `notFound()`.
- Reuses the admin shell, data table, pagination, and table state contract.
- Columns: title, structure type, active episode count, action.
- Action: **Convert structure** → `/admin/dramas/[id]/convert`.
- Supports `page`, `pageSize`, and title search; no create/edit/delete/publish controls.
- Loading and error states follow the users page pattern.
- The Dramas navigation entry permissions change to `['drama.manage']` so a link is never
  shown to an actor the list would reject with a 404.

### 8.2 `/admin/dramas/[id]/convert`

- Server component loads drama, active seasons, active episodes, and the available snapshot.
- `drama.manage` required; missing/deleted drama → `notFound()`.
- Client panel (`drama-conversion-panel.tsx`):
  - **Season-based:** ordered episode preview with old → new number; **Preview conversion**,
    then **Confirm conversion** through `ConfirmationDialog`. Confirm sends the fingerprint.
  - **Flat, no snapshot:** season editor (add/remove season, title, position) with one
    Season 1 by default and per-episode season selects. **Preview conversion**, then confirm.
  - **Flat, available snapshot:** explicit radio choice between **Restore previous
    structure** and **Create new seasons**. Restore shows the snapshot plan and confirms;
    new seasons show the distribution editor.
  - Errors render in `role="alert"`; preview results in an `aria-live` region; all inputs
    have labels; apply buttons are disabled while pending.
- Server Actions (`src/workflows/admin/conversion-actions.ts`) call the same workflow as the
  API and map errors with `mapErrorToActionResult`. No client-side permission check is
  treated as authorization.

## 9. Files

### New

- `src/modules/content/conversion.ts` — ordering, plan builders, distribution validation,
  fingerprint, snapshot payload parsing.
- `src/workflows/admin/conversion.ts` — authorization, preview/apply orchestration,
  transactions, locking, snapshot lifecycle, admin list/detail read models.
- `src/app/admin/api/dramas/convert/route.ts` — REST entrypoint.
- `src/app/admin/dramas/page.tsx`, `loading.tsx`, `error.tsx`.
- `src/app/admin/dramas/[id]/convert/page.tsx`.
- `src/workflows/admin/conversion-actions.ts` — Server Actions (`previewDramaConversion`,
  `applyDramaConversion`). **Placement deviation from the plan:** the actions live in the
  workflows layer beside the workflow they call rather than in
  `src/app/admin/dramas/[id]/convert/actions.ts`. A client component cannot import an
  `app/**` module without pulling the route tree into the client bundle, and the
  components layer may not import the content module, so the client-safe DTOs live in
  `src/lib/contracts/drama-conversion.ts` and the actions in `src/workflows/admin/`.
- `src/components/admin/dramas/drama-conversion-panel.tsx`.
- `drizzle/0005_*.sql` and snapshot metadata (generated).
- Tests: unit conversion rules/fingerprint/validation, integration conversion and snapshot
  lifecycle, component tests for the panel, E2E for list + preview.

### Modified

- `src/modules/content/schema.ts` — snapshot table.
- `src/modules/content/validation.ts` — conversion request/distribution schemas.
- `src/workflows/admin/dramas.ts` — only if a shared helper is needed; no behaviour change.
- `src/components/admin/navigation.ts` — Dramas entry permission becomes `drama.manage`.
- `docs/PROJECT_STATUS.md`, `docs/CHANGELOG.md`, `docs/decisions/DECISIONS.md`
  (D-029), `docs/development/DATABASE.md`, `docs/development/API.md`,
  `docs/development/admin-shell.md`, `docs/architecture/ARCHITECTURE.md`.

## 10. Testing plan

| Layer | Coverage |
| --- | --- |
| Unit | deterministic ordering; seasonless placement; renumber map; distribution validation (missing, duplicate, unknown, trashed, foreign); fingerprint stability and sensitivity; snapshot payload parsing; strategy rules |
| Integration | season→flat with multiple seasons and gaps; snapshot row + fingerprint; flat→season default and full distribution; explicit strategy requirement; restore happy path; stale fingerprint 409; stale snapshot after add/trash/reorder/renumber 409; repeated conversion supersedes; one-available constraint; trashed rows untouched; rollback on failure; `drama.manage` authorization; serialization conflict |
| Component | preview/confirm flow; strategy selector; distribution editor validation; error and pending states |
| E2E | `/admin/dramas` lists a drama and links to conversion; season→flat preview and confirm; flat→season restore path |

## 11. Verification

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run test:integration` against `TEST_DATABASE_URL`
- `npm run test:e2e` with Chromium
- `npm run build` with the HTTPS environment overrides
- Runtime checks: anonymous 401, unauthorized 403, preview/apply 200, stale 409

## 12. Builder calls (review these)

1. Seasonless episodes in a season-based drama are placed **after** season-assigned
   episodes rather than rejected.
2. Episode publication status and other non-structural metadata are **excluded** from the
   fingerprint, so editing them does not invalidate a snapshot.
3. Snapshot restore **overwrites** episode `season_id`, `episode_number`, and `position`
   with snapshot values; it never touches titles, descriptions, sources, or viewing data.
4. A regular flat → season `convert` **supersedes** an available snapshot, but only after
   the admin explicitly chose `convert`.
5. Historical snapshots are retained indefinitely; no cleanup job is introduced.
