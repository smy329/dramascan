# Changelog

All notable changes to the DramaScan project will be documented in this file.

## [Unreleased] - 2026-11-22

### feat: complete the episode video source workflow (Prompts 080–090)

An episode now carries one administrator-supplied, public, direct HTTPS MP4 URL
that the browser plays directly with Vidstack. The application server never
fetches, proxies, relays, rehosts, transcodes, or uploads video.

- `src/modules/content/schema.ts` (modified): `episodes.video_source` holds the
  direct URL and nothing else — no claim id, provider id, upload record,
  staging path, or transcoding metadata (Prompt 080).
- `src/modules/content/validation.ts` (modified): server-side Zod validation
  for the source URL. HTTPS only, valid URL, credential-free host, direct MP4
  path, no suspicious input. The server never issues an HTTP request against an
  administrator-supplied URL, so there is no SSRF surface. The validation
  explicitly does not claim that the file plays (Prompt 081).
- `src/components/admin/dramas/episode-manager.tsx` (modified): the episode
  form has a clearly labelled "direct MP4 URL" field with inline validation
  errors, a browser preview, and no file picker, upload control, or automatic
  metadata extraction. Title, description, thumbnail, taxonomy, season,
  episode number, and publication metadata stay administrator-authored
  (Prompts 082/083).
- `src/components/admin/media/video-source-preview.tsx` (modified): the
  preview plays the entered URL in the real browser player and reports whether
  playback actually started. It requests the media with
  `crossorigin="anonymous"`, exactly like the viewer's player, so a host
  without CORS headers fails the preview instead of passing it and failing for
  every viewer. A successful save or an `.mp4` suffix is never treated as
  proof of playability (Prompt 084).
- `src/app/(public)/drama/[dramaId]/[slug]/episode/[episodeId]/page.tsx`
  (new) and `src/components/player/vidstack-player.tsx` (new): the viewer page
  renders the stored URL through Vidstack with standard controls, seeking,
  volume, fullscreen, playback speed, and a responsive layout. The browser
  requests the media directly from the external host (Prompt 085).
- `src/proxy.ts` (new), `src/platform/security/csp.ts` (new),
  `src/app/layout.tsx` (modified): a per-request nonce Content Security
  Policy. `media-src` and `connect-src` list the trusted media origins and
  never use `*`; image, script, and style policies stay separate.
  `MEDIA_ALLOWED_HOSTS` pins the approved hosts — an empty value means any
  HTTPS origin (Prompt 086).
- `src/workflows/admin/episodes.ts` (modified):
  `replaceEpisodeVideoSource` runs one transaction that updates the source,
  resets every viewer's progress to zero and the episode to unwatched, and
  writes the operational record. Watch-history rows and their historical dates
  are preserved; the episode id, metadata, hierarchy, reviews, and ratings are
  untouched. `updateEpisode` refuses a changed `video_source`, and the episode
  edit form no longer submits the field at all (Prompt 087).
- `src/components/player/vidstack-player.tsx` (new): when the source fails the
  viewer sees a clear error and a manual *Try again* control. There is no
  automatic retry, URL search, repair, provider switching, or background retry,
  and the stored source stays unchanged until an administrator replaces it.
  `src/components/admin/dramas/playback-failure-list.tsx` (new) gives
  administrators visibility into viewer-reported failures (Prompt 088).
- `src/modules/playback/schema.ts` (modified): `subtitle_tracks` stores
  per-episode subtitle metadata and direct source URLs. The **server** validates
  each URL — HTTPS only, an absolute URL, no embedded credentials, a closed
  format set (`vtt`, `srt`, `ssa`, `ass`, `json`), and an extension that
  matches the declared format. The player offers language labels and a
  default-track selection. The browser fetches subtitle files directly; the
  server never fetches, transcodes, or converts them.
  `src/components/admin/dramas/subtitle-track-manager.tsx` (new) manages them
  (Prompt 089).
- `tests/unit/architecture/direct-video-source.test.ts` (new): a
  repository-wide guard fails the suite if upload endpoints, staging
  directories, temp video storage, multipart or resumable upload code, upload
  progress, upload retries, upload cleanup, transcoding, processing workers,
  or a video proxy/relay/rehost reappear. Poster and banner image uploads are
  explicitly out of its scope and are untouched (Prompt 090).
- `drizzle/0013_video_source_workflow.sql` (new): creates `subtitle_tracks`,
  `playback_failure_reports`, and `admin_audit_log` with their indexes and
  cross-module foreign keys.
- `src/modules/users/progress.ts` (new): `savePlaybackProgress(actor, input,
  options?)` upserts one `playback_progress` row and one `watched_state` row
  per user and episode. An update that was observed earlier never overwrites a
  newer one, the watched state is sticky and keeps its first completion date,
  and no watch-history row is written.
  `PLAYBACK_COMPLETION_THRESHOLD_PERCENT` (default 90) is the single
  completion threshold: the server applies it when it stores the watched state,
  and the watch page hands the same value to the player, so the client and the
  server never apply divergent rules.
- `src/modules/users/watch-state.ts` (new),
  `src/modules/administration/audit-log.ts` (new),
  `src/modules/content/episode-references.ts` (new), and
  `src/platform/db/executor.ts` (new) support the transactional replacement.
- `src/workflows/action-errors.ts` (moved from `src/workflows/admin/action-errors.ts`)
  so the public playback workflow can reuse the shared error adapter.
- Tests: `tests/e2e/{admin-episode-video-source.spec.ts,public-episode-playback.spec.ts}`,
  `tests/integration/{content/episode-video-source.integration.test.ts,content/public-episodes.integration.test.ts,users/episode-watch-state.integration.test.ts,users/playback-progress.integration.test.ts}`,
  `tests/unit/components/{video-source-preview.test.tsx,vidstack-player.test.tsx}`,
  `tests/unit/modules/{content/public-episodes.test.ts,playback/*}`,
  `tests/unit/platform/{config/playback-completion-threshold.test.ts,security/*}`.
- Verified: typecheck PASS; lint PASS; unit 973/973 PASS; integration 576/576
  PASS; Playwright E2E 49/49 PASS; production build PASS.

### test: warm the development server before the end-to-end suite

The end-to-end launcher runs `next dev`, and a development server compiles a
route the first time it is requested. On a slow filesystem that compile can
take longer than a test's own timeout, which made five unrelated tests fail
with a timeout while the server was still compiling the page the test had just
navigated to.

`tests/e2e/support/warmup.mjs` (new) requests every route the suite exercises
before the first test runs, so the compile cost is paid once, up front.
`tests/e2e/support/global-setup.mjs` (modified) calls it after the server
identity and the test database have been verified. The warm-up only issues
plain GET requests: a redirect and a not-found response both prove that the
route compiled, so it needs no session and creates no data. The per-test
timeouts are unchanged — the suite now measures the application instead of the
development server's cold start.

### feat: implement content publication controls and bulk publication (Prompts 068–069)

Publication state is now set explicitly, item by item, and a bulk operation
reports every item it skipped and why.

- `src/workflows/admin/publication.ts` (new): actor-first publication
  workflows. `updatePublication` applies a publish/unpublish operation to a
  bounded batch (maximum 100 ids), decides eligibility per item inside the
  transaction, and reports a machine-readable reason for every skipped item
  (`missing_video_source`, `already_published`, `already_unpublished`,
  `trashed`, `invalid_id`, `duplicate_id`). Publishing a parent never
  publishes its children.
- `src/app/admin/api/publication/route.ts` (new): `POST /admin/api/publication`,
  guarded by the manage permission of the submitted content type and by the
  same-origin rule.
- `src/app/admin/publication/page.tsx` (new) and
  `src/components/admin/publication/publication-manager.tsx` (new): the
  dedicated publication surface with type tabs, search, pagination, checkbox
  selection, bulk publish/unpublish, and the per-item skip report.
- `src/modules/content/publication.ts`: the shared availability rule now
  backs the admin workflows as well as the public site.

### feat: implement empty-drama visibility settings (Prompt 070)

- `EMPTY_DRAMA_VISIBILITY` (default `coming_soon`) decides how a drama without
  a playable episode appears publicly. A per-drama `visibility = 'hidden'` is
  always the stricter rule.
- `src/modules/content/public-dramas.shared.ts` (new): the shared rule, used
  by the catalogue, the public API, and the detail view.
- `src/modules/content/public-dramas.ts`: the SQL mirror states the positive
  condition — `(dramas.visibility is distinct from 'hidden')` — instead of
  negating the hidden test. A negated comparison is NULL for a NULL column,
  and a NULL predicate silently drops the row from the catalogue.

