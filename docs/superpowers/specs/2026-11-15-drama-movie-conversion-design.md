# Drama → Standalone Movie Conversion (Prompt 067) — Design

**Status:** Approved (decisions confirmed by the user; implemented in Prompt 067)
**Date:** 2026-11-15
**Requirement:** `docs/requirements/REQUIREMENTS.md` §4.6, §8.3
**Builds on:** Prompt 065 (`D-028`, standalone movies), Prompt 066 (`D-029`, preview/apply conversion), `D-020` (exactly-one content target), `D-001` (movie ratings/reviews)

## 1. Intent

An administrator may convert a drama that contains **exactly one active episode** into a
standalone movie. The conversion carries the content's identity (title, slug, description,
images, publication state, categories, platforms, video source), preserves user-facing
relationships, records permanent provenance, and rejects every other episode count.

The operation is previewed, explicitly confirmed, transactional, serializable, and safe
against concurrent requests. The original drama row is retained in Trash for audit and
future Trash lifecycle handling; the drama's UUID is **never** reused as the movie UUID.

## 2. Confirmed decisions

| Area | Decision |
| --- | --- |
| Eligibility | Exactly one active episode. Zero or more than one → `409 Conflict`. Trashed episodes excluded. |
| Movie identity | New UUID. `movies.converted_from_drama_id` (nullable, unique when set) records permanent provenance. |
| Provenance FK | `converted_from_drama_id → dramas.id` with `ON DELETE RESTRICT`; a movie blocks permanent deletion of its source drama. |
| Drama/season/episode | Soft-deleted in the same transaction. Records and IDs are preserved for audit/Trash. |
| Slug | Copied unchanged. A conflict with another active movie → `409`, never auto-suffixed. |
| Ratings/reviews | Schema extended with nullable `movie_id`; exactly-one CHECK per D-020. Rows move from the drama to the movie. |
| Review children | `review_reactions` and `review_reports` reference `review_id` only; they move automatically and are untouched. |
| User state | Bookmarks, playback progress, watched state, watch history move to the movie. Progress/state `episode_id` becomes `NULL`; history keeps the episode id. |
| Polymorphic metadata | Slug history, SEO, assets, notifications, admin notifications, analytics events and aggregates move to the movie. |
| Similar dramas | Left untouched. Movie recommendations are not a modelled relationship (REQUIREMENTS §4.5). |
| Permission | `drama.manage` on API, Server Actions, and page. |
| Surface | `POST /admin/api/dramas/convert-to-movie` + `/admin/dramas/[id]/convert-to-movie` + list action. |
| Stale preview | SHA-256 fingerprint required on apply; mismatch → `409`. |
| Reverse conversion | Not supported in this prompt. |

## 3. Domain rules

### 3.1 Eligibility (preview and apply)

1. The drama exists and `deleted_at IS NULL`; otherwise `404`.
2. `movies.converted_from_drama_id = drama.id` must not exist; otherwise `409`
   ("already converted").
3. Active episodes (`deleted_at IS NULL`) must be exactly one; otherwise `409` naming the
   actual count.
4. No other active movie (`deleted_at IS NULL`) may use the drama's slug; otherwise `409`
   naming the slug and the conflicting movie title.
5. On apply, all four checks are repeated inside the transaction after locking the drama
   row.

### 3.2 Resulting movie

| Movie column | Source |
| --- | --- |
| `id` | New UUIDv7 |
| `title`, `slug`, `description`, `poster`, `banner` | Drama |
| `publication_status` | Drama's value when it is `draft`, `published`, or `unpublished`; otherwise `draft` + warning |
| `video_source` | The single active episode's `video_source` (may be `null`) |
| `converted_from_drama_id` | Drama id |
| `created_at` | Drama's `created_at` (content creation history) |
| `updated_at` | Conversion time |
| categories / platforms | Drama join rows copied, then removed from the drama |

### 3.3 Relationship migration

