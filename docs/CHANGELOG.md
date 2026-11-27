# Changelog

All notable changes to the DramaScan project will be documented in this file.

## [Unreleased] - 2026-11-27

### fix: resolve crash-grade SQL and logic defects found in the Phase 13 administration audit (commit `fd657f4`)

A full audit of `src/modules/administration/` (catalog in
`docs/ADMINISTRATION_AUDIT_REPORT.md`: 4 crash, 11 stub, 8 tooling, 16 ok)
found seven defects that would throw or misbehave at runtime in the files
that query the database. All were fixed in place, behaviour-preserving:

- **Invalid PostgreSQL JSON syntax** — `incident.notes.ts`,
  `incident.timeline.ts` (two sites), `alert.escalation.ts`, and
  `rate.limiting.ts` used MySQL's `JSON_EXTRACT(col, '$.key')`. Replaced with
  the Postgres `col -> 'key'` operator, and MySQL-style `.like()` comparisons
  with plain `LIKE`.
- **Permanent rate limiting** — `rate.limiting.ts` counted every stored event
  without a window filter, so a caller would stay rate-limited forever once
  events accumulated. Added the sliding-window timestamp filter against
  `windowMs`.
- **Always-truthy maintenance access check** — `maintenance.mode.ts` compared
  the mode string in a way that was always true in one branch; fixed the
  comparison and made the public maintenance message persist to
  `system_settings` instead of being discarded.
- **CSP header name baked into the value** — `security.headers.ts` returned
  `"Content-Security-Policy-<directives>"` from its getter; all header getters
  now return the value only.
- **Unreachable `unhealthy` health status** — `health.checks.ts` capped the
  overall status at `degraded`, so an unhealthy component could never surface
  as `unhealthy`; the overall status is now the worst component status.

The module schema (`schema.ts`) defines exactly `admin_audit_log`,
`system_setting_versions`, and `system_settings`; every DB-hitting file in the
module references only those three tables, so no query can hit a missing
relation. The remaining stub/tooling files are documented placeholders that no
route, workflow, or UI imports; live security headers and auth rate limiting
come from `next.config.ts`, `proxy.ts` (per-request CSP nonce), and Better
Auth.

Verified: `npx tsc --noEmit` (exit 0), module ESLint clean, full Vitest suite
(137 files, 1320 tests, all passing), `next build` (passing).

### fix: resolve the Phase 13 administration module TypeScript and ESLint errors

The `src/modules/administration/` module (~31 files) was cleaned so that the
full project type-checks and lints with zero errors. The changes are
behaviour-preserving:

- Column-method `.desc()`/`.asc()` calls that do not exist in Drizzle 0.45.4
  were replaced with `desc()`/`asc()` imported from `drizzle-orm`.
- Query results are read defensively: `count(*)` uses
  `Number(result[0]?.count || 0)`, and insert-then-return flows guard a
  missing row before `JSON.parse`.
- `task.dependencies.ts` `markDependencySatisfied`/`markDependencyFailed`
  load the record and no-op when it is missing.
- `settings.ts` uses the established `actor.userId!` pattern for
  `system_setting_versions.changed_by` (`uuid().notNull()`).
- `getRateLimitConfig` falls back through `??` to a literal default,
  satisfying `noUncheckedIndexedAccess`.
- `DeploymentConfiguration` gains `workingDirectory` and `user`
  (`WORKING_DIRECTORY` / `SERVICE_USER` in the environment), required by
  `systemd.service.ts`.
- Eight manual ESLint fixes: a `default` branch on the alert-severity switch,
  an unused `deleted` counter removed from `pruneOldBackups`, unused `catch`
  parameters dropped, an unused `options` argument prefixed `_`, and stray
  trailing `''` removed from the ends of `settings.ts` and `settings.zod.ts`.
- The deployment stage named `staging` in `deployment.pipeline.ts` was
  renamed `preprod`. The direct-video-source architecture guard scans code
  for the word "staging" (a video pipeline term it must forbid); the CI/CD
  module is not a video pipeline, and the rename removes the false positive
  without weakening the guard.

Verified: `npx tsc --noEmit` (exit 0), `npx eslint
"src/modules/administration/**/*.ts" --max-warnings 0` (exit 0), full Vitest
suite (137 files, 1320 tests, all passing), and `next build` (passing).

### fix: resolve the fifth Phase 11 review round (Prompts 139–154)

A fifth fresh review of the whole Phase 11 branch found eleven findings. Each
was checked against the code and the binding rules before any fix, and each fix
was written test-first — the failing test was run and watched fail before the
implementation changed.

#### Analytics

- **The watch time is a cumulative claim against a server baseline.** The
  browser now reports the cumulative watch time of its viewing session and the
  key of that session; the server keeps the cumulative watch time it has
  already accounted for in a `playback_viewing_sessions` row. The first beacon
  of a session is measured against the moment the server stamped, so it cannot
  claim a watch time it did not earn; a repeated claim is a delta of zero, so
  a lost acknowledgement cannot double-count a delta; two tabs are two
  sessions, so one tab cannot reset the baseline of the other (T1, T2,
  D-090).
- **The six-hour view window is checked atomically.** The window check and the
  insert run in one transaction, behind a transaction-scoped advisory lock
  keyed by visitor and title, so two requests that arrive at the same time
  queue instead of interleaving. The hourly unique index stays as the
  database-level safety net (T3, D-089).
- **Every read and dedup path uses the typed target.** The shared expressions
  of `analytics/typed-targets.ts` are now used by the window check, the public
  view count, the playback summary, the completion check and the
  deduplication indexes, so a row whose typed and legacy targets disagree is
  counted under the target it is filtered by (T4, D-082).
- **An orphaned browser guest row is reconciled into the account's row.** The
  view events, playback events, search events and viewing-session baselines of
  the anonymous row move to the canonical row in one transaction, a colliding
  row is soft-deleted in favour of the canonical one, and the anonymous row is
  retired. A failure is logged as a warning and never breaks the beacon
  (S1, D-094).
- **The viewing sessions follow their title.** They move with a drama that
  becomes a movie, they are removed with a title that is permanently deleted,
  they are counted in the impact the Trash surface shows, and the retention
  command removes the stale ones (D-090).

#### Notifications

- **A security notification follows the change the write reports.** Assigning a
  role, revoking a role and changing an account status now return whether they
  changed anything, and the notification follows that report instead of a
  pre-read comparison (T5, D-091).
- **A delivery candidate is claimed before it is sent.** The maintenance
  command selects its candidates with `FOR UPDATE SKIP LOCKED` inside a short
  transaction and writes a lease — an expiry and a token naming the owner. The
  lease is released only by its owner, a crashed run loses nothing because the
  lease expires, and the successful-delivery check and the attempt cap are
  read again immediately before the push (T7, D-092).
- **The preference form submits only the switches the viewer changed.** A
  stale form on one device no longer carries the value another device has
  already changed (S2, D-085).
- **An expired announcement leaves the published list.** The expiry is
  filtered in SQL with the database clock, before the list is limited, so an
  expired announcement cannot push a visible one out of the list (S3).
- **The browser-push switch describes an account-wide control.** The copy says
  that the permission is requested per browser (S4).

#### Schema