### feat: implement similar-drama management (Prompt 071)

- `src/modules/content/similar-dramas.shared.ts` (new): the pure relevance
  rules. Shared categories score 3, shared platforms 2, a matching status 1,
  and a matching structure type 1. A candidate that shares nothing is not
  offered, and a drama never recommends itself.
- `src/workflows/admin/similar-dramas.ts` (new): the manual workflow —
  add, remove, replace, and reorder recommendations. Duplicate
  recommendations are refused.
- `src/app/admin/api/similar-dramas/{route,candidates,suggestions,reorder}`:
  the REST surface, including the read-only scored suggestions.
- `src/components/admin/dramas/similar-drama-manager.tsx`: the admin surface.
  Automatic suggestions are a review aid and are never persisted by
  themselves.

### feat: implement the content Trash, restoration, permanent deletion, and retention (Prompts 072–074)

- `src/workflows/admin/trash.ts` (new): the cross-content Trash read model,
  with a tolerant query parser, the content types the actor may manage, and
  the projected expiry date of every trashed row.
- `src/workflows/admin/restore.ts` (new): restoration that is the exact
  inverse of the Trash cascade. A drama restores only the seasons and
  episodes whose `deleted_at` equals the drama's own; a child trashed
  separately stays in the Trash. A child whose parent is still trashed cannot
  be restored.
- `src/workflows/admin/permanent-delete.ts` (new): Super-Admin-only permanent
  deletion, with an impact preview, a bulk form, and the approved retention
  rules — personal records are removed, ratings and reviews are retained in
  anonymized form (`user_id = NULL`, target `NULL`, `anonymized_at = now()`),
  and a drama that was converted into a movie is refused because the movie
  keeps permanent provenance.
- `drizzle/0011_anonymized_ratings_and_reviews.sql` (new): makes
  `ratings.user_id` / `reviews.user_id` nullable, adds `anonymized_at`, and
  relaxes `ck_ratings_target` / `ck_reviews_target` so that only an
  anonymized row may have no content target.
- `scripts/trash-cleanup.mjs` (new): the bounded, short-lived expiry
  command. It runs in batches, supports a dry run, skips a parent whose
  children have not expired, and writes one JSON object per line for
  `journald`.
- `systemd/dramascan-trash-cleanup.{service,timer}`: the systemd trigger for
  the command. There is no worker, no queue, and no scheduler inside the
  application.
- `src/app/admin/trash/page.tsx` (new),
  `src/components/admin/trash/trash-manager.tsx` (new), and the
  `/admin/api/trash/*` routes: the Trash surface.

### feat: implement image asset storage, upload, and direct delivery (Prompts 075–078)

- `src/platform/media/storage.ts` (new): stores the uploaded original
  byte-for-byte under `IMAGE_STORAGE_DIR` (default `storage/images`) as
  `{kind}/{uuid}.{ext}`. There is no Sharp, no resizing, and no conversion.
  The server validates the MIME type, the file signature, the size (5 MB), and
  the pixel dimensions; a poster must be portrait and a banner must be
  landscape.
- `src/lib/contracts/media.ts` (new): the client-safe media contract, the
  managed filename pattern, and the allowed image types.
- `src/app/admin/api/media/route.ts` (new): `POST /admin/api/media`, a
  multipart upload guarded by `drama.manage` / `movie.manage` and the
  same-origin rule.
- `src/app/media/[...path]/route.ts` (new): direct delivery of the stored
  original with the file's own content type and
  `Cache-Control: public, max-age=31536000, immutable`. The route accepts
  only the managed path shape, so it cannot be used to read application source
  or any other filesystem path.
- `src/components/admin/media/image-upload-field.tsx` (new): the upload
  control used by the drama and movie forms.
- `systemd/dramascan-image-delivery.service`: the static-delivery unit.

### chore: remove the Odysee/LBRY assumptions from the initial implementation (Prompt 079)

- The codebase, the configuration, and the documentation contain no Odysee or
  LBRY client, SDK, credential, claim id, upload endpoint, URL resolver, or
  provider-specific model. The platform uses a public, direct HTTPS MP4 URL
  that the browser plays directly.

### fix: make the end-to-end suite deterministic

- `tests/e2e/support/stale-fixtures.mjs` (new) removes the fixture rows an
  interrupted earlier run left behind. The sweep runs after the global setup
  has proven that the target is the dedicated `_test` database, and it only
  matches the `e2e-` fixture prefix, so it can only ever remove rows this
  suite created.
- `tests/global-setup.ts` removes the leftover fixture users before the
  integration suite. An active Super Admin left behind by an interrupted run
  silently breaks the global "last active Super Admin" guard.

### fix: repair the defects found while implementing the prompts above

- `src/lib/contracts/media.ts`: the credential-free URL refinement no longer
  throws on a malformed URL. Zod runs a refinement even after the URL format
  check has failed, so the parse is repeated defensively inside a `try`.
- `scripts/trash-cleanup.mjs`: the file contained TypeScript-only syntax in a
  `.mjs` module and could never run under Node. It is now plain JavaScript.
- `src/platform/config/schema.ts` and `src/platform/media/storage.ts`: the
  runtime image directory carries a Turbopack trace hint, so the build no
  longer copies the whole project into the output for it.

### fix: close the findings of the Prompts 068–079 implementation review

The implementation was reviewed on two axes — the repository's documented
standards, and the prompt specification. Every confirmed finding is fixed
here.

**Trash and expiry**

- `scripts/trash-cleanup.mjs`: each candidate is now removed in its own
  transaction. The row is locked with `FOR UPDATE`, `deleted_at` is re-checked
  under that lock, and the whole hierarchy is removed in that one transaction,
  so a restoration that races the expiry is never overwritten. A candidate
  whose drama is the source of an existing movie is skipped instead of
  failing on the foreign key.
- `scripts/trash-cleanup.mjs`: the cleanup-order table was singular where the
  loop expected a plural, so the command removed nothing. Both tables are
  correct now, and `tests/unit/scripts/trash-cleanup.test.ts` covers the
  mapping.
- `src/workflows/admin/permanent-delete.ts`: the target row is locked and its
  Trash state is re-checked before the delete, the `deleted_at` guard is
  applied to every level of the hierarchy, and a bulk deletion reports a
  failed item instead of rejecting the whole batch.
- `src/workflows/admin/restore.ts`: a hierarchy conflict (slug, episode
  number, or season position) is detected before anything is written, so a
  refused restoration leaves no partial state.
- `src/workflows/admin/dramas.ts`: an episode whose parent is already trashed
  cannot be trashed a second time.

**Anonymization**

- `drizzle/0012_anonymized_rows_have_no_author.sql` (new): adds
  `ck_ratings_anonymized_author` and `ck_reviews_anonymized_author`
  (`anonymized_at IS NULL OR user_id IS NULL`), so an anonymized rating or
  review can never keep its author. Migration `0011` made the author
  nullable; this migration closes the gap where an anonymized row could still
  name one. `tests/integration/db/integrity-constraints.integration.test.ts`
  proves that the database rejects the invalid row.

**Database access**

- `src/workflows/admin/trash.ts`: the merged Trash listing is one
  `UNION ALL` query that applies the search filter, the ordering, and the page
  window in the database, instead of loading every trashed row of every type
  into the process. The Trash date is projected as epoch milliseconds, because
  a raw query has no column metadata and the driver would otherwise hand the
  timestamp back as an unparsed string.
- `src/workflows/admin/{permanent-delete,restore}.ts`,
  `src/modules/{users,analytics,reviews,notifications}/content-ownership.ts`,
  and `src/workflows/admin/movie-conversion.ts`: a transaction is bound to one
  PostgreSQL connection, so the queries inside a transaction now run one after
  the other. The driver deprecated concurrent queries on one connection
  (`Calling client.query() when the client is already executing a query`) and
  removes them in pg 9. The rule is enforced by
  `tests/unit/architecture/transaction-single-connection.test.ts` and
  `tests/unit/modules/content-ownership-single-connection.test.ts`.

**Image storage**

- `src/platform/config/schema.ts`: `IMAGE_STORAGE_DIR` is platform-aware. The
  default is `/var/lib/dramascan/images` in production on Linux — the systemd
  state directory of the `dramascan` service — and `<cwd>/storage/images`
  elsewhere. A production value inside the application directory is rejected
  at startup, because a deployment replaces that directory and would delete
  the artwork stored inside it.
