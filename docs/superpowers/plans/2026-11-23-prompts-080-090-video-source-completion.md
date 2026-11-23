# Prompts 080–090 Video Source Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Prompts 080–090 so the direct-HTTPS-MP4 video workflow is real end to end: a persisted, validated, admin-previewed, transactional-replaceable source; a genuine Vidstack viewer with subtitles, manual retry, and failure visibility; and a CSP that does not break the application.

**Architecture:** The `content` module keeps ownership of `episodes.video_source` and answers the public playback lookup. A new `playback` module owns `subtitle_tracks` and `playback_failure_reports` and owns watch-page composition. The `users` module (which already owns `playback_progress` / `watched_state` / `watch_history` in code) exposes the progress reset. A new `administration` module owns `admin_audit_log` for the operational replacement record. Source replacement is one workflow and one transaction across all three owners.

**Tech Stack:** Next.js 16 App Router (React 19, `proxy.ts`), TypeScript strict, Drizzle ORM + PostgreSQL, Zod, `@vidstack/react` + `vidstack` 1.15.7, Tailwind v4, Vitest, Playwright.

**Spec:** Prompts 080–090 (session transcript) + `AGENTS.md` §1.4 / §1.3, `docs/architecture/module-architecture.md` §6.3/§6.5/§6.10, `docs/development/CONVENTIONS.md` §2.1.

## Global Constraints

- The server never fetches, proxies, relays, rehosts, uploads, transcodes, or probes a media URL. Validation is syntax/scheme/credentials/extension only.
- No video upload endpoints, staging, temp storage, multipart/resumable upload, upload progress, upload retries, upload cleanup, transcoding, workers, proxying, or rehosting. Poster/banner image uploads stay.
- Viewer route is canonical: `/drama/{dramaId}/{slug}/episode/{episodeId}`.
- `src/modules/*/index.ts` is the only cross-module import target. A module never writes another module's table.
- Server Actions resolve the actor server-side; the actor is never asserted by the client.
- Strict TypeScript; every new behavior has a test that failed first.
- Migration is forward-only and never edits an applied migration.

## Review Focus

- A published episode whose source was replaced: progress must read zero, watched state unwatched, watch history rows and their dates untouched, and one audit record written — all or nothing.
- A draft or trashed episode, or an episode under an unpublished season: the watch page must not expose the source URL.
- A subtitle URL that is `http:`, embeds credentials, or has an unsupported extension must be rejected server-side, not merely in the browser.
- A viewer-reported playback failure must reach the admin list without storing the source URL or any credential.
- The CSP must allow the app's own inline bootstrap scripts and the external media host, and must not allow `*` for media.

---

### Task 1: Baseline cleanup and compile repair

**Files:**
- Delete: `errors.txt`, `test-out.txt`, `test-output.txt`, `test-results.txt`, `test.txt`, `txt.txt`
- Delete: `src/app/(public)/drama/[dramaId]/episode/[episodeId]/page.tsx` (broken placeholder)
- Delete: `src/components/player/vidstack-player.tsx` (returns `null`)

**Interfaces:**
- Produces: a tree that compiles, so later tasks have a trustworthy baseline.

- [ ] **Step 1:** Delete the six stray `.txt` files and the two stub files.
- [ ] **Step 2:** Run `npm run typecheck` — expect PASS.
- [ ] **Step 3:** Run `npm run lint` — expect PASS.