- `drizzle/0025_phase11_review_round5.sql` (new): the effective-target
  deduplication indexes, their lookup indexes, and the soft-delete of the
  duplicate rows they would refuse (T4).
- `drizzle/0026_phase11_review_round5_playback_sessions.sql` (new): the
  `playback_viewing_sessions` table — the server's baseline of a viewing
  session — with its unique index and its foreign key (T1, T2).
- `drizzle/0027_phase11_review_round5_delivery_lease.sql` (new): the two
  delivery-lease columns on `notifications` and their index (T7).
- **The applied migrations are unchanged.** The `Reversibility:` lines that
  round 4 added to the nineteen historical migrations are removed, so the
  files and the statements that ran agree again. The rollback plan of every
  historical migration now lives in `docs/development/DATABASE.md` §7.1, and a
  unit test reads the journal to enforce the rule (M1, D-093).

#### Testing

- New unit coverage: the cumulative watch-time rule, the playback reporter's
  cumulative protocol, the playback request contract, the preference form's
  partial submit, the delivery lease, the maintenance script's claim, and the
  migration-reversibility rule.
- New integration coverage: the forged first beacon, the lost acknowledgement,
  the two tabs of one viewer, the visitor reconciliation, the viewing-session
  ownership and retention, and the delivery lease.
- **The end-to-end start gate covers a cold compile.** Playwright's readiness
  probe requests the base URL, so the run cannot start before a cold
  development server has compiled `/`; the measured cold compile is ~250s and
  one run was still compiling when the 300s budget expired. The budget is now
  600s. Test infrastructure only: the home route's module graph is identical
  before and after the round-5 changes.

#### Verification

- Typecheck: **PASS** (`npm run typecheck`)
- Lint: **PASS** (`npm run lint`; only the pre-existing
  `MODULE_TYPELESS_PACKAGE_JSON` warning)
- Unit tests: **PASS** — 1320/1320, 137 files (`npm test`)
- Integration tests: **PASS** — 823/823, 58 files (`npm run test:integration`)
- Playwright E2E: **PASS** — 94/94 (`npx playwright test`), exit code 0; 91
  routes warmed in 204s, run finished in 14.7 minutes
- Production build: **PASS** (`npm run build` with HTTPS `APP_URL` and
  `TRUSTED_ORIGINS`) — exit code 0

---

### fix: resolve the fourth Phase 11 review round (Prompts 139–154)

A fourth fresh review of the whole Phase 11 branch found ten findings to fix
and four to answer. Each was checked against the code and the binding rules
before any fix, and each fix was written test-first.

#### Analytics

- **The typed target wins over the legacy pair.** `analytics/typed-targets.ts`
  owns the four SQL expressions, and the aggregation and the dashboard use
  them for both the grouping and the filter, so a row whose typed and legacy
  targets disagree is counted under the target it is filtered by (A1, D-082).
- **The cookie is issued at the edge.** `analytics/guest-session.ts` resolves
  the identifier and never touches the cookie jar; the analytics route handlers
  issue it, and the workflows take the identifier as an argument. The
  workflows are therefore not Server Actions: a Server Action argument arrives
  from the request body, so a caller could attribute its views to another
  visitor's session (A2, D-083).
- **The dashboard freshness describes the selected range.** "Last updated" is
  read from the rows of that range, and a range with no aggregate row says it
  has no freshness instead of borrowing another range's (A10, D-081).

#### Notifications

- **A security notification follows the change, not the request.** Assigning
  a role the account already holds, or deactivating an account that was
  already deactivated, no longer tells the account owner that something
  happened (A9, D-080).
- **The admin islands read their DTOs from shared files.** The administrator
  alert and announcement DTOs live in `admin-notifications.shared.ts` and
  `announcements.shared.ts`; a client island never imports the server-only
  module barrel (A3, D-085).
- **The preference form and its action share one contract.** The form uses
  React Hook Form with `zodResolver`, and both sides validate with the schema
  of `lib/contracts/notification-preferences.ts` (A4, D-085).
- **The new-drama switch is `NOT NULL DEFAULT true`.** Migration `0024`
  backfills the nulls, sets the default, and sets the constraint, so the
  column matches the documented data model (A5, D-084).
- **One owner per catalogue.** `formatCreatedAt` lives in `src/lib/utils.ts`
  and the playback event list in `analytics/playback-events.shared.ts`; the
  islands and the player read the same definitions (A7, D-085).

#### Administration

- **The session-termination workflow is reachable.** `POST
  /admin/api/users/[id]/sessions` calls `terminateUserSessionsForAdmin`, and
  the users page offers a Super Admin-only "Terminate sessions" control that
  asks for confirmation first (A8).

#### Schema

- `drizzle/0024_phase11_review_round4.sql` (new): the `new_drama` backfill,
  default, and `NOT NULL` constraint.
- Every remaining migration now states whether it can be rolled back. The
  18 pre-existing migrations that had no `Reversibility:` line carry one
  now; the change is comment-only, and the whole chain was re-applied to a
  scratch schema to prove it stayed inert (A6).

#### Documentation

Four findings were rejected with a correction, because the code followed the
repository's real conventions and the documentation was the part that was
wrong:

- **ARCHITECTURE §17 now states the database rule as it is implemented.** The
  project has no repository/read-model split; the rule that holds is that a
  module never writes another module's tables (D-086).
- **Server Actions live in `src/workflows/**`,** beside the workflow they
  belong to; `src/app` holds routing and entrypoint adaptation (D-086).
- **A component file is kebab-case,** as the admin kits already document; the
  existing PascalCase files are left alone (D-087).
- **The notification unread count is resolved on the server,** in the public
  layout, and there is no REST endpoint for it (D-088).

#### Testing

- New guards: the admin session route, the guest-cookie boundary, the shared
  catalogue, the migration reversibility, and the preference contract.
- New behavioural coverage: the no-op security request, the range-scoped
  dashboard freshness, the typed-target grouping, the `new_drama` constraint,
  and the Super Admin-only session-termination control.
- A new browser spec terminates the sessions of an account and proves the
  account is signed out: the target's own browser session renders the
  anonymous notification centre afterwards.

#### Verification

- Typecheck: **PASS** (`npm run typecheck`)
- Lint: **PASS** (`npm run lint`)
- Unit tests: **PASS** — 1298/1298, 136 files (`npm test`)
- Integration tests: **PASS** — 793/793, 55 files (`npm run test:integration`)
- Playwright E2E: **PASS** — 94/94 (`npx playwright test`)
- Production build: **PASS** (`npm run build` with HTTPS `APP_URL` and
  `TRUSTED_ORIGINS`) — "Compiled successfully in 2.4min", exit code 0

---

### fix: resolve the third Phase 11 review round (Prompts 139–154)

A third fresh review of the Phase 11 work found nine Standards findings and six
Spec findings. Each was checked against the code before any fix, and each fix
was written test-first.

#### Analytics

- **The aggregation reads its inputs inside the transaction.** `aggregateScope`
  computed the rows before the advisory lock, so two overlapping refreshes could
  read different inputs and write the same key. The seven reads now run inside
  the transaction, after the lock, one after the other (S1).
- **A completion must be supported by the server.** A completion counts only
  when the visitor has a stored `play` event for the same content and the
  cumulative server-verified watch time reaches 60 seconds; a forged zero-watch
  completion is stored with `completion_threshold_met = false` and does not
  count (P1, D-073).