- `systemd/dramascan-trash-cleanup.service`: declares
  `StateDirectory=dramascan`, so the state directory exists with the right
  ownership before the command runs.

**Module boundaries**

- `src/lib/contracts/trash.ts` (new) and
  `src/lib/contracts/similar-dramas.ts` (new): the client-safe DTOs and
  request schemas moved out of the workflows that own the data access, so the
  admin components no longer import a workflow or a module-private file.
- `src/app/admin/api/trash/route.ts`: `meta` carries the pagination only; the
  collection is no longer repeated inside `meta`.
- `src/app/admin/api/trash/restore/route.ts`: uses the shared request schema
  instead of a module-private validation.
- `src/workflows/admin/similar-dramas.ts`: a reorder that names a subset of
  the stored recommendations keeps the unmentioned ones in place.
- `src/workflows/admin/dramas.ts`: the catalogue description is returned to
  the admin surface.
- `src/workflows/admin/media.ts` (new): the upload workflow was moved out of
  the route, so the route is a thin adapter like every other admin route.
- `src/components/admin/media/video-source-preview.tsx` (new): the browser
  playback preview is shared by the episode and movie forms instead of being
  duplicated.

### chore: remove committed development artifacts

- `integration-output.txt`, `test-out.txt`, `test-output.txt`,
  `scripts/upload-image.mjs`, and `src/scripts/upload-image.d.ts` were
  committed by mistake and are deleted.

## [Unreleased] - 2026-11-18

### feat: add admin category, platform, season and episode management (Task 8)

Resolves the last gap that kept a first playable drama from being created
through the admin panel without SQL. Categories and platforms now have a real
admin management surface (create, edit, soft delete, reorder), and seasons and
episodes are manageable on `/admin/dramas/[id]` (create, edit, soft delete, and
for seasons reorder). No new dependency, no migration, no taxonomy REST route.

- `src/app/admin/categories/page.tsx`, `src/app/admin/platforms/page.tsx`:
  manage the two taxonomy kinds through the shared taxonomy manager, gated on
  `category.manage`/`platform.manage`.
- `src/components/admin/taxonomy/taxonomy-manager.tsx`: shared client island
  for categories (with `visibility`) and platforms; create/edit/soft-delete
  forms, Move up/down reorder, and per-row used-by counts.
- `src/lib/contracts/taxonomy-form.ts` (new): client-safe Zod contracts for
  taxonomy create/edit/delete/reorder. Slugs are derived from names and never
  typed; a name with no Latin letters is rejected.
- `src/workflows/admin/taxonomy.ts` (new) and `src/workflows/admin/taxonomy-actions.ts`
  (new): actor-first taxonomy workflows and Server Actions that re-check
  `category.manage`/`platform.manage` and re-validate every payload.
- `src/app/admin/dramas/[id]/page.tsx`: drama detail page requiring
  `drama.manage`, rendering the season and episode managers; both sections are
  additionally gated on `season.manage`/`episode.manage`.
- `src/components/admin/dramas/season-manager.tsx` (new) and
  `src/components/admin/dramas/episode-manager.tsx` (new): season and episode
  management with create/edit/soft-delete forms and Move up/down reorder.
- `src/workflows/admin/seasons.ts`, `src/workflows/admin/episodes.ts` (new):
  actor-first season and episode workflows with locked numbering/position
  allocation and drama-wide episode numbering.
- `src/workflows/admin/season-actions.ts`, `src/workflows/admin/episode-actions.ts`
  (new): Server Actions re-checking `season.manage`/`episode.manage` and
  re-validating every payload through the contract schemas.
- `src/lib/contracts/season-form.ts`, `src/lib/contracts/episode-form.ts` (new):
  client-safe Zod contracts. Blank optional fields (`season_id`,
  `episode_number`) are normalized to `undefined` via `blankToUndefined`, so the
  client `zodResolver` and the server `parseOrThrow` agree that blank means
  unset.
- `src/components/admin/dramas/season-manager.tsx` and
  `src/components/admin/dramas/episode-manager.tsx`: create-form `defaultValues`
  seed `dramaId`, so the client validation no longer drops it and the create
  Server Action actually fires.
- `tests/e2e/admin-content-management.spec.ts` (new): Chromium end-to-end test
  that creates a platform, a category, a drama, a season, and an episode through
  the panel and verifies each appears in its listing.
- `tests/e2e/support/drama-fixture.mjs`: `removeDramaBySlug` now deletes an
  episode/season/snapshot before the drama (FK-safe), matching `removeDrama`;
  exports `removeTaxonomyBySlug`.

### feat: complete the admin drama creation form (Prompt 053)

Prompt 053's backend (`createDrama`, `POST /admin/api/dramas`) already existed,
but the administrator had no way to create a drama from the admin panel. This
change adds the missing form without altering the workflow or the API contract.

- `src/lib/contracts/drama-form.ts` (new): client-safe Zod schema mirroring
  `createDramaSchema`, with the Ongoing/Completed status and both
  `season_based`/`flat` structures. Media fields accept an empty string, which
  the Server Action normalizes to `null`; no release-year field exists.
- The administrator never types a slug: `dramaSlugFromTitle` lowercases the
  title, strips diacritics and punctuation, collapses separators, and caps the
  result at 100 characters. The form has no slug input; the Server Action
  re-derives the slug from the validated title and rejects a client-supplied
  one. A title with no Latin characters is rejected with a Title error.
- `src/workflows/admin/dramas.ts`: `listDramaTaxonomy` reads the live categories
  and platforms for the checkbox groups, ordered by position then name and
  excluding trashed rows.
- `src/workflows/admin/drama-actions.ts` (new): `createDramaAction` resolves the
  actor, re-checks `drama.manage`, validates and normalizes the payload, and
  delegates to `createDrama`. The duplicate-slug conflict keeps its
  `validation_error` code and is remapped onto the Title field, where the form
  can show it, instead of becoming a 500.
- `src/components/admin/dramas/drama-create-form.tsx` (new) and
  `src/app/admin/dramas/new/page.tsx` (new): the admin form, gated by
  `drama.manage`, with select fields for status/structure and checkbox groups
  for categories/platforms. A successful save returns to the drama list.
- `src/app/admin/dramas/page.tsx`: an "Add drama" link to the new page.
- Tests: contract schema, Server Action, page guard, form submission, an
  integration test for taxonomy reads, and a Chromium end-to-end test that
  creates a flat drama and proves a duplicate slug is rejected.

## [Unreleased] - 2026-11-17

### feat: enforce database integrity, typed targets, and preview-bound conversion (Phase 4)

Resolves H-04, H-05, H-06, H-07, H-08, H-09, M-01, M-02, M-07, M-08,
SCOPE-D01, SUP-01, and TEST-03.

- `drizzle/0009_content_integrity_and_typed_targets.sql` (new): forward-only
  migration that makes the database enforce the hierarchy the schema assumed.
  `seasons.drama_id` and `episodes.drama_id` reference `dramas.id`; the
  composite `episodes(drama_id, season_id)` references `seasons(drama_id, id)`,
  so an episode can no longer name a season of another drama. Content
  references are `ON DELETE RESTRICT`. Taxonomy and similar-drama endpoints get
  foreign keys and indexes, active drama-scoped episode numbers and season
  positions get partial unique indexes, `ck_ratings_value_range` bounds a
  rating to 1-5, reactions and reports get foreign keys and partial uniqueness,
  `review_reports` gets an `active`/`resolved` lifecycle, the four user-content
  tables get typed `drama_id`/`movie_id` targets with exactly-one checks and
  per-user/per-target uniqueness, and `published_at` is added to `dramas`,
  `seasons`, `episodes`, and `movies`.
- `drizzle/0010_typed_analytics_targets_and_report_state.sql` (new): forward
  migration extending `0009`. The three analytics tables get typed
  `drama_id`/`movie_id` targets — the two event tables name exactly one content
  item, the daily aggregate may be site-wide and therefore name none, but never
  both. `review_reports` gains `description`, `resolved_by`,
  `resolution_outcome`, and `reported_at` with a lifecycle CHECK, and its
  reference to `reviews` becomes `ON DELETE RESTRICT` so moderation history
  survives the removal of a review. `reported_at` is added as a nullable column
  and only afterwards given `DEFAULT now()`, so legacy reports keep an empty
  submission time instead of a fabricated one.