Inside the same transaction, keyed by `drama.id` and the new `movie.id`:

- `ratings`: `movie_id = movie.id`, `drama_id = NULL`.
- `reviews`: `movie_id = movie.id`, `drama_id = NULL`.
- `bookmarks`: `content_type = 'movie'`, `content_id = movie.id`.
- `playback_progress`, `watched_state`: `content_type = 'movie'`,
  `content_id = movie.id`, `episode_id = NULL`.
- `watch_history`: `content_type = 'movie'`, `content_id = movie.id`;
  `episode_id` is preserved as historical fact.
- `content_slug_history`, `content_seo`, `content_assets`, `notifications`,
  `admin_notifications`, `content_view_events`, `playback_analytics_events`,
  `analytics_daily_aggregates`: `content_type = 'movie'`, `content_id = movie.id`
  where they currently reference the drama.
- `structure_conversion_snapshots` and `similar_dramas` are untouched.

Only rows with `content_type = 'drama'` are migrated in polymorphic tables; rows with a
`NULL` type are not guessed.

### 3.4 Soft deletion

`seasons`, `episodes`, and `dramas` for the source drama are updated with
`deleted_at = now(), updated_at = now()` after the movie and all relationships are written.
No hard delete occurs anywhere in the workflow.

## 4. Schema changes

### 4.1 `movies`

- `converted_from_drama_id uuid NULL`.
- FK `fk_movies_converted_from_drama_id` → `dramas.id`, `ON DELETE RESTRICT`.
- Partial unique index `uq_movies_converted_from_drama_id` where the column is not null.

### 4.2 `ratings`

- `drama_id` becomes nullable.
- Add `movie_id uuid NULL`.
- CHECK `ck_ratings_target`: exactly one of `drama_id`, `movie_id` is non-null.
- FKs to `dramas` and `movies` (SQL migration; cross-module FKs are SQL-only).
- Partial unique indexes: `(user_id, drama_id)` where `deleted_at IS NULL AND drama_id IS NOT NULL`,
  and `(user_id, movie_id)` where `deleted_at IS NULL AND movie_id IS NOT NULL`.
- Content lookup indexes on `drama_id` and `movie_id`.

### 4.3 `reviews`

- `drama_id` becomes nullable; add `movie_id uuid NULL`.
- CHECK `ck_reviews_target` (same exactly-one rule).
- FKs to `dramas` and `movies`.
- Unique indexes `(user_id, drama_id)` and `(user_id, movie_id)` where the target is not null.
  Reviews have no soft delete: removal is permanent per requirements.
- Content lookup indexes on `drama_id` and `movie_id`.

Pre-migration duplicate check is documented; the tables currently have no review workflows,
so the new uniqueness rules are expected to hold.

## 5. API

`POST /admin/api/dramas/convert-to-movie`

```json
{ "dramaId": "uuid", "mode": "preview | apply", "fingerprint": "sha256 hex (apply only)" }
```

Strict Zod object; unknown fields rejected. Preview returns `{ "data": MovieConversionPreview }`;
apply returns `{ "data": MovieConversionApplyResult }` (preview plus `applied: true` and
`movieId`). Errors use the standard mapping: `400`, `401`, `403`, `404`, `409`, `500`.

Preview payload:

```json
{
  "dramaId": "uuid",
  "fingerprint": "sha256",
  "source": {
    "dramaId": "uuid",
    "episodeId": "uuid",
    "episodeTitle": "…",
    "episodeNumber": 1,
    "seasonId": "uuid|null"
  },
  "movie": {
    "title": "…", "slug": "…", "description": "…|null",
    "poster": "…|null", "banner": "…|null",
    "publicationStatus": "draft", "videoSource": "…|null",
    "convertedFromDramaId": "uuid",
    "categories": [{ "id": "uuid", "name": "…" }],
    "platforms": [{ "id": "uuid", "name": "…" }]
  },
  "relationships": {
    "ratings": 0, "reviews": 0, "bookmarks": 0,
    "playbackProgress": 0, "watchedState": 0, "watchHistory": 0,
    "categories": 0, "platforms": 0,
    "slugHistory": 0, "seo": 0, "assets": 0,
    "notifications": 0, "adminNotifications": 0,
    "analyticsEvents": 0
  },
  "warnings": []
}
```