- **An event carries the viewer classification of the moment it was recorded.**
  `content_view_events` and `playback_analytics_events` gain a request-time
  `viewer_type`; the dashboard shows the signed-in/guest split at range and day
  level, and signing in no longer reclassifies the earlier events (P2, D-074).
- **The dashboard read model no longer imports another module's schema.** It
  uses the raw table names (the `discovery.ts` precedent) and the content
  module's public title query (S9/P6).

#### Notifications

- **The audience reads are serialised and shared.** `deliverToAudience` is the
  one delivery primitive behind the event and announcement rounds; it runs its
  three reads one after another and is the only home of `MAX_AUDIENCE_SIZE`
  (S2).
- **The delivery limits live in one file.**
  `src/modules/notifications/delivery-limits.ts` holds the four numbers; the
  application and `scripts/notification-maintenance.mjs` both import it, and a
  unit test fails if they drift. The command's direct SQL is the documented
  exception in ARCHITECTURE §16.2 (S3, D-078).
- **The announcement services take an actor and throw typed errors.**
  `createAnnouncement` / `publishAnnouncement` check `settings.manage`
  themselves and throw `ValidationError` / `NotFoundError` instead of
  `RangeError` (S8).
- **A resolved content report tells the reporter.** The workflow emits
  `content_report_resolved` with the report id as the content id, so a repeated
  resolution cannot send a second notification (P3, D-075). The write happens
  after the resolution has committed, so a failed notification is logged and
  swallowed rather than failing the moderator's action (D-064).
- **Reserved IPv6 literals are refused as push endpoints.** The IANA reserved
  ranges are now blocked in addition to the private ones (P5).
- **An unjustified `as never` is gone.** `createPinnedLookup` returns Node's
  `LookupFunction` and the error path passes a real `Error` (S5).
- **The client islands import the pure contracts, not the server barrel.** The
  three `*.shared.ts` files hold the client-safe types (S7).

#### Content

- **The publication workflow announces through the content module's public
  API.** `listPublishedDramaReferences`, `listPublishedSeasonReferences`, and
  `listPublishedEpisodeReferences` replace the raw SQL in `announceContent()`,
  and an architecture guard pins the boundary (S6, D-076).

#### Dashboard

- **The custom date range is reachable.** The dashboard has a plain GET form
  with two date inputs and the `custom` preset, beside the preset links (P4,
  D-077).

#### Schema

- `drizzle/0021_phase11_review_fixes_round2.sql` is now data only (the
  duplicate cleanup).
- `drizzle/0022_phase11_review_round3_schema.sql` (new): the two partial unique
  indexes of `analytics_daily_aggregates` and the two `viewer_type` columns.
- `drizzle/0023_phase11_review_round3_data.sql` (new): the best-effort
  `viewer_type` backfill.

#### Testing

- New guards: aggregation transaction boundary, audience single connection,
  delivery-limit synchronisation, client boundary, unsafe assertions,
  publication-announcement boundary, end-to-end alert locator.
- New behavioural coverage: the completion rule (unit + integration), the
  request-time viewer classification (integration), the content-report
  notification (unit), the publication references (integration), and the
  dashboard custom range and viewer split (component).
- A mapping defect was found and fixed while proving the dashboard split:
  `countDistinctVisitorsByDay` read `record.guest_visitors` while the SQL
  aliased the column `guest_viewers`, so the guest count was always zero.
- The browser suite failed on a locator rather than on the application: Next.js
  renders a route announcer that also carries `role="alert"` after hydration,
  so `getByRole('alert')` resolved to two elements and the assertion failed
  with a strict-mode violation. The locator is narrowed to the alert the test
  means, and a unit guard fails when a spec uses an unnarrowed alert locator
  (D-079).
- A failed reporter notification failed the moderation action, even though the
  report had already been resolved. The failure is now logged and swallowed
  (D-064, D-075).

#### Verification

- Typecheck: **PASS** (`npm run typecheck`)
- Lint: **PASS** (`npm run lint`)
- Unit tests: **PASS** — 1274/1274, 131 files (`npm test`)
- Integration tests: **PASS** — 790/790, 55 files (`npm run test:integration`)
- Playwright E2E: **PASS** — 93/93 (`npm run test:e2e`)
- Production build: **PASS** (`npm run build` with HTTPS `APP_URL` and
  `TRUSTED_ORIGINS`) — "Compiled successfully", exit code 0

---

### fix: resolve the second Phase 11 review round (Prompts 139–154)

A second fresh review of the Phase 11 work found five Important and three Minor
findings. Each was checked against the code before any fix. This pass fixes
them and adds the regression coverage that proves the fixes.

#### Security

- **A push endpoint is validated before it is stored and again before it is
  contacted.** The rules live in one shared module
  (`modules/notifications/push-transport.ts`): HTTPS only, no credentials and no
  fragment, no local or private host name, no private or reserved IP literal
  (IPv4 and IPv6, including the IPv4-mapped, NAT64, and 6to4 forms), an
  optional `PUSH_ALLOWED_HOSTS` allowlist, a DNS check at send time whose
  answer is pinned for the connection, and an outbound timeout (D-070).
- **The push configuration is part of `ServerConfig`.** A half-configured VAPID
  key pair fails at startup, the contact address must be a `mailto:` address or
  an HTTPS URL, and the host allowlist is validated as a list of host names.

#### Analytics

- **A public playback beacon cannot claim an arbitrary watch time.** The watch
  duration is clamped to the time that passed since the previous stored event
  of the same visitor and the same content, plus thirty seconds of tolerance,
  and to an absolute maximum; an impossible media position is dropped (D-070).
- **Only a completion event may claim a completion.** The browser sends the
  flag on every event, so the field is honoured on a `completion` event only and
  forced to `false` everywhere else — at the validation boundary and again at
  the write, so no caller of the module can record a completion the event type
  does not support (D-070).
- **The daily aggregate has a database-level key.** Migration `0021` adds the
  two partial unique indexes that state the logical keys of
  `analytics_daily_aggregates` (the round-3 review later split it into `0021`
  for the data cleanup and `0022` for the indexes); the refresh takes a
  transaction-scoped advisory lock and inserts with `ON CONFLICT DO NOTHING`
  (D-070).
- **The average watch time of a range is divided by the viewers of the range.**
  The range-level playback viewers are counted over the raw playback events, so
  a viewer who played on three days is one viewer (D-070).

#### Notifications

- **The maintenance command exists.** `scripts/notification-maintenance.mjs` and
  `npm run db:notifications:maintenance` share the delivery rule and the push
  transport with the application and report a structured result (D-070).
- **Turning browser push off releases the browser subscription.** The opt-in
  island calls `PushSubscription.unsubscribe()` for the subscription whose
  endpoint matches the one that was turned off.
- **The notification module reads other modules through their public APIs.**
  The bookmark audience comes from `users.listBookmarkOwnerIds`, the
  active-account audience from `auth.listActiveAccountIds`, and the content
  resolution moved into the publication workflow: the notification module does
  not import `content` at all. The administrator viewer adapter moved from
  `src/lib/` to `src/workflows/admin/admin-notification-viewer.ts`.

#### Testing