- Both migrations land in the `NOT VALID` posture: foreign keys and CHECK
  constraints are verified for every new or updated row while tolerating
  pre-existing rows, and the unique indexes are created in guarded blocks. A
  migration therefore always lands on a populated database. Because a
  `NOT VALID` CHECK is still enforced on new writes, the migration and the
  release that writes the typed columns ship together; the previous release
  keeps reading the schema but can no longer write to it.
- `scripts/data-integrity.mjs` (new, `npm run db:integrity`): the operator
  command. `report` is read-only and lists every row the new constraints cannot
  accept yet, grouped by problem; `backfill` gives the seven typed tables their
  typed target, but only where the legacy type names a table, the id exists
  there, and the id does not also exist in the other table — every other row is
  listed for a human decision and never guessed; `validate` validates the
  `NOT VALID` constraints and retries the skipped unique indexes, exiting
  non-zero on any failure. The backfill runs in bounded, idempotent batches of
  500 rows, one transaction per batch, and a row it must not place is left
  untouched and reported (`target-already-typed`, `duplicate-legacy-row`,
  `missing-user`, `missing-episode`) instead of aborting the run. The report
  prints every offending row and adds a `foreign-key-orphans` section that
  covers every foreign key added by `0009`/`0010` outside the content
  hierarchy.
- `docs/development/DATA_INTEGRITY.md` (new): the operator runbook - what the
  database now enforces, what it deliberately does not enforce yet, and how to
  reconcile the difference without discarding data.
- `src/workflows/admin/dramas.ts`: `createDrama` and `updateDrama` replace
  both association sets in one transaction under a drama row lock, collapse
  duplicate ids, reject unknown targets, and roll back a partial replacement.
- `src/workflows/admin/seasons.ts`: `deleteSeason` trashes the season and its
  active episodes in one transaction, keeps `season_id` intact so the hierarchy
  can be restored, and reports the accurate affected count. `updateSeason`
  resolves the parent drama of the stored season and excludes that season
  itself from the position conflict check.
- `src/workflows/admin/episodes.ts`: `updateEpisode` resolves the parent drama
  from the stored episode and validates the season and the drama-scoped episode
  number against it.
- Every season, episode, and drama writer locks the parent drama row
  `FOR NO KEY UPDATE` before allocating a number or position, duplicate ids are
  rejected, and a renumbering rewrite is two-phase (`NULL` first) so the
  unique index cannot be violated halfway through. Episode numbering is
  drama-wide: Season 2 continues after Season 1, and moving an episode between
  seasons never renumbers it.
- `src/workflows/admin/dramas.ts` and `src/workflows/admin/episodes.ts`: the
  title/slug and title/number search alternatives are grouped in an explicit
  `or(...)` inside the parent `and(...)`, so a search term can no longer escape
  the active, published, and parent predicates. Every admin list query orders
  by the sort column and then the row id, so pagination has a unique final
  tiebreaker.
- `src/modules/users/content-ownership.ts` and
  `src/modules/analytics/content-ownership.ts` (new): the drama → movie
  conversion moves the typed target, not just the legacy pair. The typed target
  is authoritative; a row without any typed target falls back to the legacy
  pair, and a row is counted once. When two rows of one user would end up on the
  same target they are merged first: bookmarks keep one row per user; playback
  progress keeps the resume point of the most recently watched row and is
  complete when any merged row was complete; watched state keeps the most
  watched minutes, is complete when any merged row met the threshold, and
  carries the earliest completion and the latest reset; watch history stays
  append-only and keeps its episode id. Daily aggregates of one date are
  merged — every row of that date, including several rows of the target: the
  counters add up and the visitor count takes the larger value, because the
  overlap between two rows is unknown.
- `src/workflows/admin/publication.ts`: `published_at` records the first
  successful publication and is never rewritten, so an ordinary edit, an
  unpublish, and a later republication all preserve the original instant.
  Existing published rows keep `NULL` — no date is invented — and the Recently
  Added listing, which is built in Phase 8, orders by
  `published_at DESC NULLS LAST, created_at DESC`.
- `src/modules/content/conversion.ts`, `src/workflows/admin/conversion.ts`, and
  `src/app/admin/api/dramas/convert/route.ts`: the preview returns a
  `planDigest` over the whole plan — target structure, strategy, seasons,
  episode assignments, numbers, positions, and the source fingerprint — and an
  apply request must carry that digest. The server rebuilds the plan from the
  locked state and rejects a mismatch with a conflict, so an edited
  distribution can no longer be applied behind the administrator's back. The
  fingerprint alone proved only that the source had not changed.
- `src/components/admin/dramas/drama-conversion-panel.tsx`: the admin panel
  disables editing while a preview is pending and echoes the digest back.
  Removing a season that owns episodes asks for confirmation first and names
  the episodes that move, so no episode is reassigned behind the
  administrator's back.
- `tests/integration/db/migration-populated.integration.test.ts` (new): rebuilds
  the pre-Phase 4 schema in a disposable schema, fills it with the shapes the
  migrations must tolerate (duplicate active slug, duplicate episode number,
  duplicate season position, orphan season, cross-parent episode, out-of-range
  rating, duplicate reaction, duplicate active report, ambiguous and
  unresolvable legacy targets, legacy analytics rows, legacy review reports),
  then applies `0009` and `0010` and asserts the whole posture: every legacy
  row survives, `published_at` stays `null`, the constraints are `NOT VALID`
  while new writes are rejected, only the unambiguous rows are backfilled, and
  a second backfill updates zero rows.
- `tests/integration/db/integrity-constraints.integration.test.ts` (new): 51
  SQLSTATE assertions on real inserts, proving the guarantees from the
  application side rather than through the workflow layer.
- `tests/integration/content/seasons.integration.test.ts` and
  `tests/integration/content/episodes.integration.test.ts` (new): the season and
  episode persistence rules — parent scope, numbering, positions, reorder, move,
  rollback, and concurrency.
- `tests/integration/content/movie-conversion.integration.test.ts`: extended
  with the typed-target move and merge coverage, including the legacy-only
  bookmark row that cannot be written after the migration.
- `tests/integration/content/conversion-api.integration.test.ts`: an apply
  without a plan digest is rejected with `400`.
- `docs/decisions/DECISIONS.md`: D-032 records the Phase 4 decisions —
  database-enforced integrity, the `NOT VALID` posture, the typed-target scope
  (users and analytics), the unambiguous-only backfill, the conversion merge
  rules, the first-publication policy, the preview-bound apply, the full report
  state, and the `ON DELETE RESTRICT` report history.

#### Phase 4 review fix pass

A fresh-context review of the change set found ten defects across the standards
and spec axes; each fix was driven by a test that failed first.

- Episode renumbering is drama-wide. A season-scoped renumber request is
  rejected with a validation error instead of silently renumbering the whole
  drama, and the rewrite order follows season position and then episode
  position (`src/workflows/admin/episodes.ts`).
- `updateSeason` locks the parent drama row before the season row and before
  the position conflict check (`src/workflows/admin/seasons.ts`).
- The daily-aggregate merge now merges every row of a date, including several
  rows of the target, so the counters of that day are not split
  (`src/modules/analytics/content-ownership.ts`).
- The conversion panel asks before the episodes of a removed season are
  reassigned, and the distribution editor is frozen while a preview or an apply
  is in flight (`src/components/admin/dramas/drama-conversion-panel.tsx`).
- The operator command runs the backfill in bounded, idempotent batches of 500
  rows, leaves a row it must not place untouched instead of aborting the run,
  prints every offending row without truncation, and reports the foreign-key
  orphans outside the content hierarchy (`scripts/data-integrity.mjs`).
- The slug-reuse test now cleans up the row it creates, so the integration
  suite leaves no residue in the test database
  (`tests/integration/db/integrity-constraints.integration.test.ts`).

## [Unreleased] - 2026-11-16

### feat: implement authorization and user administration (Phase 3)

Resolves H-03, H-18, SCOPE-A06, and TEST-07.

- `src/modules/authorization/roles.ts` (new): real persistence for `roles`,
  `permissions`, and `user_roles`. Roles are created, renamed, and deleted; the
  granted permission set is replaced atomically, so a revoked permission keeps
  its row with `granted = false`; role assignments are added and removed. A
  role that still has assignments cannot be deleted.
- `src/modules/authorization/validation.ts` (new): strict Zod contracts for
  every role, permission, and assignment payload. Role names are lowercase
  snake_case, and `super_admin` is reserved: Super Admin is the authoritative
  `is_super_admin` flag, not a role grant.