Fingerprint covers the drama fields that affect the movie, the episode id and video source,
and the sorted category/platform ids. It excludes relationship counts and the slug-conflict
lookup so concurrent viewing activity does not invalidate a preview; the slug conflict is
rechecked during apply and enforced by the unique index.

## 6. Admin UI

### 6.1 `/admin/dramas`

Add a second row action, **Convert to movie**, rendered only when `activeEpisodes === 1`.
The existing **Convert structure** action is unchanged.

### 6.2 `/admin/dramas/[id]/convert-to-movie`

- Server component; `drama.manage` required, otherwise `notFound()`.
- Loads drama, active episodes, associations, relationship counts, slug conflict, and
  existing conversion.
- If not eligible, renders a read-only explanation with the actual active episode count and
  no convert button.
- Client panel (`drama-movie-conversion-panel.tsx`):
  - **Preview conversion** calls the Server Action and renders the resulting movie fields
    (title, description, poster, banner, categories, platforms, publication state, video
    source), the source episode, and relationship counts.
  - **Convert to movie** opens `ConfirmationDialog` naming the drama and consequence
    ("the drama, its season, and its episode will move to Trash").
  - Confirm sends the fingerprint. Apply revalidates everything server-side.
  - Loading, alert, conflict, and success states; inputs labelled; `aria-live` preview.
- Errors from preview/apply (including `409` slug/eligibility conflicts) render in
  `role="alert"` with the server message.

## 7. Files

### New

- `src/modules/content/movie-conversion.ts` — fingerprint, plan builder, eligibility types.
- `src/workflows/admin/movie-conversion.ts` — authorization, read models, preview, serializable apply.
- `src/workflows/admin/movie-conversion-actions.ts` — Server Actions.
- `src/app/admin/api/dramas/convert-to-movie/route.ts`.
- `src/app/admin/dramas/[id]/convert-to-movie/page.tsx`.
- `src/components/admin/dramas/drama-movie-conversion-panel.tsx`.
- `src/lib/contracts/drama-movie-conversion.ts`.
- `drizzle/0006_*.sql` + snapshot metadata (generated, then FK edits).
- Tests: domain unit tests, integration conversion/API tests, component test, E2E spec.

### Modified

- `src/modules/content/schema.ts` (movies provenance).
- `src/modules/reviews/schema.ts` (movie target).
- `src/modules/content/validation.ts` (conversion request schema).
- `src/app/admin/dramas/page.tsx` (conditional action).
- `docs/PROJECT_STATUS.md`, `docs/CHANGELOG.md`, `docs/decisions/DECISIONS.md` (D-030),
  `docs/development/DATABASE.md`, `docs/development/API.md`, `docs/development/admin-shell.md`.

## 8. Testing plan

| Layer | Coverage |
| --- | --- |
| Unit | fingerprint stability/sensitivity; plan builder; request validation; publication-status mapping; warnings. |
| Integration | happy path one episode; 0 and 2 episodes rejected; trashed episode excluded; slug conflict preview/apply; duplicate conversion; concurrent apply (`23505`/`40001` → 409); all relationship migrations; ratings/reviews exact-one constraint; rollback leaves everything unchanged; `drama.manage` authorization. |
| Component | preview rendering; confirmation dialog; conflict/error state; success state. |
| E2E | list shows the action only for one-episode dramas; preview and confirm conversion; ineligible drama shows no action. |

## 9. Verification

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run test:integration` against the `_test` database
- `npm run test:e2e` with Chromium
- `npm run build`
- Runtime: anonymous `401`, unauthorized `403`, eligible preview `200`, slug conflict `409`,
  apply `200`.