- **The integration suite is deterministic.** The files share one PostgreSQL
  database, and a production broadcast reaches every active account, so two
  files running at the same time interfered with each other. The integration
  files now run one after another, and a notification assertion is scoped to
  its event (D-071).
- **The browser suite warms up every route, and the invariant is enforced.** The
  warm-up list was written by hand and had fallen behind: the public ranking
  pages and roughly twenty administration pages and API routes were missing
  from it. A test that reached an un-warmed route paid the cold Turbopack
  compile inside its own assertion window, so a correct application was
  reported as a broken one. The list now covers every route module under
  `src/app`, and `tests/unit/e2e/warmup-coverage.test.ts` derives the routes
  from the source tree and fails when one escapes the list.
- **The fixture deletes the drama hierarchy inside the retry.** A late
  playback beacon can land while the cleanup runs, and the restrictive foreign
  key then refuses the deletion of the *episode* row, not only the deletion of
  the drama row. The dependent deletions now run inside the same savepoint as
  the content deletion, so the whole hierarchy is deleted again on the next
  attempt.
- **The retry watches the right SQLSTATE.** PostgreSQL reports two codes for
  the same refusal: `23001` (`restrict_violation`) for an `ON DELETE RESTRICT`
  foreign key and `23503` (`foreign_key_violation`) for an `ON DELETE NO
  ACTION` one. The analytics tables use `RESTRICT`, so the retry was watching
  the code that never occurs, and every late beacon was reported as a broken
  fixture. Both codes are retried now, and the failure message names the
  statement and the constraint that were refused.
- **The browser budgets cover a cold compile.** The expectation timeout is 20
  seconds, the navigation timeout 60 seconds, the test budget 90 seconds, and
  the action timeout 20 seconds.

#### Schema

- `drizzle/0021_phase11_review_fixes_round2.sql`: the two partial unique
  indexes of `analytics_daily_aggregates`, after removing the duplicates the
  old application could create. The round-3 review split this into `0021`
  (data only) and `0022` (the indexes).

#### Verification

- Typecheck: **PASS** (`npm run typecheck`)
- Lint: **PASS** (`npm run lint`)
- Unit tests: **PASS** — 1241/1241, 120 files (`npm test`)
- Integration tests: **PASS** — 776/776, 54 files (`npm run test:integration`)
- Playwright E2E: **PASS** — 93/93 (`npm run test:e2e`)
- Production build: **PASS** (`npm run build` with HTTPS `APP_URL` and
  `TRUSTED_ORIGINS`) — "Compiled successfully", exit code 0

---

### fix: resolve the Phase 11 review findings (Prompts 139–154)

A fresh review of the Phase 11 commit found ten defects, all confirmed against
the code. This pass fixes them and adds the regression coverage that proves the
fixes.

#### Analytics

- **A `play` event marks a playback start.** The player reports it once per
  viewing session; `play_pause` still reports every play and pause. The daily
  aggregate stores `playback_starts`, and the completion rate is
  `completions / playback_starts` (D-068).
- **Average watch time is divided by `playback_viewers`,** the distinct visitors
  who actually played, not by every visitor. The site-level count is a distinct
  count across the site, not a sum of the per-title counts (D-068).
- **Today's aggregate is refreshed every 60 seconds while the dashboard tab is
  visible.** The refresh is a bounded server action authorised by
  `analytics.read`; a hidden tab does not write. Rewriting a historical range
  still requires `analytics.manage` (D-068).
- **The dashboard names its denominators.** It shows playback starts and
  playback viewers, and explains that the completion rate is completions over
  starts.

#### Notifications

- **Browser push is real native Web Push.** `web-push` signs the request with a
  VAPID key pair from the environment; a `404`/`410` retires the subscription.
  FCM is retained as an isolated adapter but is not selected, because its web
  SDK yields registration tokens, not the stored native subscription (D-066).
- **The administrator alert centre exists.** `/admin/notifications` now lists,
  filters, paginates, and reads alerts, with per-administrator read state. A
  content report writes a `content` alert to the moderators; a failed
  publication announcement writes a `high` `system` alert to the Super Admin.
  Every read is audience-filtered on the server, and an alert outside the
  audience answers 404 (D-067).
- **A notification is written at most once.** A partial unique index on
  `(user_id, event_type, content_id)` plus `ON CONFLICT DO NOTHING` makes the
  write idempotent. The writer distinguishes `created`, `duplicate`, and
  `not_wanted`, and the broadcast counters report duplicates separately
  (D-069).
- **A failed push is recoverable.** A short-lived maintenance command retries a
  notification from the last seven days with no successful push and fewer than
  three attempts. It never re-sends a notification that reached a browser once
  (D-069).
- **The delivery cleanup is bounded by the statement.** The `limit` is inside
  the delete, so the reported number is the number actually removed (D-069).

#### Schema

- `drizzle/0020_phase11_review_fixes.sql`: the notification de-duplication
  index, the delivery-maintenance index, the administrator alert columns and
  the `admin_notification_reads` table, and the two new aggregate columns.

#### Verification

- Typecheck: **PASS** (`npm run typecheck`)
- Lint: **PASS** (`npm run lint`)
- Unit tests: **PASS** — 1180/1180, 112 files (`npm test`)
- Integration tests: **PASS** — 770/770, 54 files (`npm run test:integration`)
- Playwright E2E: **PASS** — 93/93 (`npx playwright test`)
- Production build: **PASS** (`npm run build`)

---

### feat: complete Phase 9 (Prompts 115-120) and Phase 10 (Prompts 121-138)

This pass audited both phases end to end, fixed the defects listed below, and
replaced the partial implementations with verified ones.

#### Phase 9 — Ratings, Reviews, and Moderation

- **Ratings (115).** `reviews.submitDramaRating` / `submitMovieRating` accept
  one active rating (1–5) per viewer per content item. The value is validated
  with Zod on the server. The write is an upsert against the partial unique
  index `uq_ratings_drama_id_user_id_active`.
- **Reviews (116).** `reviews.submitDramaReview` / `submitMovieReview` accept
  one active written review per viewer per content item, and the author may
  edit it in place. The creation time is preserved; the last-edited timestamp
  moves forward. A viewer cannot delete their own review.
- **Aggregation (117).** `reviews.getRatingSummary` returns the average and the
  count of the *active* ratings. A deleted rating never counts, and the rating
  block is hidden when there is no rating at all.
- **Reactions (118).** `reviews.toggleReviewEnjoying` adds or removes the
  viewer's one "Enjoying" reaction. The toggle deletes first and then inserts,
  so a double tap is idempotent instead of a unique-violation error.
- **Sorting and reporting (119).** Reviews sort by Most Enjoying, Newest, or
  Highest Rated. The reasons are a client-safe catalog
  (`src/modules/reviews/report-reasons.ts`). One *active* report per viewer per
  review is enforced; a viewer may report again after an earlier report is
  resolved.
- **Moderation (120).** `reviews.removeReview` permanently removes a review and
  `moderation.recordModerationAction` writes the audit row. The report survives
  as moderation history: `review_reports.review_id` is nullable with
  `ON DELETE SET NULL`, and the immutable `review_id_snapshot` keeps the id of
  the removed review. `notifications.notifyReporter` always delivers the
  outcome — a moderation result is not preference-gated.

#### Phase 10 — Homepage, discovery, and search