- `src/modules/auth/repository.ts`: added `getUserAccount` and
  `setUserAccountActive`. The last active Super Admin cannot be deactivated;
  the invariant is enforced inside a transaction that locks the active Super
  Admin rows `FOR UPDATE` in a stable order, so it holds under concurrency.
- `src/workflows/admin/roles.ts` and `src/workflows/admin/users.ts`: rewritten
  as actor-first workflows. The caller resolves the actor server-side and
  passes it as the first argument, and the workflow re-checks the guard.
  Role/permission management and role assignment are Super Admin only;
  reading one account's assignments keeps `admin.manage`; account status keeps
  `admin.manage`, but a Super Admin account can only be changed by a Super
  Admin.
- `src/app/admin/api/roles/**` and `src/app/admin/api/users/[id]/**` (new):
  method-correct REST. `GET/POST /admin/api/roles`,
  `PATCH/DELETE /admin/api/roles/[id]`,
  `PUT /admin/api/roles/[id]/permissions`,
  `GET/POST /admin/api/users/[id]/roles`,
  `DELETE /admin/api/users/[id]/roles/[roleId]`, and
  `POST /admin/api/users/[id]/status`. The former `?action=` dispatchers,
  including `GET /admin/api/users`, are removed: no state-changing `GET`
  remains. The shared route helpers live in `src/platform/Http/admin-route.ts`.
- `src/app/admin/roles/page.tsx` and `src/components/admin/roles/role-manager.tsx`
  (new): a real Super-Admin-only role and permission console that creates,
  renames, and deletes roles and replaces a role's granted permission set from
  the canonical catalog. Every other actor gets `notFound()`.
- `src/app/admin/users/page.tsx` and
  `src/components/admin/users/user-management-controls.tsx`: the listing shows
  each account's role assignments and offers the role and account-status
  controls. The role checkbox applies its change locally first and rolls it
  back when the request is refused, so it answers the click at once and never
  claims a change that did not happen.
- `src/modules/users/read-models/admin-users.ts`: the listing is enriched with
  role assignments read for the whole page in one query.
- `drizzle/0008_freezing_shockwave.sql`: forward-only migration that drops the
  old permission `CHECK`, renames the stored resource to `similar_drama`, and
  re-adds the check. It also sets the `dramas.visibility` default to
  `coming_soon`, which the initial migration omitted. The column itself already
  existed as a nullable `text`; existing `NULL` values are preserved, not
  rewritten, and the public predicate already treats them as "not hidden".
- The permission catalog key is now `similar_drama.manage` everywhere: code,
  tests, navigation, and the database constraint.
- `src/workflows/admin/roles.ts` and `src/workflows/admin/users.ts` no longer
  carry the `'use server'` directive. The directive registers every export as an
  RPC endpoint whose arguments arrive from the request body, so an actor-first
  workflow would have let a caller assert `isSuperAdmin: true`.
  `tests/unit/architecture/server-action-actor-boundary.test.ts` fails if any
  `src/workflows` Server Action module references `ActorContext`.
- `src/platform/db/errors.ts` (new): `isUniqueViolation` walks Drizzle's `cause`
  chain, so a duplicate role name in a race answers `409` instead of `500`.
- `setRolePermissions` locks the role row `FOR UPDATE` before reading its
  permission rows, so concurrent full replacements serialize instead of merging
  into a union.
- `GET /admin/api/users/[id]/roles` and `POST /admin/api/users/[id]/status`
  validate the path id, so a malformed id answers `400` instead of surfacing a
  PostgreSQL `uuid` syntax error as `500`.
- `tests/integration/authorization/login-monitoring.integration.test.ts`: the
  "outside the window" assertion no longer races. It used a zero-minute window
  read in the same millisecond as the insert, which counted the fresh attempt
  because `created_at` has microsecond precision while `Date.now()` truncates
  to milliseconds. The exclusion is now proven against an attempt that is
  explicitly 60 minutes old. The production window semantics are unchanged -
  H-15 owns the lockout-window correction.

Verification: typecheck PASS, lint PASS, unit 673/673, integration 334/334,
Playwright 41/41, production build PASS.

Not covered here: deactivation blocks access immediately because the actor
resolver reads `is_active` from the database on every request, but existing
sessions are not revoked - that is Phase 6 scope.

### fix: make the public drama catalogue availability-aware (Phase 2)

Resolves C-02, M-03, M-04, and TEST-05.

- `src/modules/content/public-dramas.ts` (new): one hierarchy-aware public query
  service owns every public drama visibility decision. A drama is discoverable
  only when it is published, not in Trash, and either its visibility is not
  `hidden` or a playable episode exists. A playable episode is published, not in
  Trash, has a source, and - for season-based dramas - sits under a published,
  non-deleted season. The predicate is applied in SQL, so page contents and
  totals cannot disagree, and ordering is title plus row id for deterministic
  pagination.
- `src/modules/content/public-dramas.shared.ts` (new): pure rules and the wire
  contract. The query schema accepts only `page` (1-1,000,000) and `pageSize`
  (1-100) and discards every other key, so `publication_status`, `visibility`,
  and unknown parameters cannot widen the result. The public DTO is explicit
  camelCase and never carries raw rows, publication state, or source URLs.
- `src/app/public/api/dramas/route.ts`: rewritten as HTTP adaptation over the
  service. `{ data, meta }` envelope, `X-Request-Id`, `Cache-Control: no-store`,
  and 400 for an out-of-contract page or page size.
- `src/app/(public)/drama/page.tsx`: calls the public query service directly.
  The Phase 1 absolute self-fetch and its `force-dynamic` workaround are gone,
  cards use the canonical `/drama/{id}/{slug}` route, the nested `href="#"`
  anchor is removed, and a bounded Previous/Next pagination control was added.
- `tests/unit/modules/content/public-dramas.test.ts` (new): 30 cases for the
  discovery rules, query bounds, canonical href, and the exact DTO key set.
- `tests/integration/content/public-dramas.integration.test.ts` (new): 27
  anonymous PostgreSQL tests covering published, draft, unpublished, trashed,
  coming-soon, hidden, unpublished-season, trashed-season, trashed-episode,
  missing-source, and orphan-episode states, plus crafted filters, DTO shape,
  pagination bounds, and the unique tiebreaker.
- `tests/e2e/public-drama-catalogue.spec.ts` (new): 4 browser tests for the
  canonical card href, the absence of nested interactive elements, the
  hidden-drama reveal, crafted query parameters on the page and the API, and
  pagination bounds. `tests/e2e/support/drama-fixture.mjs` can now seed
  publication status and visibility while keeping its previous defaults.

Verification: typecheck PASS, lint PASS, unit 675/675, integration 242/242,
Playwright 38/38, production build PASS.

Not covered here: the canonical `/drama/{id}/{slug}` detail route lands in
Phase 8, and server-side proof that a source is browser-playable lands in
Phase 7.

### fix: restore admin and public application availability (Phase 1)

Resolves C-01, H-01, H-02, M-05, M-06, TEST-02, TEST-08, SCOPE-A07, and the
missing-parent half of M-09. H-16 is corrected only for the similar-drama
routes; the drama and episode delete handlers remain invalid until Phase 5.

- `src/components/admin/navigation.ts`: removed the sidebar entry whose href was
  the literal `/admin/dramas/[id]/similar-dramas`, which crashed every admin
  page; Movies and Episodes are marked unimplemented until their pages exist;
  added `ADMIN_DRILLDOWN_PERMISSIONS` so implemented drill-down pages still grant
  admin-area access without a static sidebar destination.
- `src/app/admin/dramas/page.tsx`: each row links to its similar-drama manager
  only when the actor holds `similar_drama.manage`.
- `src/workflows/admin/similar-dramas.ts`: rebuilt contracts. Page and count
  share one joined scope, soft-deleted targets are excluded, search escapes LIKE
  metacharacters, missing parents raise `NotFoundError`, and add/update/reorder
  run in transactions with typed `ConflictError`/`ValidationError`/`NotFoundError`.
  Added candidate search, atomic reorder, page loading, and table-query parsing.
- `src/app/admin/api/similar-dramas/**`: standard envelopes, same-origin checks
  on mutations, malformed JSON mapped to 400, bodyless 204 delete, plus new
  `/candidates` and `/reorder` routes.
- `src/app/admin/dramas/[id]/similar-dramas/page.tsx`: Server Component that
  awaits `params`, enforces the drill-down permission, maps not-found, and
  delegates interaction to `SimilarDramaManager`.
- `src/components/admin/dramas/similar-drama-manager.tsx` (new): add, remove,
  ordered reorder, candidate search, loading/empty/error/retry states.