### Task 2: Vidstack dependency, CSP nonce, and trusted media hosts

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/platform/security/csp.ts`
- Create: `src/proxy.ts`
- Modify: `next.config.ts`
- Modify: `src/platform/config/schema.ts`
- Modify: `.env.example`
- Test: `tests/unit/platform/security/csp.test.ts`

**Interfaces:**
- Produces: `buildContentSecurityPolicy(input: { nonce: string; isDevelopment: boolean; allowedMediaOrigins: readonly string[] }): string`
- Produces: `ServerConfig.allowedMediaOrigins: readonly string[]` from `MEDIA_ALLOWED_HOSTS`.
- Consumes: `NextResponse.next({ request: { headers } })` in `src/proxy.ts`.

- [ ] **Step 1:** Write `tests/unit/platform/security/csp.test.ts` asserting: no `*` in `media-src`; `script-src` carries the nonce; `media-src` contains the configured media origin; `img-src`, `style-src`, `script-src`, `media-src` are separate directives; `frame-ancestors 'none'`; `object-src 'none'`.
- [ ] **Step 2:** Run the test — expect FAIL (module missing).
- [ ] **Step 3:** Implement `src/platform/security/csp.ts` with `buildContentSecurityPolicy`.
- [ ] **Step 4:** Run the test — expect PASS.
- [ ] **Step 5:** Add `MEDIA_ALLOWED_HOSTS` to `src/platform/config/schema.ts` (comma-separated origins; unset = any `https:` origin) and to `.env.example`.
- [ ] **Step 6:** Create `src/proxy.ts` that generates a per-request nonce, sets `x-nonce` and `Content-Security-Policy` on the request and the response, and matches all document routes except static assets.
- [ ] **Step 7:** Remove the broken static CSP from `next.config.ts`; keep `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` there and document where the CSP now lives.
- [ ] **Step 8:** Run `npm run typecheck` and `npm run lint` — expect PASS.

### Task 3: Content module — public episode playback lookup

**Files:**
- Create: `src/modules/content/public-episodes.ts`
- Modify: `src/modules/content/index.ts`
- Test: `tests/unit/modules/content/public-episodes.test.ts`
- Test: `tests/integration/content/public-episodes.integration.test.ts`

**Interfaces:**
- Produces: `PublicEpisodePlayback = { id; dramaId; dramaSlug; dramaTitle; seasonId; title; description; episodeNumber; videoSource }`
- Produces: `getPublicEpisodePlayback(dramaId: string, episodeId: string): Promise<PublicEpisodePlayback | null>`

- [ ] **Step 1:** Write the unit test for the pure availability predicate `isPubliclyPlayableEpisode(input)` — published episode, published drama, not trashed, published season when the episode has one, non-empty source.
- [ ] **Step 2:** Run it — expect FAIL.
- [ ] **Step 3:** Implement the predicate and `getPublicEpisodePlayback` in `src/modules/content/public-episodes.ts`; export both from `src/modules/content/index.ts`.
- [ ] **Step 4:** Run the unit test — expect PASS.
- [ ] **Step 5:** Write the integration test: published episode returns the source; draft episode, trashed episode, unpublished drama, unpublished season, and missing source all return `null`.
- [ ] **Step 6:** Run the integration test — expect PASS.

### Task 4: Users module — episode watch-state reset

**Files:**
- Create: `src/modules/users/watch-state.ts`
- Modify: `src/modules/users/index.ts`
- Test: `tests/integration/users/episode-watch-state.integration.test.ts`

**Interfaces:**
- Produces: `resetEpisodeWatchState(episodeId: string, executor?: DbExecutor): Promise<{ progressRows: number; watchedRows: number }>`
- Produces: `src/platform/db/executor.ts` → `DbExecutor`

- [ ] **Step 1:** Create `src/platform/db/executor.ts` exporting `DbExecutor`.
- [ ] **Step 2:** Write the integration test: given progress + watched + history rows for an episode, the reset zeroes progress and watched state and leaves every history row and its `watched_at` untouched.
- [ ] **Step 3:** Run it — expect FAIL.
- [ ] **Step 4:** Implement `resetEpisodeWatchState` and export it from `src/modules/users/index.ts`.
- [ ] **Step 5:** Run it — expect PASS.

### Task 5: Administration module — admin audit log

**Files:**
- Modify: `src/modules/administration/schema.ts`
- Create: `src/modules/administration/audit-log.ts`
- Create: `src/modules/administration/index.ts`
- Create: `drizzle/0013_video_source_workflow.sql`

**Interfaces:**
- Produces: `recordAdminAuditEvent(input: { actorId: string | null; action: string; entityType: string; entityId: string; summary: string; metadata?: Record<string, unknown> }, executor?: DbExecutor): Promise<void>`
- Table: `admin_audit_log(id, actor_id, action, entity_type, entity_id, summary, metadata jsonb, created_at)`

- [ ] **Step 1:** Write the integration test asserting one audit row is written for a replacement and that the row contains **no** video source URL.
- [ ] **Step 2:** Run it — expect FAIL (table missing).
- [ ] **Step 3:** Implement the schema, the service, and the module public API.
- [ ] **Step 4:** Write the forward-only migration creating `admin_audit_log`, `subtitle_tracks`, and `playback_failure_reports` with named constraints, indexes, and cross-module foreign keys declared in SQL.
- [ ] **Step 5:** Apply the migration to the test database.
- [ ] **Step 6:** Run the integration test — expect PASS.

### Task 6: Playback module — subtitle tracks and failure reports

**Files:**
- Modify: `src/modules/playback/schema.ts`
- Create: `src/modules/playback/validation.ts`
- Create: `src/modules/playback/repository.ts`
- Create: `src/modules/playback/service.ts`
- Create: `src/modules/playback/queries.ts`
- Create: `src/modules/playback/index.ts`
- Test: `tests/unit/modules/playback/validation.test.ts`
- Test: `tests/integration/modules/playback/playback.integration.test.ts`

**Interfaces:**
- Produces: `subtitleTrackSchema`, `subtitleSourceUrlSchema`, `subtitleFormatSchema`, `playbackFailureReportSchema`
- Produces: `listSubtitleTracks(episodeId)`, `upsertSubtitleTrack(...)`, `deleteSubtitleTrack(...)`, `listPlaybackFailures(...)`, `recordPlaybackFailure(...)`, `listPublicSubtitleTracks(episodeId)`

- [ ] **Step 1:** Write the validation unit test: HTTPS-only, no credentials, supported formats `vtt|srt|ssa|ass|json`, language label required, at most one default per episode.
- [ ] **Step 2:** Run it — expect FAIL.
- [ ] **Step 3:** Implement `src/modules/playback/validation.ts` and the two tables in `src/modules/playback/schema.ts`.
- [ ] **Step 4:** Run the unit test — expect PASS.
- [ ] **Step 5:** Write the integration test: upsert creates, a second upsert for the same language replaces, a default track demotes the previous default, delete removes, and a failure report is stored with the reporter and the reason.
- [ ] **Step 6:** Implement the repository, service, queries, and public API; run the integration test — expect PASS.

### Task 7: Source replacement workflow — one transaction, three owners

**Files:**
- Modify: `src/workflows/admin/episodes.ts`
- Modify: `src/workflows/admin/episode-actions.ts`
- Modify: `src/lib/contracts/episode-form.ts`
- Test: `tests/integration/content/episode-video-source.integration.test.ts`

**Interfaces:**
- Produces: `replaceEpisodeVideoSource(actor, episodeId, newVideoSource)` — validates, rejects trashed episodes, updates the source, resets watch state, writes the audit record, all in one transaction.
- Produces: `replaceEpisodeVideoSourceAction(input)` Server Action.

- [ ] **Step 1:** Write the integration test: replacement resets progress and watched state, preserves history, writes one audit record, leaves every other episode untouched, and rolls back when the audit write fails.
- [ ] **Step 2:** Run it — expect FAIL (no transaction, no reset, no audit).
- [ ] **Step 3:** Rewrite `replaceEpisodeVideoSource` around `db.transaction`, calling the users reset and the administration audit service with the same transaction handle. Fix the invalid `.and(isNull(...))` call by using `and(eq(...), isNull(...))`.
- [ ] **Step 4:** Make `updateEpisode` refuse a changed `video_source` so the preview + confirmation path is the only way to replace a source.
- [ ] **Step 5:** Add the `replaceEpisodeVideoSourceAction` Server Action and the `replaceVideoSourceFormSchema` contract.
- [ ] **Step 6:** Run the integration test — expect PASS.

### Task 8: Admin preview hardening (Prompt 084)

**Files:**
- Modify: `src/components/admin/media/video-source-preview.tsx`
- Test: `tests/unit/components/video-source-preview.test.tsx`

**Interfaces:**
- Produces: `VideoSourcePreview` with a stable hook order, a real playback attempt, a byte-range seek check, and explicit failure copy.

- [ ] **Step 1:** Write the component test: rendering with no source, then typing a source, must not throw (today it violates the rules of hooks); a `playing` event must set the verified state; an `error` event must set the failed state with the media error code.
- [ ] **Step 2:** Run it — expect FAIL.
- [ ] **Step 3:** Rewrite the component: call every hook unconditionally, drive the status from `playing` (not `canplay`), attempt muted playback, verify a seek to 75 % of the duration, and clear every timer and listener on unmount.
- [ ] **Step 4:** Run it — expect PASS.

### Task 9: Viewer watch page with real Vidstack playback

**Files:**
- Create: `src/app/(public)/drama/[dramaId]/[slug]/episode/[episodeId]/page.tsx`
- Create: `src/components/player/vidstack-player.tsx`
- Create: `src/components/player/playback-failure-report.tsx`
- Test: `tests/unit/components/vidstack-player.test.tsx`
- Test: `tests/e2e/public-episode-playback.spec.ts`

**Interfaces:**
- Produces: `VidstackPlayer({ episodeId, title, source, subtitleTracks, onFailure })` — a client component rendering Vidstack `MediaPlayer`/`MediaProvider`/`Track` with the default layout.
- Produces: the canonical route `/drama/{dramaId}/{slug}/episode/{episodeId}`.

- [ ] **Step 1:** Write the component test: the player renders the source on the media element, passes each subtitle track, shows the manual Retry control after a media error, and never retries on its own.
- [ ] **Step 2:** Run it — expect FAIL.
- [ ] **Step 3:** Implement `src/components/player/vidstack-player.tsx` with the Vidstack default layout, subtitle tracks, a manual Retry that remounts the player with the same stored URL, and a failure report control.
- [ ] **Step 4:** Implement the Server Component route reading `getPublicEpisodePlayback` and `listPublicSubtitleTracks`; render `notFound()` when the episode is not publicly playable.
- [ ] **Step 5:** Write the E2E test: seed a published episode with a source, open the canonical route, assert the player and the episode title are present.
- [ ] **Step 6:** Run the E2E test — expect PASS.

### Task 10: Admin UI — subtitles, replacement confirmation, failure visibility

**Files:**
- Modify: `src/components/admin/dramas/episode-manager.tsx`
- Create: `src/components/admin/dramas/subtitle-track-manager.tsx`
- Create: `src/components/admin/dramas/playback-failure-list.tsx`
- Modify: `src/app/admin/dramas/[id]/page.tsx`
- Test: `tests/e2e/admin-episode-video-source.spec.ts`

**Interfaces:**
- Consumes: `upsertSubtitleTrackAction`, `deleteSubtitleTrackAction`, `replaceEpisodeVideoSourceAction`.

- [ ] **Step 1:** Write the E2E test: add a subtitle track, see it listed, delete it; change the video source on an episode and confirm the replacement only runs through the preview + confirmation path.
- [ ] **Step 2:** Run it — expect FAIL.
- [ ] **Step 3:** Implement the subtitle manager, the failure list, and the replacement flow (preview must report a verified state before the confirm button enables).
- [ ] **Step 4:** Run the E2E test — expect PASS.

### Task 11: Progress persistence

**Files:**
- Create: `src/modules/users/progress.ts` (the module that owns the progress tables)
- Create: `src/modules/content/episode-references.ts` (episode → drama reference)
- Modify: `src/modules/users/validation.ts`, `src/modules/users/index.ts`
- Modify: `src/modules/content/index.ts`
- Modify: `src/platform/config/schema.ts` (the completion threshold)
- Modify: `src/workflows/playback/actions.ts`
- Modify: `src/components/player/vidstack-player.tsx`
- Modify: `src/app/(public)/drama/[dramaId]/[slug]/episode/[episodeId]/page.tsx`
- Test: `tests/integration/users/playback-progress.integration.test.ts`

**Interfaces:**
- Produces: `savePlaybackProgress(actor, { episodeId, positionSeconds, durationSeconds, watchedAt })` writing `playback_progress` and `watched_state` for a signed-in viewer.

- [x] **Step 1:** Write the integration test: saving progress upserts one row per user and episode, never overwrites a newer position with an older one, and marks the watched state once the completion threshold is met.
- [x] **Step 2:** Run it — expect FAIL.
- [x] **Step 3:** Implement the service, the Server Action, and the debounced client call.
- [x] **Step 4:** Run it — expect PASS.

> Module placement ruling: the service lives in the `users` module because
> `playback_progress` and `watched_state` are defined in `src/modules/users/schema.ts`
> and the dependency matrix forbids `playback → users`. See the execution ledger.

### Task 12: Documentation, full verification, commit and push

**Files:**
- Modify: `docs/PROJECT_STATUS.md`, `docs/CHANGELOG.md`, `docs/decisions/DECISIONS.md`, `docs/development/DATABASE.md`, `docs/architecture/SECURITY.md`, `docs/architecture/ARCHITECTURE.md`, `docs/future/future-upgrade-backlog.md`, `docs/README.md`

- [x] **Step 1:** Update the documentation for prompts 080–090.
- [x] **Step 2:** Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, `npm run test:e2e`, `npm run build`.
- [x] **Step 3:** Review `git status` and the full diff for stray files, debug code, and secrets.
- [ ] **Step 4:** Stage only the intended files, commit `feat: complete episode video source workflow (Prompts 080-090)`, push to the current branch, and verify the push.

> Verification results (final): typecheck PASS; lint PASS; unit 973/973 PASS (94 files); integration 576/576 PASS; Playwright E2E 49/49 PASS; production build PASS; CSP runtime check PASS (per-request nonce, configured `media-src`, no CSP violation and no uncaught page error in Chromium on the production server).
>
> The E2E suite needed one harness fix to be deterministic: `tests/e2e/support/warmup.mjs` compiles every route the suite exercises before the first test runs, because a cold route compile in the development server took longer than the test timeout. The per-test timeouts were not raised.
>
> Build note: a production build evaluates the production server configuration,
> so it needs production-shaped values (`APP_URL`, `TRUSTED_ORIGINS`,
> `DATABASE_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`,
> `GOOGLE_CLIENT_SECRET`, `SUPER_ADMIN_EMAIL`). See `docs/development/ci-cd.md`.
> A plain `npm run build` in a shell that inherits a development `.env.local`
> fails closed on `APP_URL must use HTTPS` — that is the documented behaviour,
> not a regression.