- **Homepage.** The real homepage is `src/app/(public)/page.tsx` at `/`; the
  untracked, broken `/home` route was deleted.
- **Ranked discovery.** `/trending`, `/popular`, `/recently-added`, and
  `/highest-rated` render one shared ranked grid over
  `analytics/read-models/discovery.ts`. Trending is a recency-decayed weighted
  score over a 14-day window; Popular is the same measure over all history
  without decay; Most viewed is the historical sum of views; Highest Rated is
  the average of the active ratings. Every ranking reads the stored daily
  aggregates, so a refresh cannot inflate a score.
- **Homepage administration.** `/admin/featured`, `/admin/hero-rotation`, and
  `/admin/trending-pins` store their state in `system_settings` and are
  guarded by `settings.manage`.
- **The browse catalogues.** `/drama` and `/movie` are server-rendered over the
  same shared ranked grid as the ranking pages, so the whole browse surface
  uses one availability rule and one ranking implementation. `/drama` offers
  the lifecycle-status filter; `/movie` offers the sort order, because a film
  is a finished work.
- **Two independent facts on a card.** The availability of an item ("Coming
  soon" / "Available now") and its lifecycle status (ongoing / completed) are
  different things, and the card shows both. The badge prefers "Coming Soon"
  over the lifecycle label, because "you cannot watch this yet" is the more
  actionable fact.
- **Search.** `/search` is server-rendered with a client-island search box.
  Matching uses PostgreSQL full-text search and trigram similarity; migration
  `0016` installs `pg_trgm` and the GIN indexes. A search with a term is
  ordered by relevance — exact title, prefix, contains, full-text, then
  trigram — because a plain trigram score buried the title the viewer typed.
- **User pages.** `/bookmarks`, `/continue-watching`, and `/watch-history` are
  server-rendered over the `users` module read models.

#### Bugs fixed

- **`revalidatePath` was imported from `next/navigation`.** It is exported by
  `next/cache` in Next.js 16.4.5. The import and two bogus module
  augmentations are gone.
- **A partial-index upsert wrote through the wrong predicate.**
  `onConflictDoUpdate` named only the conflict target, so PostgreSQL could not
  infer the partial unique index and a second rating failed. `targetWhere` now
  repeats the whole index predicate.
- **The review form reported the wrong outcome.** The success message was
  derived from the refreshed `existingReview` prop, so publishing a first
  review announced "Your review was updated."
- **The moderation queues dropped their confirmation.** Both queue components
  returned early when the list was empty, *before* rendering the message.
  Resolving the only report in the queue emptied the list, so the moderator saw
  the empty state and no confirmation at all and could not tell whether the
  click had worked. The message and the error are now rendered above the empty
  state, and a regression test proves they survive the re-render.
- **The share control crashed every public details page.** `ShareButton` read
  `window.location.origin` during render; a client component is also rendered
  on the server, so `/drama/{id}/{slug}` and `/movie/{id}/{slug}` answered HTTP
  500 with `ReferenceError: window is not defined`. The origin is now read in
  an effect, and the control receives the canonical `href` from the server
  page.
- **The integration test left 861 dramas, 123 movies, 131 categories, and 131
  platforms behind.** The cleanup deleted the dependents but not the seeded
  rows, and the leftovers polluted every later search and ranking. The cleanup
  now removes the seeded rows as well.
- **The admin navigation was wider than the page guards.** The Homepage
  entries and the Reports entry named permissions the pages do not check.
  They now name exactly the permission the page checks.
- **The E2E identity marker referred to a removed headline.** The global setup
  looked for "International drama and movies, in one place.", which the
  rewritten homepage no longer renders; every E2E run failed its application
  check.
- **The Playwright web-server budget was too small for this filesystem.** The
  readiness check compiles the home route — about 80 seconds cold on this
  network drive — and the 120-second budget expired before any test ran. The
  budget is now 300 seconds, with a comment that says why.
- **The similar-drama administration test exceeded the suite's per-test
  budget.** The global 30-second budget is smaller than the configured
  45-second navigation timeout, so a cold route compile plus the real
  add/reorder/reload/remove work does not fit in it. The test now sets an
  explicit 120-second budget, following the precedent set by the admin
  content-management and footer flows. No assertion was weakened.
- **`src/app/profile/page.tsx` had no final newline**, which failed the
  repository-wide `eol-last` lint rule.
- **The film catalogue page was a hardcoded empty state.** `/movie` rendered
  two placeholder tabs — "Recent releases" and "Classic films" — with no query
  behind them, so it announced "No films published yet" no matter what the
  catalogue held. It is now a server-rendered discovery grid over the shared
  ranked read model.
- **The "Complete series" count counted every drama.** The old drama catalogue
  showed the number of *all* dramas under "Complete series", and the tab was
  not a filter. The page now offers a lifecycle-status filter that actually
  narrows the grid.
- **Two of the three homepage settings could not be saved at all.** The hero
  rotation, the Trending pins, and clearing the featured item wrote the
  literal strings `hero_rotation`, `trending_pins`, and `featured` into
  `admin_audit_log.entity_id`, which is a `uuid` column. PostgreSQL rejected
  the insert, the transaction rolled back, and the administrator saw "An
  unexpected error occurred." — every save failed, with no explanation. A
  global setting is not a content row and has no identifier to point at, so
  the audit record now names the setting itself (`entity_type =
  'homepage_setting'`, no entity id), and migration `0017` makes `entity_id`
  nullable for exactly that case.
- **The homepage confirmations read "1 items".** The hero-rotation and
  Trending-pin messages used a fixed plural. The wording now lives in
  `src/components/admin/homepage/homepage-messages.ts` and is unit-tested.

#### Changed files

- `src/modules/reviews/{service.ts,review-service.ts,reaction-service.ts,report-service.ts,removal-service.ts,validation.ts,report-reasons.ts,schema.ts,index.ts}`
- `src/modules/moderation/{schema.ts,service.ts,index.ts}`
- `src/modules/notifications/{notifications.ts,index.ts}`
- `src/modules/analytics/read-models/discovery.ts` (new)
- `src/modules/content/{public-discovery.ts,public-discovery.shared.ts,index.ts}`
- `src/modules/administration/{settings.ts,settings.shared.ts,schema.ts,index.ts}`
- `src/modules/users/{content-reports.ts,watch-history.ts,bookmarks.ts,playback-state.ts,index.ts}`
- `src/workflows/reviews/actions.ts`, `src/workflows/moderation/review-moderation.ts`,
  `src/workflows/admin/homepage-settings.ts`
- `src/components/public/**`, `src/components/admin/homepage/**`,
  `src/components/admin/moderation/**`
- `src/app/(public)/**`, `src/app/admin/{featured,hero-rotation,trending-pins,reviews,reports}/**`,
  `src/app/api/search/suggestions/route.ts`
- `drizzle/0015_moderation_and_settings.sql`, `drizzle/0016_search_indexes.sql`,
  `drizzle/0017_audit_log_nullable_entity.sql`
- `src/actions/{moderation-actions.ts,reviews-actions.ts}` — removed; the
  Server Action convention is `src/workflows/**`.
- `tests/e2e/{reviews,discovery,admin-homepage-settings}.spec.ts`,
  `tests/integration/administration/homepage-settings.integration.test.ts`,
  `tests/unit/components/admin-homepage-messages.test.ts`

#### Verification

- Typecheck: **PASS** (`npm run typecheck`)
- Lint: **PASS** (`npm run lint`)
- Unit tests: **PASS** — 1119/1119, 107 files (`npm test`)
- Integration tests: **PASS** — 693/693, 45 files (`npm run test:integration`)
- Playwright E2E: **PASS** — 81/81 (`npx playwright test`)
- Production build: **PASS** (`npm run build`)

---

### feat: implement Phase 11 (Prompts 139–154) — analytics and notifications

The platform now measures what its viewers do, and tells them when something
they care about changes — without a worker, a queue, an email infrastructure,
or a fingerprint.

#### Analytics

- **Anonymous guest sessions.** `guest_sessions` holds one row per visitor: an
  anonymous `session_id`, a nullable `user_id`, a hashed IP, and the country
  code. The event tables carry `guest_sessions.id` and nothing else that
  identifies a person. The row is found by `user_id` for a signed-in viewer
  and by the `session_id` cookie for a guest, and the same row gains the
  `user_id` when the account signs in (D-057).
- **Retention policy.** The raw events and the guest-session rows are kept for
  400 days — longer than the 366-day range the dashboard may query — so every
  number the dashboard can show can still be rebuilt. A session row linked to
  an account is never removed. The removal is a bounded, short-lived command
  (`npm run db:analytics:retention`), never a worker (D-065).
- **View counting.** `POST /api/analytics/view` counts one view per visitor per
  content item in a rolling six-hour window. The window is an application rule
  with a per-hour-bucket partial unique index as the safety net (D-058). The
  public count reads the raw events, so it is correct before the first
  aggregation.
- **Playback analytics.** The player reports `play`, `play_pause`, `seek`,
  `completion`, and `exit`. Writes are bounded to one row per (visitor, content,
  event type, hour bucket), and `watch_duration_seconds` is the per-event delta —
  the browser only clears its accumulator when the server confirms the row was
  stored (D-060).
- **Daily aggregation.** A calendar day is a Dhaka day. The aggregation is a
  bounded, on-demand command inside one transaction, so re-running it for the
  same day produces the same result. There is no worker, no queue, and no
  recurring job (D-059).
- **Admin dashboard.** `/admin/analytics` shows the overview, the content
  performance table, the engagement trend, the viewer activity, and the time
  the numbers were last written. The range comes from the URL — seven
  presets plus a custom pair of calendar days — and is always bounded.

#### Notifications

- **Preferences.** Five independent event preferences plus the global In-app
  and Browser Push switches. The event preference decides whether the row is
  written at all; `global_in_app` gates the centre and `global_push` gates
  browser push. Account/security notifications are mandatory and have no
  switch (D-061).
- **Notification centre.** `/notifications` with mark-read and mark-unread
  behaviour, and a bell with the unread count in the public navigation. The
  count is resolved on the server, so it is right on the first render. Every
  read is filtered by `user_id`.
- **Browser push.** A native Web Push provider behind one interface, with the
  VAPID keys read from the environment; the FCM adapter is retained but not
  selected. A deployment without a key pair reports an explicit failure and
  never claims a delivery it did not perform. The permission is requested inside
  the click handler, never on the first page load (D-063, D-066).
- **Events.** A newly published drama, season, or episode notifies the
  eligible viewers after the publication transaction has committed. Only
  published *and* publicly available content is announced, the round is
  idempotent, and the audience is read in three bulk queries (D-062). Account
  deactivation, reactivation, role changes, and session termination produce
  mandatory account/security notifications (D-064).
- **Announcements and the administrator alert centre.** `/admin/notifications`
  creates a draft announcement and publishes it by hand; the published list is
  bounded to 50 rows. The same page lists the administrator alerts, filtered by
  the alert's audience with per-administrator read state (D-067).
- **Delivery safety.** Every attempt is recorded, the attempt count is capped
  at ten, and an expired subscription is soft-deleted instead of retried
  forever. A notification is written at most once, and the maintenance command
  retries an undelivered notification at most three times (D-069).

#### Schema

- `drizzle/0018_analytics_and_notifications.sql`: the `deleted_at` column on
  the three event tables, the `episode_id` column on the playback events, the
  guest-session and episode foreign keys, the deduplication indexes, the
  notification indexes, and the independent
  `notification_preferences.new_drama` switch.
- `drizzle/0019_analytics_retention_indexes.sql`: the three indexes the
  retention command needs, so it never reads a whole table.

#### Bugs fixed

- **The shared analytics fixture cleanup deleted every guest session in the
  test database**, including the ones the other test files were still using.
  The playback-event insert then failed on the foreign key. The cleanup is now
  scoped by each file's own prefix.
- **The analytics fixtures left 97 dramas and 97 movies behind in the shared
  test database**, and the leftovers broke the public list queries. The cleanup
  now removes the seeded rows as well.
- **The end-to-end fixtures could not delete the content they had seeded**,
  because the new analytics rows point at it with a `RESTRICT` foreign key.
  The fixtures remove the analytics and notification rows before the content,
  and a late analytics beacon no longer breaks the cleanup: the shared
  `tests/e2e/support/late-analytics.mjs` helper waits for the beacons that are
  still on their way, removes the rows they wrote, and tries again.
- **A late analytics beacon answered HTTP 500**, because the event was
  inserted without checking whether the title had been deleted in the
  meantime. The view and playback workflows now recognise the foreign-key
  violation and drop the event: a view of a deleted title is not an error.
- **The watch time was carried as a cumulative session total**, so several
  events of the same hour bucket each carried the whole total and the reported
  watch time was a multiple of the real watching time. The value is now the
  per-event delta.
- **The date-range resolver had no fallback branch**, so an unvalidated preset
  could produce an unbounded range. It now falls back to `last_7_days`.
- **The admin navigation was wider than the page guards**: the Notifications
  entry named `admin.manage` as well, while the page required only
  `settings.manage`. The page now accepts either permission and guards each
  surface separately (D-067).
- **Two of the five event preferences shared one column**, so "new drama" and
  "new season" could not be switched independently.

#### Verification

- Typecheck: **PASS** (`npm run typecheck`)
- Lint: **PASS** (`npm run lint`)
- Unit tests: **PASS** — 1174/1174, 111 files (`npm test`)
- Integration tests: **PASS** — 756/756, 52 files (`npm run test:integration`)
- Playwright E2E: **PASS** — 92/92 (`npx playwright test`)
- Production build: **PASS** (`npm run build` with HTTPS `APP_URL` and
  `TRUSTED_ORIGINS`)

---

## [Unreleased] - 2026-11-22

### feat: implement public details, navigation, and playback (Prompts 091–103)

The public site now has the four pages it was missing — a drama details page, a
standalone-movie details page, an episode watch page, and a movie watch page —
and every rule that decides what a viewer may see is owned by the `content`
module.

- `src/app/(public)/drama/[dramaId]/[slug]/page.tsx` (new): the drama details
  page shows poster, banner, title, description, categories, platforms,
  Ongoing/Completed status, rating, view count, the bookmark action, the
  Play/Continue action, the episode count, the seasons, and the similar
  dramas. A drama that is not discoverable is a 404, and an unpublished
  episode never appears (Prompt 091).
- `src/app/(public)/movie/[id]/[slug]/page.tsx` (new) and
  `src/app/(public)/movie/[id]/[slug]/watch/page.tsx` (new): the movie details
  page uses the same shared hero and the same visual quality as the drama
  page and renders no season or episode navigation (Prompts 092, 094).
- `src/components/public/episode-navigation.tsx` (rewritten): a client island
  that imports no module and receives plain data. A season-based drama gets a
  season selector — an ARIA tab list with one tab per season, arrow-key
  navigation, and one episode panel per season — a flat drama is one list
  without season controls, only publicly playable episodes are passed in, and
  the current episode carries `aria-current="page"` (Prompt 093).
- `src/app/(public)/drama/[dramaId]/[slug]/episode/[episodeId]/page.tsx`
  (modified): the watch page adds the previous/next links, the end-of-content
  state, the manual watched toggle, the resume offer, and the automatic
  next-episode parameter. The URL slug has to match the stored slug, and an
  unavailable episode is a 404 (Prompts 094, 096, 099, 100).
- `src/components/player/vidstack-player.tsx` (modified): the player reports
  the observed position every 15 seconds and flushes it on pause, on end, and
  when the page is left, through a `keepalive` beacon. It offers *Resume from
  m:ss* and *Start from the beginning*, plays inline, moves to the next
  episode with `?autoplay=1` when the media ends and the threshold has been
  reached, and shows a clear error with a manual *Try again* control when the
  source fails. There is no automatic retry, no source search, and no
  provider switching (Prompts 095, 098, 100, 101, 102).
- `src/modules/content/public-details.ts` (new),
  `src/modules/content/public-movies.ts` (new),
  `src/modules/content/public-movies.shared.ts` (new),
  `src/modules/content/public-episodes.shared.ts` (modified): the content
  module owns the public details, the playable episode list, the taxonomy, the
  similar dramas, the canonical hrefs, and the playability rules
  (`isPubliclyPlayableEpisode`, `isPubliclyPlayableMovie`). The next and
  previous episode follow the published content order (Prompts 091–093, 099,
  103).
- `src/modules/reviews/rating-summary.ts` (new) and
  `src/modules/analytics/view-counts.ts` (new): the rating summary and the
  view count are read models of their own modules. The content module does not
  import either of them; the page composes them. A rating appears only when
  real ratings exist, and a view count of zero is a real zero — no number is
  ever fabricated (Prompts 091, 092, 104 of the module boundaries, D-044).
- `src/modules/users/bookmarks.ts` (new),
  `src/modules/users/playback-state.ts` (new),
  `src/modules/users/progress.ts` (modified),
  `src/modules/users/watch-state.ts` (modified),
  `src/modules/users/validation.ts` (modified): the bookmark toggle, the
  resume point, the movie progress branch, and the manual watched-state
  change. Marking an episode unwatched returns the stored position to zero,
  preserves the first completion date, and the browser follows the server
  (D-045).
- `src/workflows/library/actions.ts` (new) and
  `src/workflows/playback/set-episode-watched.ts` (new): the two Server
  Actions behind the bookmark button and the watched toggle. The actor is
  resolved from the session on the server; the client is never the authority.
- `src/modules/content/episode-references.ts` (modified): the episode
  reference has two levels. `getEpisodeContentReference` answers "does the
  episode exist and is it still in the catalogue?" and is used by the
  administrative path; `getPublicEpisodeContentReference` answers "may the
  public watch it right now?" and is used by the viewer's progress and
  watched-state writes (D-043).
- `src/app/public/drama/**` and `src/app/public/movie/**` were removed: the
  public routes live in the `(public)` route group. The intentional public API
  route `src/app/public/api/dramas/route.ts` was kept.
- Tests: `tests/e2e/public-details.spec.ts` (new),
  `tests/e2e/support/movie-fixture.mjs` (new),
  `tests/e2e/support/slug-history-fixture.mjs` (new),
  `tests/integration/content/public-details.integration.test.ts` (new),
  `tests/integration/users/{bookmarks,watch-state,movie-progress,playback-progress}.integration.test.ts`
  (new),
  `tests/unit/modules/content/{public-movies,public-episode-order}.test.ts`
  (new),
  `tests/unit/modules/users/playback-progress-validation.test.ts` (new),
  `tests/unit/components/vidstack-player.test.tsx` (modified).
- Verified: typecheck PASS; lint PASS; unit 1049/1049 PASS; integration
  629/629 PASS; Playwright E2E 62/62 PASS; production build PASS (with HTTPS
  `APP_URL`/`TRUSTED_ORIGINS` overrides, because the local `.env.local` uses
  `http://localhost`, which the production configuration rejects).

### fix: make the playback progress write atomic (Prompts 091–103 review)

`savePlaybackProgress` read the stored row, decided on the observation time,
and then wrote unconditionally. Two overlapping requests could therefore both
read the same old row and write in the opposite order: an older report that
arrived late rolled the position, the watched minutes, and the completion
backwards, contradicting the deterministic-update rule of `REQUIREMENTS.md`
§7.3 and D-040.

The write is now one atomic step. The two target rows are locked with
`FOR UPDATE` for the duration of the transaction, and both upserts carry the
condition `last_watched_at <= excluded.last_watched_at`, so the database
refuses an older observation even when the requests overlap. The service opens
its own transaction when the caller does not provide one.

`tests/integration/users/playback-progress.integration.test.ts` forces the
interleaving — the newer report is applied inside a transaction that holds the
row lock while the older report reads the old value and waits to write — and
fails without the fix.

### fix: lock and write the playback rows in one order (Prompts 091–103 review)

The progress write locked the progress row first and the watched-state row
second; the manual watched-state change did the reverse. Two paths that touch
the same rows in opposite orders can deadlock, and the overlap is realistic: a
heartbeat that is already in flight when the viewer marks the episode
unwatched.

Both paths now lock *and* write the progress row first and the watched-state
row second (D-040). A row that does not exist yet is inserted, and an inserted
row takes a lock too, so the write order has to match the lock order.

`tests/integration/users/watch-state.integration.test.ts` ("does not deadlock
when a playback report and a manual change overlap") holds one row lock,
overlaps the two writes, and fails — with a lock wait that never clears — when
the order is wrong.

### fix: keep a manual "unwatched" decision alive (Prompts 091–103 review)

Marking an episode unwatched reset the stored position, but the browser still
held the old position and the next heartbeat completed the episode again. The
first completion date was erased as well, although D-045 says it is never
rewritten.

- The manual change now preserves the first completion date and records the
  reset separately in `completed_at_reset_at`.
- The decision moves the observation time forward, so a report that was
  already in flight describes the position from before the decision and is
  stale.
- `src/components/player/playback-reset.tsx` (new) carries one *start over*
  signal from the watched toggle to the player. The player drops the pending
  report, returns the media to the beginning, and clears the resume offer, so
  the viewer's decision survives the next heartbeat.
- An item that already counts as watched is complete, not unfinished, so the
  watch pages and the details pages no longer offer a resume for it.

### fix: apply one availability rule to the movie details page (Prompts 091–103 review)

The movie details page checked the publication state and the Trash state, but
not the source, while the watch route and the bookmark write used
`isPubliclyPlayableMovie`. A published movie without a source therefore showed
a *Coming soon* page whose watch link was a 404 and whose bookmark was
refused. The details page now uses the same rule, and the unreachable
*Coming soon* branch is gone.

### test: give the two heavy end-to-end flows an explicit budget

The suite raises the navigation timeout to 45 s because a development server
compiles a route on its first request, but the overall per-test budget stayed
at the default 30 s — smaller than a single allowed navigation. The admin
content management flow needed 37.7 s and failed intermittently, and the
footer flow (eight public routes, each compiled on its first request) failed
under load. Both tests now set an explicit 120 s budget with a comment that
explains why. No assertion was weakened, and every other test keeps the 30 s
budget.

### feat: redirect an old slug to the current canonical URL (Prompts 091–103 review)

`REQUIREMENTS.md` §4.3 and §6.6 require a slug change to preserve the old URL
through a redirect, but the public pages required an exact slug match, so a
renamed drama or movie answered 404 on its old URL.

`src/modules/content/public-slugs.ts` (new) exposes
`resolvePublicContentSlug(type, contentId, requestedSlug)`, which reads
`content_slug_history` and returns the current slug when the requested one is
a slug the item really used. The four public routes redirect the old URL to
the current canonical URL. A guessed slug is still a 404, and the lookup
applies the same availability rule as the page it redirects to, so it never
reveals the current slug of a draft, trashed, or source-less item (D-046).

### fix: keep the administrative episode reference separate from the public one

The first implementation of Prompts 091–103 made the shared
`content.getEpisodeContentReference` enforce public playability. An
administrator could therefore no longer attach a subtitle track to a draft
episode: the write failed with "Episode not found", and the end-to-end test
`admin episode video source › manages the subtitle tracks of an episode`
failed. The reference now has two levels (D-043): the administrative one
refuses only a missing or trashed episode, and the public one applies the
full hierarchy rule. The viewer's progress and watched-state writes use the
public level.

### fix: keep the first completion date of a manual watched-state change

`setEpisodeWatchedState` rewrote `completed_at` every time an episode was
marked watched. The first completion date is now preserved, so the moment an
episode was first completed stays the moment it was first completed (D-045).

### test: scope the merged Trash listing to the rows a test owns

`tests/integration/content/trash-listing.integration.test.ts` asserted global
counts and global rows of the merged Trash list. The integration suite shares
one database and runs its files in parallel, so a row that another file trashed
at the same moment changed the result and the test failed intermittently.
Every read in that file is now scoped with a token that only its own rows
carry; the assertions are unchanged in strength.

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

### fix: address the review findings of the video source workflow (Prompts 080–090)

A two-axis review of the video source workflow found eleven issues across the
two axes — specification conformance and repository standards. This change
fixes them without changing the approved scope: the source is still a direct
HTTPS MP4 URL, the server still never fetches it, and there is still no
upload, proxy, or transcode path.

Fixed:

- `src/platform/config/schema.ts` (modified): an empty or whitespace-only
  `MEDIA_ALLOWED_HOSTS` is treated as "not configured" instead of being parsed
  as a host named `""`. The empty value used to start the application with an
  unusable media policy.
- `src/modules/playback/validation.ts` (modified): a viewer-reported failure
  detail is sanitized before it is stored. Control characters are removed,
  absolute URLs are redacted, credential-shaped text is redacted, and the
  result is whitespace-collapsed and trimmed. The failure table can therefore
  never become a second copy of the source URL or a place to store a token.
- `src/modules/content/validation.ts` and `src/lib/contracts/episode-form.ts`
  (modified): the preview confirmation is a domain rule of the `content`
  module (`requireVideoSourcePreviewConfirmation`), composed into the form
  contract and validated again on the server. A source is stored only when the
  payload carries the confirmation — on the initial store **and** on a
  replacement.
- `src/workflows/admin/episode-actions.ts` (modified): the create action
  forwards `video_source_preview_confirmed` to the workflow. The flag was
  dropped on the way in, which made it impossible to create an episode with a
  source.
- `src/components/admin/dramas/episode-manager.tsx` (modified): the episode
  edit form carries the episode id and the drama id in its default values.
  The resolver required them and the form never supplied them, so the episode
  edit form could not submit at all.
- `src/workflows/playback/actions.ts` (modified) and
  `src/app/api/playback/progress/route.ts` (new): the playback heartbeat is a
  REST beacon (`POST /api/playback/progress`, `keepalive: true`), not a Server
  Action. A Server Action cannot promise that the request survives the page
  being closed; the beacon does. The workflow behind it is
  `src/workflows/playback/save-playback-progress.ts`.
- `src/modules/content/schema.ts` and `drizzle/0014_video_source_version.sql`
  (new): `episodes.video_source_version` counts the source generations of an
  episode. A progress write carries the version it belongs to, and a write for
  a version that is no longer current is ignored. The comparison is on a
  counter, not on a timestamp, so it does not depend on any clock (D-041).
- `src/modules/playback/{repository,queries,service}.ts` (new/rewritten) and
  `src/modules/playback/index.ts` (rewritten): the module is layered
  repository → queries → services → public API. Every administrative service
  takes the trusted actor as its first argument and re-checks `episode.manage`
  itself. A workflow can pass its transaction handle to a service, so the
  workflow owns the transaction and the module owns the rows.
- `src/workflows/admin/playback.ts` (new) and
  `src/workflows/admin/playback-actions.ts` (rewritten): the subtitle default
  switch runs in one transaction owned by the workflow. The Server Action next
  to it is a thin adapter: it resolves the actor, reads no table, and writes
  no SQL. The workflow does not import another module's internals.
- `src/workflows/admin/permanent-delete.ts` (modified): the permanent
  deletion calls the `playback` module's own purge service before deleting the
  episodes. The two cross-module foreign keys are `ON DELETE RESTRICT` now, so
  a content deletion can no longer remove another module's rows behind its
  back (D-042).
- `src/modules/content/public-episodes.ts` (modified): the catalogue list no
  longer exposes `videoSource`. Only the playback lookup returns the URL, and
  only for an episode that is publicly playable.
- `src/components/admin/dramas/{episode-manager,subtitle-track-manager}.tsx`
  (modified): the unsafe `as Record<string, unknown>` assertions are gone. The
  resolver-validated values are handed to the Server Actions as they are.

Guards:

- `tests/unit/architecture/playback-workflow-boundary.test.ts` (new): the
  heartbeat has to be the REST beacon, the workflow has to own the
  transaction, and neither the workflow nor its Server Action may import a
  module's internals or write SQL.
- `tests/unit/architecture/direct-video-source.test.ts` (modified): the
  migrations are scanned as well, so a video pipeline that exists only as a
  table is caught too.
- `tests/unit/e2e/stale-fixtures.test.ts` (modified): the end-to-end fixture
  sweep has to remove the playback rows before the episodes they point at.
  Without it the sweep rolls back on the restrictive foreign key.
- `tests/e2e/support/drama-fixture.mjs` and
  `tests/e2e/support/stale-fixtures.mjs` (modified): the end-to-end cleanups
  remove the playback rows before the episodes, for the same reason the
  permanent-delete workflow does.
- `tests/e2e/support/playable-media.mjs` (new): the shared browser fixture
  serves a playable file with CORS and range support, so the preview is
  exercised against a media host that behaves like a real one.


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