- `src/components/dialogs/confirmation-dialog.tsx`: confirmation no longer
  closes itself; a failed attempt stays visible inside the dialog via the new
  `error` prop, and both conversion panels pass their failure message through.
- `src/app/(public)/drama/page.tsx`: temporary unblock (`force-dynamic` plus an
  absolute `${APP_URL}/public/api/dramas` self-fetch). Phase 2 replaces this with
  the public query service.
- `tests/integration/content/similar-dramas.integration.test.ts` (new): 24
  PostgreSQL contract tests for authorization, listing, count/join parity,
  search, soft deletion, pagination, add, update, reorder, and candidate search.
- `tests/e2e/admin-similar-dramas.spec.ts` (new): browser coverage for the full
  add/reorder/remove workflow with persisted order, not-found handling, and
  permission refusal. `tests/e2e/support/drama-fixture.mjs` now also deletes the
  similar-drama links its seeded dramas acquire.
- `eslint.config.js`: `no-extra-parens` ignores JSX and arrow conditionals,
  because the previous setting contradicted the repository's Prettier output and
  produced repo-wide false failures.

Verification: typecheck PASS, lint PASS, unit 645/645, integration 215/215,
Playwright 34/34, production build PASS.

### docs: establish the production remediation baseline (Phase 0)

- Added `docs/development/REMEDIATION_PLAN.md` with all 69 confirmed audit findings, severity, phase assignment, affected files, root causes, required corrections, regression tests, dependencies, implementation order, acceptance criteria, migration/data risks, and progress ledger.
- Recorded the current failing baseline: typecheck 3 errors, lint 16 errors, unit tests 636/637, integration tests 191/191, production build failure, and E2E 16 passed/15 failed.
- Preserved the three pre-existing uncommitted similar-drama and permission-catalog modifications for Phase 1 review rather than discarding or committing them as remediation.
- Linked the remediation plan from `docs/README.md` and recorded the baseline in `docs/PROJECT_STATUS.md`.

## [0.9.2] - 2026-11-15

### feat: convert a single-episode drama into a standalone movie (Prompt 067, D-030)

An administrator can now turn a drama with exactly one active episode into an
independent movie through a previewed, fingerprinted, transactional conversion.
The movie keeps the content identity and the user relationships, the source
drama is retained in Trash, and the provenance link is permanent.

- `src/modules/content/schema.ts`: `movies.converted_from_drama_id` (nullable,
  FK to `dramas.id` `ON DELETE RESTRICT`, partial unique index where not null),
  so one drama converts at most once and the source cannot be purged while the
  movie exists.
- `src/modules/reviews/schema.ts`: `ratings` and `reviews` become dual-target.
  `drama_id` is nullable, `movie_id` is added, `ck_ratings_target` /
  `ck_reviews_target` enforce exactly one target (D-020), and partial unique
  indexes plus lookup indexes cover both columns.
- `drizzle/0006_cute_kabuki.sql` (generated, then cross-module FKs appended
  manually): the schema changes above. Applied to the development and `_test`
  databases. Reversible with the inverse statements; no existing column or row
  is dropped.
- `src/modules/content/movie-conversion.ts` (new): destination plan,
  publication-state mapping, eligibility messages, and the SHA-256 fingerprint
  over the drama fields, the single episode, and the sorted association ids.
  Relationship counts and the slug-conflict lookup are deliberately excluded so
  concurrent viewing does not invalidate a preview; the slug is rechecked
  inside the apply and enforced by the unique index.
- `src/workflows/admin/movie-conversion.ts` (new): `drama.manage` on every
  entrypoint, a page context that explains ineligibility, preview, and a
  serializable apply that locks the drama and its active episodes `FOR UPDATE`,
  revalidates eligibility, verifies the fingerprint before writing, and maps
  `23505`/`40001` to `409`. The drama, seasons, and episodes are soft-deleted
  in the same transaction. A new UUID is generated for the movie; the drama
  UUID is never reused.
- Relationship migration inside that transaction:
  - `reviews` and `users` export narrow ownership services so ratings, reviews,
    bookmarks, progress, watched state, and history are rewritten by their
    owning module. `playback_progress.episode_id` and `watched_state.episode_id`
    become `NULL`; `watch_history.episode_id` is preserved as history.
  - `src/modules/notifications/content-ownership.ts` and
    `src/modules/analytics/content-ownership.ts` (new) move notifications,
    admin notifications, view events, playback events, and daily aggregates.
  - `content_slug_history`, `content_seo`, `content_assets`, categories, and
    platforms move to the movie. Only rows with `content_type = 'drama'` are
    rewritten; `NULL` types are not guessed. `similar_dramas` and
    `structure_conversion_snapshots` are untouched.
- `src/lib/contracts/drama-movie-conversion.ts` (new) and
  `src/modules/content/validation.ts`: the strict preview/apply request
  (`dramaId`, `mode`, optional SHA-256 `fingerprint`) and the shared preview,
  apply, and relationship-count DTOs.
- `src/app/admin/api/dramas/convert-to-movie/route.ts` (new): `POST` preview or
  apply, standard error envelope, same-origin enforcement, `401`/`403`/`404`/
  `409`/`400`/`500` mapping, and an internal-error log carrying `dramaId`.
- `src/workflows/admin/movie-conversion-actions.ts` (new): the Server Actions
  used by the panel; they return the same `ActionResult` shape as the other
  admin actions.
- `src/app/admin/dramas/page.tsx`: a **Convert to movie** row action rendered
  only when `activeEpisodes === 1`; the existing **Convert structure** action
  is unchanged.
- `src/app/admin/dramas/[id]/convert-to-movie/page.tsx` (new) and
  `src/components/admin/dramas/drama-movie-conversion-panel.tsx` (new):
  permission-checked page, read-only explanation when ineligible, preview of
  title, slug, description, poster, banner, categories, platforms, publication
  state, video source, source episode, and relationship counts; explicit
  destructive confirmation naming the drama and the Trash consequence;
  loading, error, conflict, and success states.
- Tests: `tests/unit/modules/content/movie-conversion.test.ts` (new),
  `tests/integration/content/movie-conversion.integration.test.ts` (new),
  `tests/integration/content/movie-conversion-api.integration.test.ts` (new),
  `tests/unit/components/drama-movie-conversion-panel.test.tsx` (new),
  `tests/unit/app/admin-drama-convert-to-movie-page.test.tsx` (new), plus new
  cases in `tests/e2e/admin-dramas.spec.ts` and video-source support in
  `tests/e2e/support/drama-fixture.mjs`. Coverage includes 0/2 episodes,
  trashed-episode exclusion, slug conflict, duplicate conversion, the
  exactly-one rating/review constraint, full relationship migration, rollback,
  authorization, and the conditional list action.
- Docs: D-030, `DATABASE.md` §8.5, `API.md` §3.11, `ARCHITECTURE.md` §7.2/§8.2,
  `admin-shell.md`, `PROJECT_STATUS.md`, and this changelog.

Verification: `npm run typecheck` PASS, `npm run lint` PASS (only the
pre-existing `MODULE_TYPELESS_PACKAGE_JSON` warning on `eslint.config.js`),
`npm run test` 58 files / 546 tests PASS, `npm run test:integration` 11 files /
152 tests PASS, `npm run test:e2e` 31 tests PASS, and `npm run build` PASS with
HTTPS `APP_URL`/`TRUSTED_ORIGINS` overrides because `.env.local` uses
`http://localhost` for local development. Migration 0006 was applied to both
the development database and `dramascan_test`.

Known limitations: conversion is one-way (no movie→drama path); there is no
full movie management UI, only the conversion surface; `drama.manage` is the
only permission required, so a Content Manager can create the movie without
`movie.manage`; OpenAPI generation and rate limiting are still not implemented;
movie recommendations are not modelled, so `similar_dramas` does not follow the
new movie; and the authenticated E2E flows use the seeded test session, not a
real Google OAuth consent.

## [0.9.1] - 2026-11-15

### fix: harden the drama structure conversion contract (Prompt 066 review pass)

Hardened Prompt 066 after a code review. The conversion itself is unchanged;
the contract around it is now explicit and enforced.

- `src/modules/content/validation.ts` + `src/workflows/admin/dramas.ts`:
  the ordinary drama update no longer writes `structure_type`. An omitted
  value preserves the stored structure, a repeated value is accepted, and a
  different value is rejected with `409` and points at the conversion
  endpoint. The structure changes only through the conversion workflow.
- `src/app/admin/api/dramas/route.ts`: the drama update maps its error codes
  to the right status — `409` for a structure conflict, `404` for a missing
  drama, `400` for anything else.
- `src/modules/content/conversion.ts`: an episode attached to a non-active
  season is treated as seasonless instead of being dropped from the flat
  sequence, the snapshot, and the fingerprint. The stored snapshot payload
  never references a season it does not contain.
- `src/workflows/admin/conversion.ts`: a corrupted stored snapshot payload is
  an internal error (`500`), logged with the drama context, instead of being
  reported as a stale-state conflict (`409`).
- `src/workflows/admin/conversion.ts` + `src/app/admin/api/dramas/convert/route.ts`
  - `src/workflows/admin/conversion-actions.ts` + `src/lib/contracts/drama-conversion.ts`:
    the apply response is the plan shape plus `applied: true`,
    `newFingerprint`, `snapshotId`, and `snapshotStatus`.
- `src/app/admin/api/dramas/_shared.ts`: a malformed JSON request body is a
  `400 validation_error` instead of a `500`.
- `src/app/admin/dramas/[id]/convert/page.tsx` + `src/workflows/admin/conversion.ts`:
  a malformed drama id in the URL is a `404`, not a `500`.
- `src/components/admin/dramas/drama-conversion-panel.tsx`: the strategy
  choice has no preselected option and the preview is refused until the
  administrator chooses one; the distribution editor is checked against the
  client-side contract before a request is sent; an applied conversion clears
  the stale preview, shows the converted structure, and refreshes the server
  component.
- `src/workflows/admin/conversion.ts`: the drama list sorts by `dramas.id` as
  a stable tiebreaker, so pagination cannot repeat or skip a row.
- `src/modules/content/schema.ts`: `structure_conversion_snapshots` is part of
  the `ContentTables`/`ContentSchema` unions.
- Tests: `tests/integration/content/dramas.integration.test.ts` (new, 4
  cases), `tests/unit/app/admin-drama-convert-page.test.tsx` (new, 3 cases),
  plus new cases in the conversion unit, integration, REST, and component
  suites — including a trigger-based rollback test that fails the conversion
  after its first write and proves the whole transaction is rolled back.
- Docs: D-029 (structure guard, orphan episodes, fingerprint-equality rule,
  corrupted snapshot, apply response shape, workflow exception), `API.md`,
  `ARCHITECTURE.md` §7.2/§8.2, and `PROJECT_STATUS.md`.

## [0.9.0] - 2026-11-15

### feat: drama structure conversion (Prompt 066, D-029)

Administrators can now move a drama between the season-based and flat episode
structures through a previewed, transactional conversion that keeps episode
identity, viewing records, and metadata intact and can be reversed from an
exact snapshot.

- `src/modules/content/conversion.ts` (new): pure domain rules — canonical
  ordering (season position → episode position → episode number → created at →
  id, with seasonless episodes last), season→flat and flat→season plan
  builders, distribution validation, the SHA-256 structure fingerprint, and
  snapshot payload build/parse. The fingerprint covers the structure only
  (season title/position/publication state and the episode
  season/number/position assignment); episode titles, descriptions,
  publication status, and video sources are excluded.
- `src/modules/content/validation.ts`: conversion request, distribution, and
  snapshot schemas. Unknown, duplicate, trashed, or foreign assignments are
  rejected, and every active episode must be assigned exactly once.
- `src/modules/content/schema.ts` + `drizzle/0005_yielding_mimic.sql` (new):
  `structure_conversion_snapshots` stores the pre-conversion season/episode
  payload, the post-conversion fingerprint, and the snapshot status
  (`available` | `restored` | `superseded`), with a partial unique index that
  allows at most one `available` snapshot per drama. Snapshots are never
  deleted.
- `src/workflows/admin/conversion.ts` (new): the conversion workflow —
  `drama.manage` authorization, the admin list/context reads, the preview, and
  the apply. The apply runs in a serializable transaction with the drama row
  locked `FOR UPDATE`, verifies the preview fingerprint, writes or supersedes
  the snapshot in the same transaction, and maps PostgreSQL `40001`/`23505` to
  `409`.
- `src/app/admin/api/dramas/convert/route.ts` (new): `POST` with
  `mode: "preview"` returns the plan and fingerprint; `mode: "apply"` requires
  that fingerprint. Unauthenticated requests return `401`, a missing
  `drama.manage` returns `403`, an invalid request returns `400`, and a stale
  fingerprint or an unrestorable snapshot returns `409`.
- `src/workflows/admin/conversion-actions.ts` (new): `previewDramaConversion`
  and `applyDramaConversion` Server Actions returning the standard
  `ActionResult` union; the admin panel calls the same workflow as the API.
- `src/lib/contracts/drama-conversion.ts` (new): the client-safe DTOs and the
  distribution schema, so `components/**` never imports the content module.
- `src/app/admin/dramas/` and `src/components/admin/dramas/drama-conversion-panel.tsx`
  (new): a minimal admin listing (`/admin/dramas`) and conversion page
  (`/admin/dramas/[id]/convert`) with preview, confirmation dialog, and a
  flat→season distribution editor. No create/edit/delete/publish controls.
- `src/components/admin/navigation.ts`: the Dramas entry now requires
  `drama.manage`, so a link is never shown to an actor the list would reject.
- Tests: `tests/unit/modules/content/conversion.test.ts` (17 cases),
  `tests/integration/content/conversion.integration.test.ts` (22 cases),
  `tests/integration/content/conversion-api.integration.test.ts` (7 cases),
  `tests/unit/components/drama-conversion-panel.test.tsx` (4 cases), and
  `tests/e2e/admin-dramas.spec.ts` (4 cases) covering ordering, renumbering,
  snapshot lifecycle, fingerprint staleness, strategy selection, authorization,
  and the browser workflow.

## [0.8.0] - 2026-11-14

### feat: standalone movie creation and editing (Prompt 065, D-028)

Added an independent movie content type with its own workflow, REST surface,
validation contracts, and integration coverage. Movies are not dramas with
hidden seasons or episodes.

- `src/modules/content/validation.ts`: added `moviePublicationStatusSchema`
  (`draft` | `published` | `unpublished`), `movieVideoSourceSchema` (absolute
  HTTPS only), `createMovieSchema`/`updateMovieSchema` (full-payload replace),
  and parse helpers. Also repaired pre-existing broken helpers
  (`parseCreateDramaInput`, `parseCreateEpisodeInput`, `parseDramaId`) and
  removed the undefined `parseListInformationPagesQuery` reference.
- `src/modules/content/schema.ts`: `movies.video_source` (nullable) and
  `uq_movies_slug_active` (partial unique index on active slugs).
- `src/workflows/admin/movies.ts` (new): `createMovie`/`updateMovie` with
  `movie.manage`, active-slug uniqueness (pre-check plus SQLSTATE 23505
  handling), category/platform existence checks, transactional association
  replacement, and `content_slug_history` on slug change. DTO fields are
  camelCase.
- `src/app/admin/api/movies/` (new): `POST` and `PUT` routes with same-origin
  protection, `{ data }` envelopes, structured errors, and request IDs.
- `src/modules/authorization/permissions.ts`: completed the season resource
  with `season.manage`; migration 0004 updates the permission check constraint.
- `drizzle/0004_redundant_carmella_unuscione.sql` (new): adds
  `dramas.structure_type`, `movies.video_source`, `uq_movies_slug_active`, and
  the updated permission constraint.
- Minimal type/lint repairs in the drama, episode, and season workflows and
  their routes (missing imports, `inArray`, ordering expressions, response
  unions, final newlines) so the project typechecks and builds. The shared
  admin form resolver and its test mocks were typed minimally for the same
  reason. The stale admin-navigation expectations were updated to match the
  implemented content entries; the Movies entry is now marked implemented at
  the API level.
- Tests: `tests/unit/modules/content/movie-validation.test.ts` (33 cases) and
  `tests/integration/content/movies.integration.test.ts` (18 cases) covering
  authorization, creation, defaults, associations, duplicate/soft-deleted
  slugs, HTTPS-only sources, full-payload updates, slug history, and the
  database-level unique index.

## [0.7.0] - 2026-11-14

### feat: Super Admin email/password sign-in (approved change, D-027)

Added a second, Super-Admin-only authentication path without changing the
public Google sign-in, and fixed the development database drift that was
blocking sign-in entirely.

- `src/platform/auth/better-auth.ts` enables `emailAndPassword` with
  `disableSignUp: true`, `requireEmailVerification: false`, and a 16-character
  minimum, plus a 5-per-60s rate limit on `/sign-in/email` in production.
  Public sign-up stays closed; only the seed writes a credential account.
- `scripts/seed-super-admin.mjs` (new, `npm run db:seed:super-admin`) upserts
  the Super Admin user and a `provider_id = 'credential'` account containing a
  Better Auth scrypt hash. Idempotent, password-resetting, advisory-locked, and
  it never prints the password or hash.
- `src/app/vault-7x9k-console/` (new) hosts the form at a non-obvious route,
  with `noindex, nofollow`; `src/app/vault-7x9k-console/page.tsx` redirects a
  signed-in Super Admin to the admin area.
- `src/workflows/auth/super-admin-credentials.ts` and
  `src/workflows/auth/super-admin-sign-in.ts` (new) validate the input and call
  `auth.api.signInEmail`. Every failure returns `Invalid email or password.`
  Credentials travel as `FormData` so Next.js's development action log does not
  serialize the password.
- `src/lib/redirects.ts` adds `ADMIN_SIGN_IN_PATH` and
  `sanitizeAdminCallback`; anonymous admin visits now redirect to
  `/vault-7x9k-console?callbackUrl=%2Fadmin` instead of `/auth/signin`.
- `drizzle.config.ts` loads `.env.local` when present. Previously `db:migrate`
  saw an empty `DATABASE_URL` and silently skipped pending migrations, leaving
  the development database without `sessions.last_activity_at` and
  `information_pages.position`; sign-in failed with a 500.
- Tests: `tests/unit/workflows/auth/super-admin-credentials.test.ts`,
  `tests/integration/auth/super-admin-seed.integration.test.ts`,
  `tests/e2e/super-admin-signin.spec.ts`, and a test-only credential seeder;
  `tests/unit/lib/redirects.test.ts`, `tests/unit/components/admin-access.test.ts`,
  and `tests/e2e/admin-access.spec.ts` were updated for the new route.
- Documentation: D-027, `SECURITY.md` §3.2/§3.3, `CONVENTIONS.md` environment
  table, `.env.example`, and the plan in
  `docs/superpowers/plans/2026-11-14-super-admin-password-login.md`.

## [0.6.0] - 2026-11-12

### feat: Reusable admin data tables and the users listing (Prompt 051)

Built the admin table kit once and proved it with a complete reference
implementation, `/admin/users`: server-side pagination, sorting, search, and
filtering with all table state in the URL, server-side authorization on the
canonical `user.read` permission, and one supporting index for the production
list query. No reviews, drama, or movie tables, no row actions, no client-side
table state, and no new dependency.

- `src/lib/contracts/table.ts` owns the shared URL contract:
  `TABLE_QUERY_PARAMS`, `DEFAULT_TABLE_PAGE_SIZE` (20),
  `MAX_TABLE_PAGE_SIZE` (100), `TABLE_PAGE_SIZE_OPTIONS` (20/50/100),
  `TableQueryState`, and the pure `buildTableHref`. It always emits `pageSize`
  and `sort`, emits `page` only beyond the first page, and emits `q` and a
  filter only when they carry a value.
- `src/components/admin/data-table/` adds `AdminDataTable` (sortable headers
  with `aria-sort`, an accessible sort-link name, and an empty state),
  `AdminTableToolbar` (search and filter GET forms, clear link),
  `AdminTablePagination` (summary, page window, page-size form),
  `AdminTableSkeleton`, and `AdminTableError`. All are Server Components; the
  kit imports no module and fetches nothing. `src/components/ui/table.tsx` lost
  its `'use client'` directive so the vendored primitive renders in a Server
  Component; it is otherwise untouched.
- `src/modules/auth/repository.ts` adds `listUserAccounts`, the paged Drizzle
  query over the auth module's own `users` table, published through
  `src/modules/auth/index.ts`. `src/modules/users/validation.ts` adds the Zod
  contract and `parseAdminUsersQuery`;
  `src/modules/users/read-models/admin-users.ts` adds `listUsersForAdmin` with
  the `user.read` guard, the query, and the DTO projection, published through
  `src/modules/users/index.ts`.
- `src/app/admin/users/{page,loading,error}.tsx` renders the listing; the
  navigation entry's `implemented` flag is now `true`.
- `drizzle/0003_needy_infant_terrible.sql` adds one partial index,
  `idx_users_active_created_at ON users (created_at DESC) WHERE deleted_at IS
NULL`, for the default scope and default sort of the listing.
- Decisions: D-026 — the URL-state contract, the 404 for a page-level permission
  failure in the admin area (an intentional exception to `CONVENTIONS.md` §6.6),
  the query-parameter normalization deviation from §6.4, the ownership split
  between `auth` and `users`, and the supporting index.
- Documentation: `docs/development/admin-data-tables.md` (new),
  `docs/development/DATABASE.md` (index, served and unserved queries, measured
  plans), `docs/development/admin-shell.md` (callback limitation),
  `docs/development/CONVENTIONS.md`, `docs/architecture/*`,
  `docs/decisions/DECISIONS.md`, `docs/README.md`, `docs/PROJECT_STATUS.md`.

### feat: Shared admin form patterns (Prompt 052)

Built the shared admin form kit: `AdminForm` shell, `AdminFormField`
labeled field with validation messaging, and `AdminFormError` server error
alert, all in `src/components/admin/forms/`. React Hook Form + Zod resolver
over domain schemas; Server Actions return `{ ok: true; data } | { ok: false;
error }` via `mapErrorToActionResult`; dirty-state `beforeunload` warning;
saving indicator via `isSubmitting`; server field errors mapped onto fields;
no new dependency beyond `react-hook-form` and `@hookform/resolvers`; no
entity-specific CRUD pages or schemas created.

- `src/components/admin/forms/admin-form-error.tsx` — presentational alert
  (`role="alert"`), default title `'Could not save'`, optional action slot.
- `src/components/admin/forms/admin-form-field.tsx` — labeled field with hint,
  error, and required `*` marker; wires `aria-invalid` and `aria-describedby`.
- `src/components/admin/forms/admin-form.tsx` — shared create/edit form shell,
  client validation via `zodResolver`, server-authoritative validation, `beforeunload`
  dirty-state warning, pending state, and server error display.

Documentation: `docs/development/admin-forms.md` (new),
`docs/README.md` (quick link), `docs/CHANGELOG.md` (this entry),
`docs/PROJECT_STATUS.md` (row), `docs/development/admin-data-tables.md`
(related-document links).

### Known limitations

- The search remains an `ILIKE` scan over `name` and `email`; no trigram index
  is added until query-plan evidence justifies one.
- The `deleted` filter is not served by the partial index: its predicate is the
  complement of the index predicate. It stays a sequential scan over the
  (small) deleted subset.
- The `CREATE INDEX` is not `CONCURRENTLY`, so applying the migration takes a
  brief write lock on `users`. The index covers `created_at DESC` only, so a
  sort step remains for tied `created_at` rows.
- `/admin/users` has no Actions column: the existing admin account routes are
  stubs, so a row control would report success without changing anything.
- An anonymous visitor to any admin route is redirected with
  `callbackUrl=%2Fadmin` rather than the deep-linked path, because a server
  layout cannot read its own pathname. This is the admin shell's existing
  behaviour and is recorded with its follow-up in `admin-shell.md`.
- On the small test database every measured plan chose a sequential scan; the
  plans in `DATABASE.md` §6.1 record the access path and estimated cost, not
  evidence that the index is chosen at today's data volume.

### Verification

- `npm run typecheck` (`next typegen && tsc --noEmit`) — exit 0.
- `npm run lint` — exit 0 (a Node module-type warning from `eslint.config.js`
  is pre-existing and unrelated).
- `npm test` — 47 files, 417 tests passed (52 new).
- `npm run test:integration` — 4 files, 53 tests passed (13 new).
- Production build through the wrapper script — exit 0. The known pre-existing
  `information_pages.position` warning appears on the main database only and
  degrades gracefully.
- `npm run test:e2e` — 19 tests passed in Chromium (7 new across
  `admin-users.spec.ts` and `admin-session.spec.ts`; `admin-access.spec.ts`
  gained the users-listing redirect case). The pre-existing
  `public-site.spec.ts › footer reaches every public route` flake (it sits on
  its 30-second timeout boundary) passed this run at 27.8s; it is unrelated to
  Prompt 051 and was not touched.

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
