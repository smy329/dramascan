# DECISIONS

**Project:** DramaScan — International Drama & Movie Streaming Platform
**Status:** Active decision log
**Last updated:** 2026-11-10

This file records finalized product and architecture decisions. Requirements live in
`REQUIREMENTS.md`; implementation progress lives in `PROJECT_STATUS.md`.

---

## D-000 — Specification authority

**Date:** 2026-11-07
**Status:** Approved by specification

**Decision:** The Detailed Micro-Prompt Development Pack (`AGENTS.md` and
`Detailed MICRO-PROMPT DEVELOPMENT PACK.txt`) is authoritative. The older
`MASTER DEVELOPMENT PROMPT.txt` is historical reference only and is not authoritative
where it conflicts with the Detailed Pack.

**Consequences:**

- The Odysee/LBRY and video-upload architecture in the older master prompt is obsolete
  and must not be implemented.
- Hard exclusions in the Detailed Pack are binding initial-release restrictions.
- Internal inconsistencies are resolved explicitly and recorded here.

---

## D-001 — Movie ratings and reviews

**Date:** 2026-11-08
**Status:** Approved by user
**Resolves:** OD-01

**Decision:** Ratings and written reviews are content-level features for dramas and
standalone movies. Episodes do not support ratings or reviews. Movie details pages expose
rating and review features.

**Consequences:**

- Ratings and reviews relate to a content item (drama or movie), not only to a drama.
- The Highest Rated page includes both dramas and movies with genuine ratings.
- CSV export and moderation cover drama and movie ratings/reviews.
- Public averages use each user's latest active rating; rating counts represent unique
  users.

---

## D-002 — Movie view counting

**Date:** 2026-11-08
**Status:** Approved by user
**Resolves:** OD-02

**Decision:** View counting is content-level for dramas and standalone movies. A view is
counted when a visitor views a drama or movie details page, at most once per visitor per
content item during a rolling six-hour window.

**Consequences:**

- Analytics records the content item type.
- Movie details pages display view counts.
- Repeated refreshes do not inflate view counts.
- The same rule applies to authenticated account IDs and privacy-conscious guest session
  IDs.

---

## D-003 — Content report authentication

**Date:** 2026-11-08
**Status:** Approved by user
**Resolves:** OD-03

**Decision:** Submitting a content report requires authentication.

**Consequences:**

- Guests cannot submit content reports.
- Rate limiting still applies to authenticated report submissions.
- The admin report-management interface remains restricted to authorized roles.

---

## D-004 — Movie subtitles

**Date:** 2026-11-08
**Status:** Approved by user
**Resolves:** OD-04

**Decision:** Subtitle tracks are supported for episodes and standalone movies.

**Consequences:**

- Subtitle metadata (language label, source URL, default-track flag) attaches to a
  playable content item: an episode or a standalone movie.
- The admin movie form supports subtitle track management.
- Subtitle URLs are validated; no subtitle transcoding service is introduced.

---

## D-005 — Account/security notification triggers

**Date:** 2026-11-08
**Status:** Approved by user
**Resolves:** OD-05

**Decision:** The initial mandatory account/security notification triggers are:

- User account deactivation and reactivation.
- Administrator account authorization and deactivation.
- Administrator role changes.
- Administrator session termination.

The platform does not promise Google-side security notifications it cannot reliably
detect.

**Consequences:**

- These notifications cannot be disabled through ordinary event preferences.
- Notification delivery follows the global and event preference rules; the mandatory
  status means these events cannot be disabled through ordinary event preferences.
- No real-time Google security-event integration is introduced.

---

## D-006 — Standalone movies in Watch History

**Date:** 2026-11-08
**Status:** Approved by user
**Resolves:** OD-06

**Decision:** Watch History includes standalone movies as content-level entries, in
addition to dramas and episodes.

**Consequences:**

- Watch-history records support dramas, movies, and episodes.
- The last-watched date and cross-device synchronization apply to movies.
- Watch History remains separate from Continue Watching.
- Individual history deletion, clear-all history, and advanced history filters remain
  excluded.

---

## D-007 — Movie canonical URL

**Date:** 2026-11-08
**Status:** Approved by user
**Resolves:** OD-07

**Decision:** Standalone movies use the canonical URL format
`/movie/{stableId}/{slug}`.

**Consequences:**

- Movie routes use the stable movie ID and current slug.
- A slug change redirects the old URL to the new canonical URL.
- SEO metadata, Open Graph metadata, and sitemaps use the canonical movie URL.
- Movie IDs remain distinct from drama IDs in routing.

---

## D-008 — Modular monolith shape and module boundaries

**Date:** 2026-11-08
**Status:** Approved by user
**Resolves:** Prompt 003

**Decision:** The application is a single-deployable Next.js modular monolith with feature modules over a shared platform layer, plus an explicit application-level workflow layer.

- `src/platform/` is infrastructure (DB, config, errors, logging, rate limiting, cache, HTTP mapping) and imports no modules.
- `src/modules/<domain>/` owns its Drizzle schema, repository, services, queries, and validation, and exposes exactly one public `index.ts`.
- Modules are assigned to fixed layers: platform; `auth`; `authorization`; `content`/`users`/`playback`/`reviews`; `moderation`/`notifications`/`analytics`; `administration`/`maintenance`.
- `src/workflows/` coordinates cross-module operations and owns shared transactions.
- `src/app/` contains entrypoints only; `src/components/` is client-safe and imports no module; `src/lib/contracts/` holds client-safe DTOs.
- `src/db/` is a composition root outside the layer stack: it assembles module schemas and creates the Drizzle instance, and is the only place allowed to import module `schema.ts` files.

**Consequences:**

- Upward imports and unlisted same-layer imports are forbidden. The allowed matrix is in `ARCHITECTURE.md` §7.
- Only four same-layer edges are permitted: `users → content`, `playback → content`, `reviews → content`, `administration → maintenance`.
- `auth` and `authorization` are separate modules. Authorization may depend on authentication; authentication never depends on authorization.
- Architecture rules are enforced by ESLint boundary rules, `import/no-cycle`, TypeScript strict mode, and CI.
- Adding a module, dependency, or exception requires a new decision entry and an `ARCHITECTURE.md` update.

---

## D-009 — Cross-module orchestration through workflows

**Date:** 2026-11-08
**Status:** Approved by user
**Resolves:** Prompt 003

**Decision:** Modules never import another module to trigger a side effect. Cross-module operations are coordinated by a thin workflow in `src/workflows/` that calls each participating module's public API independently with explicit, validated payloads and a trusted actor context. Workflows own sequencing and transaction boundaries, not domain rules. Single-module operations remain in that module's service; no workflow is created for them.

**Consequences:**

- `content` never imports `notifications`; `workflows/publish-content` calls both.
- `playback` never imports `analytics`; `workflows/save-playback-progress` calls both.
- No event bus, broker, queue, outbox, or background worker is introduced.
- Post-commit effects (cache invalidation, push dispatch) run after commit without an automatic retry loop.

---

## D-010 — Entrypoint allocation: Server Components, Server Actions, REST

**Date:** 2026-11-08
**Status:** Approved by user
**Resolves:** Prompt 003

**Decision:** Server Components perform all public and admin page reads through module query services. Server Actions perform form submissions and mutations through the relevant service or workflow. REST route handlers exist only for client-driven reads/polling, analytics beacons, exports/downloads, Better Auth, health checks, OpenAPI, and explicitly approved external integrations. Server Actions and REST call the same services and guards; no parallel business logic is permitted.

**Consequences:**

- Route handlers contain HTTP adaptation only; domain rules stay in services and workflows.
- Every REST endpoint has an equivalent authorization path to its Server Action counterpart.
- Query services enforce visibility, ownership, and resource-level access, not only entrypoints.
- The REST allowlist is fixed in `ARCHITECTURE.md` §9.2; expanding it requires a decision.

---

## D-011 — Data ownership and approved cross-module reads

**Date:** 2026-11-08
**Status:** Approved by user
**Resolves:** Prompt 003

**Decision:** Each module exclusively owns and writes its tables. Cross-module reads normally use the owner's public query API. Cross-module JOINs are permitted only in explicitly documented read-only locations: `analytics/read-models/` (reporting), `administration/read-models/` (operational summaries), `users/read-models/` (admin user listing over `auth` identity), and the moderation queue query. `analytics` is the reporting module but is not a mandatory intermediary for watch-page or admin operational reads.

**Consequences:**

- No module, workflow, or script writes another module's tables; workflows call each owner's service inside a shared transaction.
- Cross-module foreign keys do not grant write permission.
- Destructive cleanup is explicit in `workflows/permanently-delete-content`, not cross-module cascades.
- Sensitive projections (such as video source URLs) are returned only by the owning module's restricted queries.

---

## D-012 — Transaction coordination

**Date:** 2026-11-08
**Status:** Approved by user
**Resolves:** Prompt 003

**Decision:** A workflow that requires atomicity opens one PostgreSQL transaction through `platform/db/transaction.ts` and passes the same `DbExecutor` explicitly to every participating module operation. Repositories and services accept the executor and never open or commit a competing transaction. Any thrown error rolls back; partial writes are not allowed for all-or-nothing operations.

**Consequences:**

- Cross-module atomic operations (publish, source replacement, permanent deletion, conversion, role changes, import apply) use a single shared transaction.
- Post-commit effects run after commit; failures are recorded without an automatic retry loop.
- No distributed transactions, two-phase commit, eventual consistency, outbox, or queue is introduced.

---

## D-013 — Database identity, timestamp, and naming conventions

**Date:** 2026-11-08
**Status:** Established by Prompt 004 (convention choice; supersedable)
**Resolves:** Prompt 004

**Context:** Prompt 004 requires consistent database naming before any schema exists.
Prompt 020 will implement the schema; without a fixed identity and naming strategy, modules
would choose incompatible keys and timestamps.

**Decision:** Application-owned tables use UUIDv7 stored as PostgreSQL `uuid`; Better
Auth-managed tables keep Better Auth's required ID type and every foreign key matches it.
Tables are plural `snake_case`, columns are `snake_case`, and foreign keys are
`<singular_table>_id`. Timestamps are `timestamptz` (`created_at`, `updated_at`,
`deleted_at`, `published_at`). Trash is `deleted_at IS NOT NULL`; publication status is a
separate enum. Constraints and indexes follow the `pk_`/`fk_`/`uq_`/`ck_`/`idx_` prefixes in
`CONVENTIONS.md` §5.4. Active-row uniqueness uses partial indexes `WHERE deleted_at IS NULL`.

**Consequences:**

- IDs are generated server-side and never accepted from clients.
- Cross-module foreign keys are declared in SQL migrations, not by importing another
  module's `schema.ts`.
- The Better Auth ID exception is documented in `DATABASE.md`.
- Changing the identity strategy later requires a superseding decision and a data migration.

---

## D-014 — API response, pagination, and error contract

**Date:** 2026-11-08
**Status:** Established by Prompt 004 (convention choice; supersedable)
**Resolves:** Prompt 004

**Context:** Prompt 004 requires consistent API response conventions across REST endpoints
and Server Actions. Two entrypoints must not produce different shapes for the same failure.

**Decision:** JSON fields are camelCase; database columns stay snake_case and are mapped in
DTOs. Successful single-resource responses are `{ data }`; collections are
`{ data, meta }` with `page`, `pageSize`, `total`, `totalPages`, `hasNextPage`, and
`hasPreviousPage`. Page-based pagination defaults to `page=1`, `pageSize=20`, maximum `100`.
`sort` is a comma-separated allowlist with `-` for descending; multi-value filters use
repeated parameters; free text uses `q`. Errors use
`{ error: { code, message, fieldErrors?, requestId } }` with stable snake_case codes and the
HTTP mapping in `CONVENTIONS.md` §6.6. Server Actions return the `ActionResult<T>` union
instead of throwing across the boundary.

**Consequences:**

- No `success` flag and no resource-named collection wrapper.
- REST and Server Action authorization and error codes must match.
- `API.md` and the OpenAPI document must stay in sync with the implemented contract.
- Cursor pagination is introduced only by a documented endpoint change.

---

## D-015 — Testing and migration practices

**Date:** 2026-11-08
**Status:** Established by Prompt 004 (convention choice; supersedable)
**Resolves:** Prompt 004

**Context:** Prompt 004 requires testing and migration practices before the database and
CI exist. Unsafe migration habits are difficult to reverse once production data exists.

**Decision:** Unit and integration tests use Vitest; browser flows use Playwright.
Integration tests run against `TEST_DATABASE_URL`, whose database name must end in `_test`;
tests never use `DATABASE_URL`. Tests either wrap each case in a rolled-back transaction or
truncate between cases. Drizzle Kit generates sequential migrations into `drizzle/`; applied
migrations are never edited. Breaking changes use expand-contract. Production uses versioned
migrations only, never `drizzle-kit push` or startup synchronization. The application role
has DML rights; a separate migration role has DDL rights. Seeds are idempotent reference
data only.

**Consequences:**

- CI runs typecheck, lint, unit tests, integration tests, and a production build.
- Destructive migrations require a backup, explicit confirmation, and a documented
  rollback or forward-fix plan.
- Tests must never point at production or a shared development database.
- Fake content, ratings, or view counts are never seeded.

---

## D-016 — Documentation responsibilities and progress tracking

**Date:** 2026-11-08
**Status:** Established by Prompt 004 (convention choice; supersedable)
**Resolves:** Prompt 004

**Context:** Prompt 004 requires that future developers and agents understand completed work
before changing it, and that progress records prompt number, status, changed files, tests,
and unresolved issues.

**Decision:** Documentation is split by responsibility: `REQUIREMENTS.md` (scope),
`ARCHITECTURE.md` (boundaries), `CONVENTIONS.md` (day-to-day rules), `DATABASE.md` (schema),
`API.md` (contracts), `SECURITY.md` (controls and limitations), `DECISIONS.md` (approved
choices), `CHANGELOG.md` (notable changes), and `PROJECT_STATUS.md` (single source of
progress truth). Before changing code, an agent reads `PROJECT_STATUS.md`, `DECISIONS.md`,
`ARCHITECTURE.md`, `CONVENTIONS.md`, and the relevant area document, then inspects the
module's `index.ts` and tests. `PROJECT_STATUS.md` uses one row per prompt with prompt
number, title, status, changed files, tests, and notes/unresolved issues, plus a next-task
section.

**Consequences:**

- A prompt is not complete until its status row, the next task, and applicable changelog or
  decision entries are accurate.
- Documents link to the owning document instead of duplicating content.
- Implementation must not silently contradict an active decision.
- Unverified behavior and known limitations are reported in the status row.

---

## D-017 — Error handling and structured logging conventions

**Date:** 2026-11-08
**Status:** Established by Prompt 004 (convention choice; supersedable)
**Resolves:** Prompt 004

**Context:** Prompt 004 requires consistent error handling and logging. Domain code must not
depend on HTTP, and client responses must not leak internal detail.

**Decision:** `platform/errors` owns an `AppError` hierarchy (`ValidationError`,
`AuthenticationError`, `AuthorizationError`, `NotFoundError`, `ConflictError`,
`RateLimitError`, `InternalError`) with stable codes and HTTP mappings. Domain errors extend
a base class and add a stable code. Services throw typed errors and never return HTTP
responses. `platform/http` maps errors to REST once; `app` maps them to `ActionResult` once.
Logging uses Pino structured JSON with `time`, `level`, `msg`, `requestId`, `module`, and an
`event`/`action`, with redaction of credentials, cookies, tokens, and secrets. Request
bodies are not logged by default; `console.*` is forbidden in application code.

**Consequences:**

- Client-facing messages are safe; causes and stack traces stay in logs.
- `requestId` is returned as `X-Request-Id` and correlates logs with responses.
- Logs are journald-compatible; no external log service is introduced.
- Expected domain failures are logged at `warn`/`info`; unexpected failures at `error`.

---

## D-018 — Application runtime and package manager baseline

**Date:** 2026-11-08
**Status:** Established by Prompt 006
**Resolves:** Prompt 006

**Context:** Prompt 006 requires a compatible stable Next.js release and the package
manager choice referenced in `CONVENTIONS.md` §14. Exact versions must be recorded so
later prompts and CI reproduce the same foundation.

**Decision:** The application uses Next.js 16.4.5 with the App Router, React 19.3.1, and
TypeScript 5.9.3 on Node.js 24 LTS. npm is the package manager and the generated
`package-lock.json` must be committed when the repository is placed under version control.
The required scripts are `dev`, `build`, and `start`. Next.js automatic agent
file generation is disabled with `agentRules: false` so the authoritative `AGENTS.md`
cannot be rewritten by the framework.

**Consequences:**

- Runtime or framework upgrades require a superseding decision.
- `next-env.d.ts` is generated by Next.js and ignored; clean checkouts run
  `next typegen` before type checking.
- Next.js 16 requires the `react-jsx` compiler JSX mode instead of the older
  `preserve` default.
- Additional dependencies require a clear need, a license check, and documentation.

---

## D-019 — Server environment configuration contract

**Date:** 2026-11-08
**Status:** Established by Prompt 009
**Resolves:** Prompt 009

**Context:** Prompt 009 requires typed, validated environment configuration that keeps
server-only secrets out of public variables and fails clearly when production
configuration is missing or invalid.

**Decision:** `src/platform/config/` is the only place application code reads environment
variables. It imports `server-only`, validates `process.env` with Zod at module load, and
exports a frozen `serverConfig`. `src/instrumentation.ts` imports the module at server
startup (skipping the production build phase) so invalid configuration fails startup.
Variables: `APP_URL` (HTTP/HTTPS origin; production requires HTTPS), `TRUSTED_ORIGINS`
(comma-separated origins; `APP_URL` is always included), `DATABASE_URL`,
`TEST_DATABASE_URL` (name must end in `_test` and differ from `DATABASE_URL`),
`BETTER_AUTH_SECRET` (minimum 32 characters), `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and `SUPER_ADMIN_EMAIL`. Production requires all secrets;
development and test may omit them, but any provided value is validated. Public
`NEXT_PUBLIC_*` variables are limited to intentionally public values; no secret may use
that prefix. Errors list field names and messages, never values.

**Consequences:**

- Server code imports configuration only from `@/platform/config`.
- Client Components cannot import the config module; `server-only` fails the build if
  they try.
- New environment variables require a schema update, a `.env.example` entry, and
  documentation.
- `.env.example` contains placeholders only; real credentials stay in ignored
  `.env.local` or production environment configuration.
- Development defaults do not make production configuration optional; production
  startup fails closed.

---

## D-020 — Cross-content relationship model

**Date:** 2026-11-09
**Status:** Approved by user
**Resolves:** Prompt 020

**Context:** Ratings, reviews, bookmarks, and view events may target either a drama or a
standalone movie. `DATABASE.md` requires Prompt 020 to choose between typed FK columns with a
check constraint and separate per-type relationship tables, and forbids an unenforced
polymorphic `content_id`.

**Decision:** Use one relationship table per concept (`ratings`, `reviews`, `bookmarks`,
`view_events`) with nullable `drama_id` and `movie_id` foreign keys. A PostgreSQL `CHECK`
constraint enforces that exactly one of the two columns is non-NULL. Uniqueness uses partial
unique indexes for the active drama and movie cases. Foreign keys and checks are enforced in
both Drizzle schemas and SQL migrations; a generic `content_type` + `content_id` pair is not
used.

**Consequences:**

- Per-user and per-content queries remain in one table per relationship, without duplicate
  drama and movie tables.
- Every relationship row must set exactly one target; database constraints, not only
  application validation, enforce the invariant.
- Cross-module foreign keys are declared in SQL migrations, consistent with D-013 and
  `DATABASE.md` §2.4.
- Future content types require a new typed column and a new check constraint, not a generic
  polymorphic reference.

---

## D-021 — Canonical permission catalog and RBAC schema reconciliation

**Date:** 2026-11-10
**Status:** Approved by user
**Resolves:** Prompt 039 (authorization reconciliation and guards)

**Context:** The documented canonical permission model used `resource.action` keys, while the
Drizzle RBAC tables stored action/resource columns without a single enforced canonical key, and
the authorization module had no guard implementation. Reusable guards could not be trusted until
the catalog and schema were reconciled (Prompt 039, user-selected Option 2).

**Decision:** Adopt the canonical permission catalog in `src/modules/authorization/permissions.ts`
as the single source of truth (`resource.action` keys such as `drama.update`; `toPermissionKey`
composes keys and `PermissionKey` is a union type). The `permissions` table persists `resource` +
`action` columns with a unique constraint on `(role_id, resource, action)` and a check constraint
enforcing composed catalog keys; `user_roles` enforces a unique constraint on `(user_id, role_id)`.
Guards (`hasPermission`, `requirePermission`, `requireAnyPermission`, `requireUser`, `requireAdmin`,
`assertResourceAccess`) throw typed `AuthenticationError` (401) / `AuthorizationError` (403).

**Consequences:**

- One canonical permission identifier exists; no competing catalogs or ad-hoc permission
  literals exist outside the authorization module.
- Super Admin resolves to the complete catalog; effective permissions are the union of granted
  permissions across assigned roles, with `granted = false` as explicit revocation.
- Unauthenticated access fails with `401 authentication_required`; authenticated-but-unauthorized
  access fails with `403 forbidden` through the shared error mapping.
- Existing rows that satisfy the unique invariants required no data migration; only constraint
  additions were needed for the reconciled schema.

---

## D-022 — Super Admin bootstrap, session-creation gate, and initial migration baseline

**Date:** 2026-11-10
**Status:** Approved by user
**Resolves:** Prompts 033/034 (authentication) and Prompt 040 (migration baseline)
**Supersedes:** D-021's `user_roles` unique-constraint clause (replaced by the composite primary key below)

**Context:** Better Auth 1.7's canonical model and the application's session rules had to be
reconciled before the first migration. The database was empty, so there was no data to preserve.
Two decisions were required: how the first Super Admin is established without a public elevation
path, and how deactivated or soft-deleted users are prevented from continuing to use sessions.
The schema also had to be materialized as an ordered migration rather than an ad-hoc `push`.

**Decision:**

1. **Auth schema:** Use Better Auth 1.7's canonical `users`, `sessions`, `accounts`, and
   `verifications` model. TypeScript property names are Better Auth's camelCase field names;
   physical PostgreSQL columns are snake_case. The Drizzle adapter is configured with
   `provider: 'pg'`, `usePlural: true`, and the four auth tables. Because the pg adapter reports
   `supportsUUIDs: true`, Better Auth relies on the database default, so auth `id` columns use
   `uuid PRIMARY KEY DEFAULT uuidv7()`.
2. **Super Admin bootstrap:** Only the normalized `SUPER_ADMIN_EMAIL` may be promoted, only when
   no Super Admin exists, only in `databaseHooks.session.create.before`, and only inside a
   transaction holding `pg_advisory_xact_lock(4627001033)`. Promotion sets
   `users.is_super_admin = true`; it does not write roles. No self-service or user-targeted
   promotion endpoint exists.
3. **Session gate:** `databaseHooks.session.create.before` rejects session creation for missing,
   inactive (`is_active = false`), or soft-deleted (`deleted_at IS NOT NULL`) users. Because
   Better Auth's own `get-session` does not consult application status, every protected entrypoint
   uses `getActiveSession`, which re-reads the user row and returns `null` for a disabled account.
4. **Migration baseline:** Generate one baseline from the complete schema with
   `drizzle-kit generate` and apply it with `drizzle-kit migrate`. Application-owned primary keys
   emit `id uuid PRIMARY KEY DEFAULT uuidv7()`; `uuidPrimaryKey()` includes `.primaryKey()`.
   Join tables (`user_roles`, `drama_categories`, `drama_platforms`, `movie_categories`,
   `movie_platforms`, `similar_dramas`) use named composite primary keys instead of a separate
   unique constraint. `uuidv7()` requires PostgreSQL 18+.

**Consequences:**

- Deactivating a user blocks new sign-ins immediately and invalidates an existing cookie on the
  next protected request, even though Better Auth's `/api/auth/get-session` still returns it.
- A concurrent first sign-in cannot create two Super Admins; the advisory lock serializes the
  read-then-update. Promotion is idempotent.
- The Super Admin flag is not derived from a role name, so renaming or deleting roles cannot
  elevate or demote a user.
- The baseline is the single source of truth for schema creation. Integration tests build the
  `_test` database from the same migrations, so migration defects fail CI instead of hiding
  behind `drizzle-kit push`.
- PostgreSQL 18+ is a hard requirement; older servers cannot apply the baseline.
- If a future deployment already has an auth schema created outside migrations, it must be
  reconciled with a backup before the baseline is applied; the baseline is not idempotent.

---

## D-023 - Tailwind v4 and the public shell contract

**Date:** 2026-11-11
**Status:** Approved by user
**Resolves:** Public site repair after Prompts 042–044

**Context:** The application ran Tailwind 3.4 while the vendored shadcn
components were written for Tailwind v4. Unknown utilities silently emitted no
CSS, which removed button backgrounds, card surfaces, borders, and text colours.
The public navigation component existed but was never mounted, and the four
declared CSS variables did not cover the component library's contract.

**Decision:**

1. **Tailwind direction:** Use Tailwind v4 with `@tailwindcss/postcss` and the
   CSS-first configuration in `src/app/globals.css`. Do not reintroduce a
   JavaScript Tailwind config unless a future decision supersedes this one.
2. **Token contract:** `globals.css` owns the semantic tokens consumed by the
   component library (`background`, `foreground`, `card`, `popover`, `primary`,
   `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`) and
   maps them into `@theme inline`. Components must use semantic utilities, not
   raw palette classes.
3. **Dark mode:** The public site is dark by default. A `dark` class is applied
   on `<html>` so class-based `dark:` variants in vendored components resolve.
4. **Navigation ownership:** `PublicNavbar` is a client component responsible
   for the desktop header, the mobile bottom bar, and the slide-over menu.
   `PublicPageLayout` remains a Server Component and resolves guest/session
   state with a best-effort lookup that cannot fail the page.
5. **Home-only marketing:** Hero, browse tiles, and how-it-works render only on
   the home route. Catalogue pages own their content and heading.

**Consequences:**

- Any new component must use the semantic tokens; raw `bg-gray-*` / `text-white`
  pairs are not acceptable fallbacks.
- Base UI attribute variants must be written against the attributes the
  installed version actually emits (for example `data-[orientation=horizontal]`),
  not older shorthand attributes.
- Navigation changes are verified at 1440×900 and 390×844 in Chromium, including
  menu open/close and route transitions.
- The Playwright public-site spec is the regression gate for the shell and must
  fail if the header, bottom bar, or readable foreground colours disappear.

---

## D-024 - Footer links are database-backed information pages

**Date:** 2026-11-11
**Status:** Approved by user
**Resolves:** Prompt 045

**Context:** The public footer needs Terms, Privacy, Community Guidelines,
Copyright/DMCA, About, and Contact destinations. Hard-coding those URLs in a
component would scatter legal destinations across the codebase and give
administrators no way to edit, hide, reorder, or unpublish a page.

**Decision:**

1. **Single source:** `information_pages` in the `content` module owns the
   canonical slugs, titles, body content, publication status, footer visibility,
   and display order. Components never hard-code legal URLs.
2. **Canonical slugs:** `terms`, `privacy`, `community-guidelines`,
   `copyright-dmca`, `about`, `contact`. Only single-segment lowercase
   `a-z0-9-` slugs are valid public routes.
3. **Public route:** `/information/[slug]` renders published, non-deleted rows
   only. Missing, unpublished, deleted, and malformed slugs return `404`; draft
   content is never exposed through a guessed URL.
4. **Ordering:** `position integer` follows the existing ordering convention.
   Lower values render first and null positions sort last. Reordering runs in a
   single transaction.
5. **Footer layout:** Keep the existing Browse/Discover/Support columns and add
   a separate wrapping "Legal & information" row above the copyright line.
   The footer degrades to no legal links if the configuration cannot be loaded;
   it must not take down the page.
6. **Authorization:** Administration requires `settings.manage`, enforced at the
   REST entrypoint and re-checked in the content service. No admin UI is added
   by Prompt 045; the permission-protected API is ready for a future settings UI.
7. **Seed behavior:** Migration `0002_information_page_footer_links.sql` seeds
   exactly the six canonical pages as published, footer-visible placeholders
   with body `This page is being prepared.`. The seed is idempotent
   (`ON CONFLICT … DO NOTHING`) and never overwrites administrator edits.

**Consequences:**

- The placeholder body is explicit and is not legal advice. Administrators must
  replace it with real policy text before launch.
- Footer links only appear for rows that are simultaneously published,
  footer-visible, non-deleted, and validly slugged.
- Deleting or unpublishing a page removes its footer link without deleting the
  row, preserving history for administrators.
- The API is the control surface until an admin settings UI is approved.

---

## D-025 - Super Admin-only administration surfaces

**Date:** 2026-11-12
**Status:** Approved by user
**Resolves:** Prompt 050; implements `REQUIREMENTS.md` §8.9 and §8.1

**Context:** System Configuration (§8.9) is accessible only to Super Admin, and
role and permission management can grant or remove privileges. The Prompt 049
navigation model filtered by permission alone, so a custom role holding
`admin.manage` or `settings.manage` would have seen those entries once they were
implemented. A permission can be granted to any role; the Super Admin flag
cannot. Visibility is also not a boundary: the operations behind those entries
must be refused server-side.

**Decision:**

1. **Explicit flag:** `AdminNavEntry.superAdminOnly` marks a navigation entry as
   Super Admin-only. It is set on the System Configuration and Roles &
   permissions entries only; Information pages stays permission-based
   (`settings.manage` / `admin.manage`), and the System group as a whole is not
   Super Admin-only.
2. **Authoritative check:** `requireSuperAdmin(actor)` in
   `src/modules/authorization/guards.ts` checks `actor.isSuperAdmin`. It is not a
   permission check, so holding `admin.manage` or any other key is never a
   substitute. It throws `AuthenticationError` for anonymous actors and
   `AuthorizationError` for authenticated non-Super-Admins.
3. **Enforcement at every boundary:** navigation filtering hides the entry from
   non-Super-Admins regardless of permissions; the REST routes
   (`/admin/api/roles` for every action, `/admin/api/users` for
   `authorize-admin`) and the workflows (`workflows/admin/roles.ts` for all
   functions, `authorizeUserAsAdmin` in `workflows/admin/users.ts`) apply the
   same guard. Server-side authorization is the boundary; sidebar visibility is
   not.
4. **Admin-area permission union:** `ADMIN_AREA_PERMISSIONS` is derived from
   non-Super-Admin-only entries only, so a permission that exists solely on a
   Super Admin-only surface (currently `settings.read`) can no longer open the
   admin shell. Super Admin still enters via the flag.
5. **Out of scope:** System Configuration persistence, a settings API, and any
   change to last-Super-Admin protection are not part of this decision.

**Consequences:**

- A non-Super-Admin with `admin.manage` loses access to role and permission
  management and to administrator authorization, even though that permission
  previously allowed it.
- Ordinary user management (`deactivate-admin`, `reactivate-admin`) and
  `inspect-role` keep their canonical `admin.manage` requirement.
- A custom role holding only `settings.read` is denied entry to the admin area;
  it has no reachable section.
- Adding a Super Admin-only surface in future means setting `superAdminOnly` and
  guarding its route and service with `requireSuperAdmin`.

---

## D-026 - Admin data tables: URL state, page-level authorization, and the supporting index

**Date:** 2026-11-12
**Status:** Approved by user
**Resolves:** Prompt 051

**Context:** The admin shell had no way to list a collection. The first listing
(`/admin/users`) needed a shared table-state contract, a server-side query
path, and a decision about how an admin page answers an actor who reaches the
admin area but lacks the page's permission.

**Decision:**

1. **URL state:** All table state (page, page size, sort, search, filters)
   lives in the URL query string. Sorting and pagination are links; search and
   filters are GET forms. A search or filter change resets to page 1, and so
   does a sort change.
2. **Normalization:** An admin page normalizes an invalid query parameter
   instead of rejecting it, because §6.4 governs REST responses and a
   navigable URL must survive a stray parameter. The sortable-column
   allowlist is still enforced server-side; an unknown column never reaches
   SQL.
3. **Page-level authorization:** An authenticated actor with admin-area access
   but without the page's permission receives `notFound()` (404), extending the
   area-level rule established in Prompt 049 to a page-level permission. This
   is an intentional exception to `CONVENTIONS.md` §6.6, scoped to the admin
   area; no existing route's behavior changes and no `forbidden.tsx` or
   `experimental.authInterrupts` is introduced.
4. **Ownership:** The auth module owns the Drizzle query over its own `users`
   table and exposes it through its public API. The users module owns the
   admin projection and the `user.read` guard, in
   `modules/users/read-models/`. The auth module may not import the
   authorization module (§7.2, D-008), so `listUserAccounts` cannot take an
   `ActorContext`; the protected query is `listUsersForAdmin`.
5. **Supporting index:** The production listing query is served by a partial
   index on `users (created_at DESC) WHERE deleted_at IS NULL`. It serves the
   default scope and the default sort. It does not serve the `deleted` filter
   or the free-text search, and neither is claimed as covered.

**Consequences:**

- The admin area has one URL contract that every future table reuses.
- A shared or bookmarked admin URL reproduces the exact view, and an invalid
  one still renders.
- An actor without `user.read` cannot learn that `/admin/users` exists.
- The search remains an `ILIKE` scan until a query plan justifies a trigram
  index.

---

## D-027 — Super Admin email/password sign-in at a dedicated route

**Date:** 2026-11-14
**Status:** Approved by user
**Supersedes:** The "Google OAuth only" provider clause in `SECURITY.md` §3 and
`AGENTS.md` §1.2, **for the Super Admin account only**

**Context:** The platform's only operator could not sign in: Google OAuth was
the sole provider, and the Super Admin bootstrap depends on a Google identity.
The user explicitly requested a pure email/password login for the Super Admin,
with no Google involvement and no predictable URL, and chose to keep Google for
regular users.

**Decision:**

1. **Google stays for regular users.** The public sign-in page and Google
   provider are unchanged. No email/password registration, verification email,
   or password-reset flow exists (the project has no email infrastructure).
2. **Credential sign-in is Super-Admin-only by construction.** Better Auth
   `emailAndPassword` is enabled with `disableSignUp: true`, so
   `/api/auth/sign-up/email` always fails. The only credential account is the
   one the seed writes; no API or UI creates another.
3. **Provisioning is an explicit script.** `npm run db:seed:super-admin` reads
   `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`, then upserts the user
   (`is_super_admin = true`, `is_active = true`, `deleted_at = NULL`) and the
   `accounts` row (`provider_id = 'credential'`, `account_id = users.id`).
   Only Better Auth's scrypt hash is stored; the plaintext is never persisted
   by the application. Re-running resets the password idempotently under
   `pg_advisory_xact_lock(4627001034)`. The script never runs at build or
   startup.
4. **Dedicated route.** The form lives at `/vault-7x9k-console`, is absent from
   every navigation, and is `noindex, nofollow`. Anonymous admin requests are
   redirected there by `buildAdminSignInUrl`. The route is fixed by the file
   path; no environment variable can move a Next.js route, so none is used.
5. **Uniform failure.** Unknown email, wrong password, and deactivated account
   all return `Invalid email or password.` Better Auth rate-limits
   `/sign-in/email` to 5 requests per 60 seconds per IP in production.
6. **Session rules are unchanged.** Credential sign-in goes through the same
   `session.create.before` gate, so deactivated and soft-deleted accounts are
   still rejected; admin session inactivity and maximum-lifetime policy apply
   equally.

**Consequences:**

- The Super Admin does not depend on a Google identity or OAuth consent.
- Possession of both the hidden route and the credentials is required; neither
  is a substitute for the other, and neither is treated as authorization — the
  admin gate still checks the database (`is_super_admin`, `is_active`).
- Losing the password is recoverable only by re-running the seed with database
  access; there is no self-service reset.
- The plaintext password exists in `.env.local` (gitignored) because the seed
  reads it. Production should inject it as a one-off secret and remove it.
- Regular users still cannot obtain a password, so the account model stays
  OAuth-first for the public.

---

## D-028 — Standalone movies are an independent, API-first content type

**Date:** 2026-11-14
**Status:** Approved by user (Prompt 065)

**Context:** Prompt 065 requires creating and editing standalone movies with
metadata, categories, platforms, publication state, and a direct video source.
Movies must not be modelled as dramas with hidden seasons or episodes, and the
initial architecture excludes admin content UI in this prompt.

**Decision:**

1. **Movies are their own content type.** A movie row has no drama, season, or
   episode parent. No hidden season/episode rows are created for a movie.
2. **Scope is workflow + REST API + tests.** No `/admin/movies` pages are built
   in Prompt 065. The surface is `src/workflows/admin/movies.ts`,
   `POST/PUT /admin/api/movies`, and shared Zod contracts.
3. **The slug is explicit and required.** It is unique among non-deleted
   movies via `uq_movies_slug_active`; soft-deleted slugs may be reused.
   Slug changes append `content_slug_history` rows with
   `content_type = 'movie'`.
4. **The video source is an ordinary editable field.** It is optional/nullable
   on create and edit, must be an absolute HTTPS URL, and is never fetched,
   proxied, transcoded, or rehosted by the server. The supplied URL is not
   hidden from viewers. Preview, replacement confirmation, and playback-progress
   reset are deferred until the playback infrastructure exists (the playback
   schema is currently empty).
5. **Updates replace the full payload**, matching the drama contract:
   omitted images/video become `null` and associations are replaced in the same
   transaction.

**Consequences:**

- Movie administration is testable and usable through the API before any UI
  exists.
- The server never performs outbound media requests on behalf of an
  administrator, avoiding SSRF/unrestricted-fetch risk.
- Source-replacement guarantees from §5.7 cannot yet be honoured; they remain a
  future requirement once `playback_progress` exists.
- The navigation's Movies entry is marked implemented at the API level, like
  Dramas and Episodes; its `/admin/movies` page remains a future prompt.

---

## D-029 — Drama structure conversion is previewed, transactional, and snapshot-reversible

**Date:** 2026-11-15
**Status:** Approved by user (Prompt 066)

**Context:** `REQUIREMENTS.md` §4.6 requires administrators to convert a drama
between the season-based and flat episode structures without losing content
identity or user state. Episodes carry per-user viewing records, and the
existing content tables were created with a nullable `episodes.season_id` so a
flat drama is representable, but no operation existed to move a drama from one
structure to the other. Converting a live drama risks losing the previous
season structure, renumbering episodes against viewer history, or applying a
plan that was computed against a structure that has since changed.

**Decision:**

1. **Both directions are supported, drama→movie is not.** Season→flat merges
   the seasons into one ordered episode sequence and renumbers it
   sequentially; flat→season creates the seasons an administrator defines.
   Converting a drama into a standalone movie stays a future task. The drama's
   structure type changes only through this workflow: the ordinary drama
   update may repeat the stored value, but a different value is rejected with
   `409` and points at the conversion endpoint.
2. **Episode identity and viewing records are never rewritten.** Episode ids,
   titles, descriptions, publication status, and video sources survive both
   directions, so `playback_progress`, `watched_state`, `watch_history`, and
   `bookmarks` continue to point at the same episodes.
3. **The canonical season→flat ordering is deterministic:** season position,
   then episode position, then episode number, then creation time, then id.
   Episodes without a season are ordered after season-assigned episodes. An
   episode attached to a season that is not active has no place in the active
   structure, so it is treated as seasonless: it stays in the flat sequence,
   is stored in the snapshot with `season_id = null`, and is never dropped.
4. **Every conversion is previewed before it is applied.** The preview returns
   a SHA-256 fingerprint of the structure it planned; the apply must echo that
   fingerprint, and a mismatch is rejected with `409`. The apply runs in a
   serializable transaction with the drama row locked `FOR UPDATE`, and
   PostgreSQL `40001`/`23505` are mapped to `409`. The apply response is the
   plan shape plus `applied: true`, `newFingerprint`, `snapshotId`, and
   `snapshotStatus`.
5. **The season→flat direction stores an exact snapshot before it runs.** The
   snapshot keeps the season and episode structure needed to restore it.
   Restoring re-applies the snapshot's season rows, episode season assignment,
   episode numbers, and positions only — never titles, descriptions, sources,
   or viewing data. A snapshot is restorable only while the current active
   structure still matches the fingerprint recorded at conversion time. Any
   change to the active structure — an episode added, trashed, restored,
   reordered, renumbered, or reassigned — changes that fingerprint and the
   restore is rejected with `409`; the snapshot is kept in that case. The rule
   is fingerprint equality, not a change counter: a change that returns the
   structure to the recorded fingerprint (for example adding an episode and
   moving it to Trash again) leaves the snapshot restorable. A corrupted stored
   snapshot payload is a server error (`500`), never a stale-state conflict.
6. **One `available` snapshot per drama, history is never deleted.** A partial
   unique index enforces the single available snapshot. Converting again
   supersedes the previous snapshot in the same transaction as the conversion;
   restored and superseded snapshots remain as history.
7. **When an available snapshot exists, the administrator chooses explicitly.**
   A flat→season request must state `restore_snapshot` or `convert`; omitting
   the strategy is a `400`. `restore_snapshot` rejects any distribution input.
   `convert` supersedes the snapshot only after that explicit choice.
8. **The flat→season payload is a full distribution map.** Seasons carry a
   key, a title, and an optional position; assignments map every active
   episode to exactly one season key. Unknown, duplicate, trashed, and foreign
   assignments are rejected, and omitting the distribution synthesizes a
   single Season 1 holding every active episode. Trashed rows are ignored and
   left untouched in both directions.
9. **The surface is REST plus a minimal admin UI.** `POST
/admin/api/dramas/convert` and the `/admin/dramas` listing and
   `/admin/dramas/[id]/convert` page require `drama.manage`, enforced
   server-side on every entrypoint. The admin surface deliberately has no
   create, edit, delete, or publish controls. The navigation's Dramas entry
   uses `drama.manage` so it never links to a page the actor would be
   rejected from. When a snapshot can be restored, the panel presents the
   strategy choice without a preselected option and refuses to preview until
   the administrator chooses one.
10. **The admin content workflows write the content tables directly.** The
    admin workflows (`src/workflows/admin/{dramas,seasons,episodes,movies,conversion}.ts`)
    write `content` rows inside their own transaction instead of calling a
    content-module service for every statement. A conversion renumbers
    episodes, trashes seasons, and writes a snapshot atomically; splitting
    that across module APIs would break the single transaction. The domain
    rules stay in `modules/content`, and the workflow owns only the
    sequencing, the authorization check, and the transaction boundary. This
    is a recorded exception to the "workflow calls module APIs" rule
    (`ARCHITECTURE.md` §7.2, §8.2).

**Consequences:**

- A converted drama keeps its viewer history and can be returned to its
  previous season structure exactly, within the limits of the snapshot's
  restorability rule.
- The snapshot table adds one bounded table to the content module and one
  foreign key (`ON DELETE CASCADE`) to `dramas`; the first deliberate foreign
  key in the content hierarchy.
- A structure change between preview and confirmation is a conflict rather
  than a silent partial conversion; the administrator must preview again.
- Converting a drama to a movie remains unimplemented and is not implied by
  this decision.
- The admin content workflows set a precedent for admin mutations that span
  several content tables; a new workflow in that area may follow it, but the
  exception is recorded here rather than left implicit.

---

## D-030 — Drama→movie conversion creates a new movie and preserves provenance

**Date:** 2026-11-15
**Status:** Approved by user (Prompt 067)

**Context:** `REQUIREMENTS.md` §4.6 and §8.3 allow a drama that contains exactly
one episode to be published as a standalone movie. Prompt 066 deliberately left
drama→movie out of scope, and no schema relationship existed between a movie and
the drama it came from. Reusing the drama's UUID, hard-deleting the drama, or
leaving ratings and reviews attached to a trashed drama would break audit
history, the exactly-one content-target rule (D-020), and future Trash
lifecycle work.

**Decision:**

1. **Eligibility is exactly one active episode.** Zero or more than one active
   episode is a `409 Conflict` naming the actual count. Trashed episodes and
   trashed seasons are excluded and left untouched. A drama that was already
   converted is permanently ineligible (`409`), because provenance is unique
   and irreversible.
2. **The movie is a new content row with a new UUID.** The drama's UUID is
   never reused. `movies.converted_from_drama_id` is a nullable FK to
   `dramas.id` with `ON DELETE RESTRICT` and a partial unique index where it is
   not null, so one drama converts at most once and a movie blocks permanent
   deletion of its source. Provenance is permanent. The movie inherits the
   drama's `created_at`; `updated_at` is the conversion time.
3. **Content identity is copied, not moved.** Title, slug, description, poster,
   banner, categories, platforms, and the single episode's video source become
   the movie's. `draft`, `published`, and `unpublished` carry over unchanged; any
   other stored value becomes `draft` with a preview warning. The slug is
   copied verbatim: a conflict with another active movie is a `409` that names
   the conflicting slug and movie title, and it is never auto-suffixed. No
   writes occur on rejection.
4. **The drama, its seasons, and its episodes are soft-deleted in the same
   transaction.** No hard delete occurs anywhere in the workflow, so the source
   rows, ids, and metadata remain for audit and future Trash lifecycle
   handling. Reverse conversion (movie→drama) is not supported.
5. **Ratings and reviews gain a nullable `movie_id` and keep exactly one
   target.** `drama_id` becomes nullable, `movie_id` is added, and
   `ck_ratings_target` / `ck_reviews_target` enforce exactly one non-null target
   per D-020. Partial unique indexes cover `(user_id, drama_id)` and
   `(user_id, movie_id)`; content lookup indexes exist for both columns. Rows
   are reassigned in one statement (`movie_id` set, `drama_id` cleared), so
   nothing is left attached to the trashed drama. Reactions and reports
   reference `review_id` only and follow their review untouched; moderation
   state, timestamps, and soft-delete flags are preserved.
6. **User state follows the content.** Bookmarks, playback progress, watched
   state, and watch history move to the movie. `playback_progress.episode_id`
   and `watched_state.episode_id` become `NULL` because the episode is trashed;
   `watch_history.episode_id` is preserved as historical fact. Deleted rows move
   with their `deleted_at` intact.
7. **Polymorphic metadata moves only when it identifies the drama.** Slug
   history, SEO, assets, notifications, admin notifications, content view
   events, playback analytics events, and daily aggregates are rewritten from
   `content_type = 'drama'` to `content_type = 'movie'`. Rows whose type is
   `NULL` are not guessed. `similar_dramas` and
   `structure_conversion_snapshots` are intentionally untouched; movie
   recommendations are not a modelled relationship.
8. **Preview and apply share one fingerprint rule.** The SHA-256 fingerprint
   covers the drama fields that affect the movie, the episode id and video
   source, and the sorted category/platform ids. It excludes relationship
   counts and the slug-conflict lookup so concurrent viewing does not
   invalidate a preview; the slug conflict is rechecked inside the apply and
   enforced by the unique index. Apply requires the fingerprint and re-runs
   every eligibility check inside a serializable transaction after locking the
   drama and its active episodes `FOR UPDATE`; a mismatch, `23505`, or `40001`
   is a `409`, and the transaction leaves no partial conversion.
9. **The surface is REST plus a minimal admin page.** `POST
/admin/api/dramas/convert-to-movie`, the `/admin/dramas` listing, and
   `/admin/dramas/[id]/convert-to-movie` require `drama.manage`, enforced
   server-side at every entrypoint. The listing renders **Convert to movie**
   only when `activeEpisodes === 1`; the page previews the resulting movie and
   asks for explicit confirmation. Full movie management UI is out of scope.
10. **Module ownership is preserved across the transaction.** The `reviews`,
    `users`, `notifications`, and `analytics` modules export narrow
    content-ownership services that accept the workflow's transaction; the
    `content` module owns the plan and fingerprint; the workflow owns
    authorization and the transaction boundary. This extends the D-029 admin
    content workflow exception to `movie-conversion.ts`; it does not create a
    general cross-module write pattern.

**Consequences:**

- A drama can become a movie without losing ratings, reviews, reactions,
  bookmarks, viewing history, notifications, or analytics.
- The source drama remains recoverable from the database for audit, but the
  application exposes no restore path and `ON DELETE RESTRICT` prevents
  deleting it while the movie exists.
- `ratings` and `reviews` become dual-target tables, matching the D-020 pattern
  already used by bookmarks and analytics; any future review query must filter
  on the target it means.
- The conversion is intentionally one-way. Returning the movie to a drama
  requires a new decision and a new migration.
- The admin content workflows now cover a cross-module conversion; the
  transaction boundary and the narrow ownership services are the recorded
  exception, not a precedent for arbitrary cross-module writes.

---

## D-031 — Role, permission, and account administration is method-correct, actor-first, and Super-Admin-scoped

**Date:** 2026-11-17
**Status:** Approved by user (Phase 3 of the production remediation plan)
**Resolves:** H-03, H-18, SCOPE-A06, TEST-07; supersedes the transport shape
described for these surfaces in D-025 §4 and `docs/development/admin-shell.md`
§4.2. D-025's rule — that restricted management stays Super-Admin-only — is
unchanged and reaffirmed here.

**Context:** The administration API exposed every mutation through `GET` with an
`?action=` query parameter on `/admin/api/roles` and `/admin/api/users`. The
workflows resolved the actor themselves and returned `{ success: true }` without
touching a table, so a passing test proved nothing about roles, permissions, or
account state. The `roles`, `permissions`, and `user_roles` tables had no
persistence layer at all: there was no code that wrote a role, granted a
permission, or assigned a role to a user. The permission catalog used
`similar-drama.manage`, whose resource segment violates the lowercase
snake_case rule that every other catalog key follows, and the applied database
`CHECK` constraint did not allow it, so the drill-down permission could never
have been stored.

**Decision:**

1. **Role and permission persistence is real and owned by `authorization`.**
   `src/modules/authorization/roles.ts` owns writes to `roles`, `permissions`,
   and `user_roles`, and exposes them through the module's public API. Callers
   receive small projections, never Drizzle rows.
2. **Workflows are actor-first.** `src/workflows/admin/roles.ts` and
   `src/workflows/admin/users.ts` take the resolved actor as their first
   argument and re-check the guard at the service layer. A workflow no longer
   resolves the actor itself, so no entrypoint can pass an actor it did not
   resolve server-side.
3. **The authorization split is explicit.**
   - Role and permission management — create, rename, delete, replace the
     permission set — is Super Admin only, because it grants and removes
     privileges.
   - Assigning or revoking a role is Super Admin only, for the same reason.
   - Reading one account's role assignments keeps the canonical `admin.manage`
     requirement.
   - Reading the assignments for the admin user listing keeps the canonical
     `user.read` requirement, so the listing stays readable for an actor that
     may not change anything.
   - Changing an account's status keeps the canonical `admin.manage`
     requirement, but a Super Admin account can only be changed by a Super
     Admin.
4. **`super_admin` is a reserved role name.** Super Admin is the authoritative
   `is_super_admin` flag on the account, not a role grant. Role names are
   lowercase snake_case (`[a-z][a-z0-9_]*`), so a role name can be used in code
   and in a URL without an escaping rule.
5. **A revoked permission keeps its row with `granted = false`,** and
   `setRolePermissions` replaces the whole granted set atomically. A role is
   never half-applied.
6. **A role with user assignments cannot be deleted** (`409 Conflict`); a role
   is deleted together with its permission rows.
7. **The REST contract is method-correct.** `GET` reads, `POST` creates or
   assigns, `PATCH` updates, `PUT` replaces a permission set, and `DELETE`
   removes. No state-changing `GET` remains. A `DELETE` answers `204` with no
   body. The shared route helpers live in `src/platform/Http/admin-route.ts`.
8. **The last active Super Admin cannot be deactivated.** The invariant lives
   in the `auth` module, which owns the `users` table, and is enforced inside a
   transaction that locks the active Super Admin rows `FOR UPDATE` in a stable
   order, so it holds under concurrency. Deactivation blocks access immediately
   because the actor resolver reads `is_active` from the database on every
   request; session invalidation is not part of this decision.
9. **The permission catalog key is `similar_drama.manage`.** The applied
   `CHECK` constraint is replaced by a forward-only migration that drops the
   old check, updates the stored resource, and re-adds the check. The same
   migration sets the `dramas.visibility` default to `coming_soon`: the initial
   migration created the column as nullable `text` without a default, so the
   database and the schema disagreed. Existing `NULL` values are preserved and
   read as "not hidden"; the migration does not rewrite stored rows.
10. **The administration pages are real.** `/admin/roles` is Super Admin only
    and answers `notFound()` for every other actor. The `/admin/users` listing
    shows each account's role assignments and offers the role and account
    status controls. Both use client islands that call the REST endpoints; the
    server pages own authorization and the first read.

**Consequences:**

- Navigation visibility and server-side enforcement now agree: a role that
  holds `admin.manage` no longer sees the Roles entry, because the entry is
  Super-Admin-only, and it cannot reach the endpoints either.
- The `GET /admin/api/roles` and `GET /admin/api/users` action dispatchers are
  removed. Any client that used them must move to the matching method.
- The role and permission tables hold real data, so the effective permission
  set of an administrator is the union of the permissions of the roles actually
  assigned to it.
- A custom role can grant a permission its holder does not have. This is
  deliberate: only a Super Admin can create or change a role, and a Super
  Admin already holds the complete catalog.

---

## D-032 — Database-enforced content integrity, typed targets, and preview-bound conversion

**Date:** 2026-11-17
**Status:** Approved by user (Phase 4 of the production remediation plan)
**Resolves:** H-04, H-05, H-06, H-07, H-08, H-09, M-01, M-02, M-07, M-08,
SCOPE-D01, SUP-01, TEST-03. Extends D-020 (typed relationships) and D-030
(drama → movie conversion) without changing either of their outcomes.

**Context:** The schema assumed a hierarchy it did not enforce. `seasons` and
`episodes` carried a free-text `drama_id`, an episode could name a season of
another drama, and duplicate episode numbers and season positions were
possible. Association sets were replaced in several statements, so a partial
replacement could be persisted. The user-content tables and the analytics
tables stored a polymorphic `content_type`/`content_id` pair, which cannot
carry an ordinary foreign key, while D-020 forbids that pair in the final
model. The drama → movie conversion moved only the legacy pair, so a typed
target stayed behind on the trashed drama. A conversion preview proved that
the source structure had not changed but not that the plan being applied was
the plan that was previewed. `published_at` did not exist, so a listing could
not order by first publication. A review report recorded no description, no
resolver, no outcome, and — because the row was cascaded away with its
review — no durable moderation history.

**Decision:**

1. **The database enforces the content hierarchy.** `seasons.drama_id` and
   `episodes.drama_id` reference `dramas.id`; the composite
   `episodes(drama_id, season_id)` references `seasons(drama_id, id)`, so an
   episode cannot name a season of another drama. Content references are
   `ON DELETE RESTRICT`: permanently removing content is an explicit Super
   Admin action, never a silent cascade.
2. **Numbering and positions are scoped and unique.** Episode numbers are
   unique per drama and season positions are unique per drama, both among the
   active rows. Episode numbering is **drama-wide**: Season 2 continues after
   Season 1, and moving an episode between seasons never renumbers it.
   Allocation happens under a lock on the parent drama row, and a renumbering
   rewrite is two-phase (`NULL` first) so the unique index cannot be violated
   halfway through.
3. **The integrity constraints land in the `NOT VALID` posture.** Foreign
   keys and CHECK constraints are added `NOT VALID` and the unique indexes are
   created in guarded blocks, so a migration always lands on a populated
   database. New and updated rows are enforced immediately; historical rows
   are reconciled by the operator and then validated with
   `npm run db:integrity -- validate`. Two constraints are the exception and
   are validated from the start, because no pre-existing row can violate them:
   `ck_review_reports_status` (the `status` column is new and defaulted to
   `active`, so every legacy row already satisfies it) and
   `uq_seasons_drama_id_id` (the composite is always satisfiable, because
   `seasons.id` is already unique).
4. **Typed targets cover users and analytics.** `bookmarks`,
   `playback_progress`, `watched_state`, `watch_history`,
   `content_view_events`, and `playback_analytics_events` name exactly one
   content item through `drama_id`/`movie_id`. `analytics_daily_aggregates` may
   name none, because a site-wide aggregate legitimately has no content, but
   never both. The legacy `content_type`/`content_id` pair is kept — it is
   still the only evidence for rows that cannot be placed — and the typed
   target wins whenever the two disagree.
5. **Only unambiguous legacy rows are backfilled.** A row is backfilled when
   its legacy type names a table, its id exists there, and the id does not
   also exist in the other table. Every other row is listed, read-only, by
   `npm run db:integrity` and is never guessed.
6. **The conversion moves the typed target and merges what it would
   duplicate.** The typed target is authoritative; a row without any typed
   target falls back to the legacy pair, and a row is counted once. When two
   rows of one user would end up on the same target, they are merged before
   the move: bookmarks keep one row per user; playback progress keeps the
   resume point of the most recently watched row and is complete when any
   merged row was complete; watched state keeps the most watched minutes, is
   complete when any merged row met the threshold, and carries the earliest
   completion and the latest reset; watch history stays append-only and keeps
   its episode id. Daily aggregates of one date are merged: the counters add
   up and the visitor count takes the larger value, because the overlap
   between two rows is unknown.
7. **`published_at` records the first successful publication.** It is set on
   the first publication and never rewritten: an ordinary edit, an unpublish,
   and a later republication all preserve the original instant. Existing
   published rows keep `NULL` — no date is invented — and the Recently Added
   listing, which is built in Phase 8, orders by
   `published_at DESC NULLS LAST, created_at DESC`.
8. **A conversion apply is bound to the previewed plan.** The preview returns
   a `planDigest` over the whole plan — target structure, strategy, seasons,
   episode assignments, numbers, positions, and the source fingerprint. An
   apply request must carry that digest; the server rebuilds the plan from the
   locked state and rejects a mismatch with a conflict. The fingerprint alone
   is not enough: it proves the source did not change, not that the
   distribution was not edited after the preview.
9. **A review report records its full state.** An optional `description`, the
   moderator who resolved it (`resolved_by`), the `resolution_outcome`, the
   submission time (`reported_at`), and a lifecycle rule: an active report
   carries no resolution record, a resolved report carries a complete one.
   `reported_at` is `NULL` for reports that predate the column, because their
   real submission time cannot be reconstructed. The reason stays free-text
   until the moderation service of Phase 8 enforces the documented vocabulary.
10. **Report history outlives the review.** `review_reports.review_id` is
    `ON DELETE RESTRICT`: permanently removing a review that has reports is
    blocked until a moderator resolves them.

**Consequences:**

- The migrations are forward-only. `0009` adds the hierarchy, the typed
  user-content targets, the rating range, and `published_at`; `0010` extends
  them with the analytics targets, the report state, and the `restrict` review
  reference. Neither drops a column that holds data, and neither edits an
  applied migration.
- Because a `NOT VALID` CHECK is enforced on new and updated rows, the
  migration and the application release that relies on the typed columns ship
  together. A release that still writes the legacy pair only is rejected by
  the database after the migration; this is a deliberate consequence of
  enforcing new writes immediately.
- The daily aggregate has no unique `(date, target)` index yet. The phase
  that builds the analytics write path adds it, after the data has been
  audited for duplicates.
- The moderation service itself is Phase 8. The state it will write is
  enforced by the database now, so the service cannot record a half-resolved
  report.
- The Recently Added listing is also Phase 8. Phase 4 provides the timestamp
  and the ordering rule; the listing that uses them is not built yet.
- The operator command never aborts on a legacy row it cannot place. A row
  whose unique key is already taken, or whose other foreign keys are broken,
  is left untouched and listed by the report, so a single bad row cannot roll
  back the placements that did succeed.

## D-033 — Admin category, platform, season, and episode management without a new dependency

**Date:** 2026-11-18
**Status:** Approved by user (Task 8 of the admin content-management plan)
**Extends:** D-032 (the content hierarchy it enforces is now editable in the
admin panel).

**Context:** The admin panel could create and edit dramas, but a first playable
drama still required SQL: categories and platforms had no admin UI, and seasons
and episodes had no management surface at all. The taxonomy REST routes were
read-only, so content could not be assembled through the panel.

**Decision:**

1. **No new dependency, no migration, no taxonomy REST route.** Content
   administration rides the existing Server-Action transport, the existing
   Drizzle schema, and the existing permission catalog. The taxonomy REST
   routes stay read-only.
2. **Depth is create + edit + soft delete (+ reorder).** Categories and
   platforms support create, edit, and soft delete with a Move up/down reorder.
   Seasons and episodes live on `/admin/dramas/[id]` and support create, edit,
   soft delete, and (for seasons) reorder; episode numbering stays drama-wide.
3. **Slugs are derived from names.** A category/platform slug is derived from
   its name server-side and never typed by the administrator, matching the
   drama form. A blank-name slug is rejected.
4. **Soft delete only.** Trashed rows keep their rows and are excluded from
   admin and public listings; nothing is hard-deleted from the admin panel.
5. **Every page and action re-checks canonical permissions.** `/admin/dramas/[id]`
   requires `drama.manage`; the season and episode sections are additionally
   gated on `season.manage`/`episode.manage`. Each Server Action resolves the
   actor and re-checks its guard.
6. **Category `visibility` is `visible`/`hidden`, default `visible`.** A hidden
   category is excluded from public listing but remains manageable.
7. **Episodes stay `draft` when created through the panel.** Publication is a
   separate, later workflow; the admin panel never auto-publishes.
8. **A season change is a plain partial update.** Deviating from the plan's
   Task 7 step 3, `updateEpisodeAction` does **not** call
   `moveEpisodesToSeason` after a season change; it keeps the episode position
   and only updates the changed fields. `moveEpisodesToSeason` is not imported
   by the episode Server Actions.

**Consequences:**

- Content can be assembled end-to-end in the panel: a platform, a category, a
  drama, a season, and an episode.
- Soft-deleted content is recoverable in principle (rows preserved) but there
  is no restore UI yet; restore is deferred.
- The taxonomy REST routes remain read-only, so programmatic write access to
  taxonomy still requires a Server Action or SQL.

---

## D-034 — Empty-drama visibility is a deployment constant with a stricter per-drama override

**Date:** 2026-11-22
**Status:** Approved by user (Prompt 070)
**Extends:** D-032 (publication availability is evaluated in one place).

**Context:** Prompt 070 requires a global setting for how a drama without a
playable episode appears publicly: "Show Coming Soon" (poster, title, and
description, but no Play button or episode list) or "Hide Until Episodes
Available". The rule has to be decided in two places — the catalogue query and
the per-drama detail view — and the two must never disagree.

**Decision:**

1. **The global mode is an environment value, not an admin setting.**
   `EMPTY_DRAMA_VISIBILITY` accepts `coming_soon` (default) or `hidden`. It is
   read from the validated server configuration, so it is part of the
   deployment profile and is covered by the existing configuration tests.
2. **A per-drama `visibility = 'hidden'` is always the stricter rule.** It
   hides the drama even when the global mode is `coming_soon`. A per-drama
   `coming_soon` never overrides a global `hidden`: a deployment that hides
   empty dramas does not get empty dramas back one drama at a time.
3. **The effective rule is "hidden" if the global mode is `hidden` OR the
   drama's own visibility is `hidden`.** Otherwise the drama is visible as
   coming soon.
4. **The SQL mirror states the positive condition.** The catalogue predicate
   is `(dramas.visibility is distinct from 'hidden')`, not
   `not (dramas.visibility = 'hidden')`. A negated comparison is NULL — not
   TRUE — when the column is NULL, and a NULL predicate silently drops the
   row. `IS DISTINCT FROM` keeps a NULL visibility on the visible side, which
   is exactly what the shared TypeScript rule does.
5. **A drama with a playable episode is always visible**, regardless of the
   mode: the "empty" condition is part of the predicate, not a permanent
   state.

**Consequences:**

- The public catalogue, the public API, and the drama detail page agree by
  construction, because both read the same shared rule
  (`src/modules/content/public-dramas.shared.ts`) and the catalogue mirrors it
  in SQL.
- Changing the mode is a deployment change, not a content operation. There is
  no admin toggle and no audit trail for it.
- A per-drama `hidden` value is the only content-level control, and it is
  intentionally one-directional: it can only hide more.

---

## D-035 — Publication is explicit, per-item, and reported item by item

**Date:** 2026-11-22
**Status:** Approved by user (Prompts 068–069)
**Extends:** D-032 (publication availability rules).

**Context:** Prompts 068–069 require manual publish/unpublish for dramas,
seasons, episodes, and movies, a bulk operation for Content Managers, and an
explicit report of what was skipped and why. Publishing a parent must never
publish invalid child content.

**Decision:**

1. **Publication is never implicit.** Creating or editing content never
   changes its publication state, and publishing a parent does not publish its
   children. Each item's state is set by an explicit operation.
2. **An episode is publishable only when it has a valid playback source.**
   The check is server-side and re-evaluated per item, never from the client.
3. **Eligibility is decided per item inside the operation.** An ineligible
   item is skipped and reported with a machine-readable reason
   (`missing_video_source`, `already_published`, `already_unpublished`,
   `trashed`, `invalid_id`, `duplicate_id`); the rest of the batch still
   succeeds.
4. **Bulk operations are batched and transactional per batch.** The batch
   size is bounded, and each batch locks its rows, so a large selection never
   holds a lock on the whole content table and concurrent operations
   serialize per item.
5. **The bulk surface is a dedicated admin page.** `/admin/publication`
   offers type tabs, search, pagination, checkbox selection, bulk
   publish/unpublish, and the per-item skip report. It does not live on the
   drama list, because a publication decision is about a content set, not
   about one row.

**Consequences:**

- A partially valid selection is safe: the administrator learns exactly which
  items did not change and why.
- Publishing a drama does not make its episodes visible; the hierarchy has to
  be published deliberately, item by item.
- The reported reasons are stable identifiers, so the UI and the API can
  present them without parsing prose.

---

## D-036 — Similar-drama suggestions are scored and never auto-persisted

**Date:** 2026-11-22
**Status:** Approved by user (Prompt 071)
**Extends:** D-033 (administrator control over content metadata).

**Context:** Prompt 071 asks for similar-drama recommendations generated from
shared categories, platforms, and relevant metadata, combined with manual
administrator control over the result.

**Decision:**

1. **The automatic suggestions are a recommendation aid, never an automatic
   write.** The system never persists a suggestion by itself; a Content
   Manager reviews the scored candidates and adds the ones they want.
2. **The score is a fixed, documented weighting.** Shared categories score 3,
   shared platforms 2, a matching production status 1, and a matching
   structure type 1. Categories dominate because two dramas in the same genres
   are the natural pairing.
3. **A candidate that shares nothing scores nothing and is not offered.** An
   empty suggestion list is more useful to an administrator than an arbitrary
   one.
4. **A drama can never recommend itself**, and a duplicate recommendation is
   refused.
5. **The scoring rules are pure.** They live in
   `src/modules/content/similar-dramas.shared.ts` without database or HTTP
   concerns, so they are unit-tested independently of the admin module and
   reusable outside it.
6. **Manual recommendations keep an explicit order.** The administrator
   reorders them, and the stored order is what the public site reads.

**Consequences:**

- The public site never shows an unvetted recommendation.
- The scoring weights are part of the contract: changing them changes the
  ranking administrators rely on, so they live in one exported constant.
- The relevance signal stays explainable — every suggestion can state how
  many categories and platforms it shares.

---

## D-037 — The content Trash is a timestamped cascade with Super-Admin-only permanent deletion

**Date:** 2026-11-22
**Status:** Approved by user (Prompts 072–074)
**Extends:** D-030 (movie provenance), D-031 (Super-Admin-scoped surfaces),
D-033 (soft deletion in the admin panel).

**Context:** Prompts 072–074 require a recoverable soft deletion for dramas,
seasons, episodes, and movies, with role rules for restoration and permanent
deletion, dependency checks before irreversible operations, and a retention
period that does not introduce a worker or a queue.

**Decision:**

1. **Trashing a parent cascades with one timestamp.** The drama, its seasons,
   and its episodes receive the *same* `deleted_at` value in one transaction.
   That timestamp identifies the cascade, and restoration uses it to restore
   exactly the children that were trashed with the parent. A child trashed
   earlier keeps its own timestamp and stays in the Trash.
2. **Moving content into the Trash and restoring it requires the manage
   permission of the content type.** An authorized non-Super Admin Content
   Manager may do both.
3. **Permanent deletion is Super Admin only, including the bulk form.** There
   is no permission key that grants it to another role.
4. **Permanent deletion requires the content to be in the Trash.** It is the
   second step of the lifecycle, never a shortcut for it.
5. **Personal records are removed; ratings and reviews are retained but
   anonymized.** Bookmarks, playback progress, watched state, and watch
   history are removed with the content. A rating or review keeps its value
   and text for aggregate analytics, but loses its author (`user_id = NULL`),
   its content target, and gains `anonymized_at`. Migration `0011` relaxes
   the target checks so that only an anonymized row may have no content
   target.
6. **A drama that was converted into a movie cannot be permanently deleted.**
   `movies.converted_from_drama_id` is permanent provenance with
   `ON DELETE RESTRICT`; deleting the source would destroy the provenance of
   an existing movie, so the operation is refused with a conflict.
7. **Expiry is a short-lived systemd-triggered command, not a worker.** The
   retention period is configurable (`TRASH_RETENTION_DAYS`, default 30 days).
   The command processes bounded batches, skips a parent whose children have
   not expired yet, and writes one JSON object per line for `journald`.
8. **Every irreversible operation is previewed first.** The Trash surface
   reports the affected child records and the per-record impact before the
   confirmation.

**Consequences:**

- Trashed content is recoverable with its hierarchy intact, and a child that
  was trashed separately is never restored by accident.
- The data-retention rule is explicit and enforced in the database, not only
  in application code.
- There is no background worker, no queue, and no scheduler inside the
  application; the systemd timer owns the schedule.
- Permanent deletion cannot be delegated to a custom role, and it cannot
  destroy a converted movie's provenance.

**Amendment (2026-11-22, Prompts 072–074 review):**

The implementation review tightened four points of this decision without
changing it:

1. **The anonymization rule is enforced by the database.** Migration
   `0012_anonymized_rows_have_no_author.sql` adds
   `ck_ratings_anonymized_author` and `ck_reviews_anonymized_author`:
   `anonymized_at IS NULL OR user_id IS NULL`. A rating or a review that
   carries the anonymization marker can never keep its author, so point 5 is
   a database invariant and not only an application convention.
2. **The expiry command is atomic per candidate.** Each candidate is removed
   in its own transaction: the row is locked with `FOR UPDATE`, `deleted_at`
   is re-checked under that lock, and the whole hierarchy is removed in that
   one transaction. A candidate whose drama is the source of an existing movie
   is skipped, because the movie keeps permanent provenance (point 6).
3. **Restoration refuses a hierarchy conflict before it writes anything.** A
   conflicting slug, episode number, or season position is reported as a
   conflict, never resolved by an automatic rename.
4. **Permanent deletion re-checks the Trash state under the row lock.** A
   restoration that races the deletion therefore cannot be overwritten by a
   delete that was already in flight.

---

## D-038 — Original artwork is stored on the application disk and delivered unprocessed

**Date:** 2026-11-22
**Status:** Approved by user (Prompts 075–078)
**Extends:** D-019 (server configuration contract), and the project restriction
that forbids Sharp and Next.js image optimization.

**Context:** Prompts 075–078 require image storage on the persistent
application-server disk, safe poster and banner uploads, and direct delivery
with cache headers — without a server-side image-processing pipeline.

**Decision:**

1. **The uploaded original is stored byte-for-byte.** There is no Sharp, no
   resizing, no conversion, and no optimisation. The browser receives the
   exact original file.
2. **Storage lives in a configured directory outside the deployment
   artifacts.** `IMAGE_STORAGE_DIR` (default `storage/images`) holds
   `{kind}/{uuid}.{ext}` files. The directory is outside `src` and `.next`,
   so an ordinary deployment does not delete uploaded artwork, and it is
   excluded from version control.
3. **Filenames are server-generated and immutable.** A UUIDv4 name plus the
   extension derived from the validated MIME type means the client never
   influences the path, the file is written with an exclusive-create flag, and
   a stored file is never overwritten.
4. **Uploads are validated on the server, from the bytes.** The declared
   MIME type, the file signature, the file size (5 MB maximum), and the pixel
   dimensions are all checked server-side. A poster must be portrait and a
   banner must be landscape, so portrait artwork cannot be stretched into a
   banner.
5. **Delivery is a dedicated route, not an image optimizer.**
   `/media/{kind}/{uuid}.{ext}` serves the stored file with its own content
   type, `Cache-Control: public, max-age=31536000, immutable`,
   `X-Content-Type-Options: nosniff`, and
   `Cross-Origin-Resource-Policy: same-origin`.
6. **The delivery route accepts only the managed path shape.** Exactly two
   segments, a known kind, and a filename matching the managed pattern. The
   route cannot be used to read application source, configuration, or any
   other filesystem path; traversal is rejected before any file access.
7. **Poster and banner are separate assets.** A poster is never reused as a
   banner, and each kind has its own directory.

**Consequences:**

- The delivery headers are safe because the filename never changes: a new
  upload gets a new URL.
- A deployment must keep `IMAGE_STORAGE_DIR` outside the release directory,
  or point it at persistent storage.
- The image service is intentionally not able to produce thumbnails; a future
  requirement for them is a separate decision, not an extension of this one.
- Nothing in the application server fetches an administrator-supplied URL to
  validate it, so there is no SSRF surface in the upload path.

**Amendment (2026-11-22, Prompts 075–078 review):**

Point 2 stated the rule but not a default that satisfies it. The default is
now platform-aware:

1. **`IMAGE_STORAGE_DIR` is platform-aware.** Without an explicit value, a
   production Linux deployment uses `/var/lib/dramascan/images` — the systemd
   state directory of the `dramascan` service (`StateDirectory=dramascan`) —
   and every other environment uses `<working directory>/storage/images`. The
   reason is point 2: the default has to survive a deployment that replaces
   the release directory.
2. **A production deployment may not point `IMAGE_STORAGE_DIR` inside the
   application directory.** Such a value is rejected at startup instead of
   being accepted silently, because the directory is deleted together with the
   previous release. The rule is stricter than the `src`/`.next` exclusion in
   point 2 and applies to production only.

---

## D-039 — Direct external MP4 playback, preview-gated replacement, subtitles, and failure reports

**Date:** 2026-11-23
**Status:** Approved by user (Prompts 080–090)
**Extends:** D-000 (specification authority), D-008/D-009/D-011 (module
boundaries and data ownership), D-019 (server configuration contract), and the
project restriction that forbids a video proxy, a rehost, transcoding, and
upload infrastructure.

**Context:** Prompts 080–090 require an episode to carry a public, direct
HTTPS MP4 URL that the browser plays, an administrator preview that proves
playability before the URL is stored, a transactional source replacement that
resets viewer progress without rewriting history, viewer-facing failure
handling with administrator visibility, per-episode subtitle tracks, and the
removal of every remnant of a video-upload pipeline.

**Decision:**

1. **One URL, one column, no pipeline.** `episodes.video_source` holds the
   administrator-supplied, direct HTTPS MP4 URL. There is no claim id, provider
   id, upload record, staging path, transcoding metadata, or second copy of
   the source anywhere in the schema.
2. **Syntax validation is server-side; playability is a browser fact.** The
   server validates the URL (HTTPS, well-formed, no embedded credentials, a
   direct MP4 path) and never issues an HTTP request against it, so there is
   no SSRF surface. The preview is what establishes that the file plays. A
   `.mp4` suffix and a successful save are never presented as proof. The
   preview requests the media with `crossorigin="anonymous"`, exactly like
   the viewer's player, so a host without CORS headers fails the preview
   instead of passing it and failing for every viewer.
3. **The preview gate is the browser preview plus the administrator's
   confirmation.** The server cannot observe browser playback, so it cannot
   be the gate by itself. Storing a source is therefore an explicit,
   administrator-confirmed browser action, and the server re-validates and
   records the event.
4. **Playback is direct, from the browser to the external host.** Vidstack
   plays the stored URL as-is. The application server never fetches, proxies,
   relays, or rehosts it.
5. **A source replacement is one transaction.** `replaceEpisodeVideoSource`
   updates the episode, resets every viewer's playback position to zero and
   the episode to unwatched, and writes the operational record as a single
   unit. The episode id, title, description, thumbnail, hierarchy, reviews,
   ratings, and other relationships are preserved. Watch-history rows and their
   historical dates are preserved: history records what somebody watched and
   when, and replacing a source does not rewrite the past.
6. **The ordinary episode edit cannot change the source.** `updateEpisode`
   refuses a changed `video_source`, and the episode edit form does not submit
   the field. Replacement is a separate, confirmed operation with its own
   audit trail — otherwise a routine metadata edit could silently invalidate
   every viewer's progress.
7. **Failure handling is manual and non-destructive.** The viewer gets a clear
   message and a manual retry. There is no automatic retry, URL search,
   repair, provider switching, or background retry, and the stored source is
   not changed by a viewer-side event. Administrators see viewer-reported
   failures; the platform does not claim that every failure is detectable
   server-side.
8. **Subtitles are external files, fetched by the browser.**
   `subtitle_tracks` stores the language tag, label, format, default-track
   selection, and a validated direct source URL per episode. The server never
   fetches, transcodes, or converts a subtitle file. The format set is closed
   (`vtt`, `srt`, `ssa`, `ass`, `json`) so the player only ever receives a
   format it understands.
9. **CSP separates the media policy from the others.** `media-src` and
   `connect-src` list the trusted media origins and never use `*`; image,
   script, and style directives stay separate. `MEDIA_ALLOWED_HOSTS` pins the
   approved origins — an empty value means any HTTPS origin, which is
   appropriate for development and must be pinned in production. The policy
   carries a per-request nonce, so `script-src` needs no `unsafe-inline`.
10. **The upload pipeline is gone and stays gone.** A repository-wide
    architectural guard fails the suite if upload endpoints, staging
    directories, temp video storage, multipart or resumable upload code,
    upload progress, upload retries, upload cleanup, transcoding, processing
    workers, or a video proxy/relay/rehost reappear. Poster and banner image
    uploads are explicitly outside the guard: image storage is a separate,
    approved feature (D-038).
11. **Vidstack is kept, despite upstream deprecation.** The project
    specification pins Vidstack and Prompt 085 names it. `@vidstack/react` and
    `vidstack` are deprecated in favour of Video.js 10, but switching players
    is an explicit upgrade, not a side effect of this work. The migration is
    recorded in the future-upgrade backlog.

**Consequences:**

- The platform cannot repair an external host that does not support CORS or
  byte-range requests. The preview exists precisely so the administrator finds
  that out before the source is stored.
- Media URLs are visible to viewers and can be shared. There is no DRM and no
  URL protection; the platform does not claim otherwise.
- The `users` module owns `playback_progress` and `watched_state` in the
  current code base, so the progress write service lives there. The target
  architecture places those tables in `playback`; aligning code and
  documentation is a separate ownership refactor (see D-040).
- `MEDIA_ALLOWED_HOSTS` must be set in production. An empty value leaves the
  media policy open to any HTTPS origin.

---

## D-040 — Progress writes live in the users module and use one configured completion threshold

**Date:** 2026-11-23
**Status:** Approved by user (Prompts 080–090 implementation)
**Extends:** D-008 (module boundaries), D-011 (data ownership), D-013
(database conventions), and `REQUIREMENTS.md` §7.3.

**Context:** The direct-video workflow needs to store a viewer's playback
position and mark the episode watched. `playback_progress` and `watched_state`
are defined in `src/modules/users/schema.ts`, and the dependency matrix forbids
`playback → users`. The target architecture (`ARCHITECTURE.md` §6.5) describes
those tables in the `playback` module with a `saveProgress` public API. The
completion threshold also had to be applied in two places — the server that
stores the watched state and the player that reports the end of an episode —
without the two drifting apart.

**Decision:**

1. **The progress write service lives in the module that owns the tables.**
   `src/modules/users/progress.ts` exposes `savePlaybackProgress(actor, input,
   options?)`. The code follows the current schema ownership; the target
   architecture is not changed as a side effect of this work. Moving the
   tables to `playback` later is a recorded future refactor that carries this
   service with it.
2. **The episode → drama mapping is resolved through the content module's
   public API.** `getEpisodeContentReference(episodeId, executor?)` belongs to
   `content`, which owns the episode hierarchy. The `users → content` edge is
   already permitted by the matrix, so no table is read across a module
   boundary.
3. **One configurable completion threshold.**
   `PLAYBACK_COMPLETION_THRESHOLD_PERCENT` (default 90) lives in the platform
   configuration. The server applies it when it stores the watched state, and
   the watch page hands the same value to the player. There is no second,
   hard-coded threshold anywhere.
4. **Staleness is decided by the observation time the client sends.** The
   browser reports the moment it observed the position. The server clamps that
   moment to its own clock — a future timestamp is never stored — and ignores
   an update that is not newer than the stored one. Two tabs or two devices
   therefore converge on the newer observation, whichever request arrives last.
   The server clock is injectable so the rule is testable without sleeping.
5. **The staleness rule is enforced by the database, not by the read that
   precedes the write.** The two target rows are locked with `FOR UPDATE` for
   the duration of the transaction, and both upserts carry the condition
   `last_watched_at <= excluded.last_watched_at`. A read-then-write decision
   alone is not enough: two overlapping requests could both read the same old
   row and then write in the opposite order. With the lock and the condition,
   an older observation cannot roll the position, the watched minutes, or the
   completion backwards — whichever request arrives last.
6. **Every path locks and writes the two rows in the same order.** The progress
   row comes first, the watched-state row second — in the lock step and in the
   write step. A row that does not exist yet is inserted, and an inserted row
   takes a lock too, so the write order has to match the lock order. The
   manual watched-state change follows the same order. Two paths that touch the
   same rows in the same order cannot deadlock.
7. **The watched state is sticky, and the first completion date is kept.**
   Once the threshold has been reached, the episode stays watched until an
   administrator replaces the source, which resets it explicitly.
8. **A progress write never creates a watch-history row.** History is
   append-only and belongs to the watch-history feature; writing a row on
   every debounced update would duplicate history for every tick.

**Consequences:**

- A device whose clock lags behind the server can lose progress updates for
  that episode. The server remains the authority, and the limitation is
  documented rather than hidden behind a last-write-wins race.
- The write serializes on the two target rows, so two reports for the same
  viewer and episode wait for each other. The lock is held for the length of
  one short transaction.
- The progress service sits in a different module than the target architecture
  describes. The documentation records the difference; it does not pretend the
  refactor has happened.

---

## D-041 — A source version guards playback progress against a replaced source

**Date:** 2026-11-23
**Status:** Approved by user (Prompts 080–090 review fixes)
**Extends:** D-039 (direct external HTTPS MP4 playback), D-040 (progress writes
in the users module), and D-013 (database conventions).

**Context:** Replacing an episode's source resets every viewer's progress to
zero and marks the episode unwatched. A viewer who already had the old source
open keeps playing it, and the player keeps reporting the position it observes
against the *old* source. Those late reports were accepted, because the
progress write decided staleness from the observation timestamp alone (D-040
§4). The result was a viewer whose freshly reset progress was immediately
restored to the old position by a heartbeat that had been in flight when the
replacement happened. The reset was therefore not reliable, and the failure was
invisible: the stored progress simply grew back.

**Decision:**

1. **Every episode carries a source version.** `episodes.video_source_version`
   is an `integer NOT NULL DEFAULT 1`. A confirmed source replacement increments
   it in the same transaction that stores the new URL and resets the progress.
2. **The version travels with every progress write.** `sourceVersion` is a
   required field of the playback-progress input schema, and the player sends
   the version it received with the episode.
3. **A write for a version that is no longer current is ignored, not applied.**
   The write is compared against the episode's current `video_source_version`;
   a mismatch is discarded and the write reports that it was not applied. The
   server stays the authority — the client cannot claim a version that the
   database does not hold.
4. **The guard is independent of any clock.** The comparison is an equality
   check on a counter, not a timestamp comparison. It therefore works
   regardless of the server clock, the client clock, or how long a heartbeat
   was in flight.

**Consequences:**

- A viewer who keeps the old source open stops contributing progress as soon as
  the source is replaced. Their player reports the old version, and the server
  ignores the report.
- The version is a counter and not a hash, so it says which generation of the
  source a report belongs to, not what the source was. The audit record and
  the history rows keep their own dates; the version does not replace them.
- Every progress write now carries one more required field. The REST endpoint
  and the workflow validate it, so a client that omits it is rejected rather
  than silently accepted.

---

## D-042 — Cross-module foreign keys restrict, and the owning module purges its own rows

**Date:** 2026-11-23
**Status:** Approved by user (Prompts 080–090 review fixes)
**Extends:** D-011 (data ownership), D-008 (module boundaries), and D-013
(database conventions).

**Context:** `subtitle_tracks` and `playback_failure_reports` belong to the
`playback` module; `episodes` belongs to `content`. Migration `0013` gave both
foreign keys `ON DELETE CASCADE`. A cascading delete therefore let a `content`
deletion remove another module's rows without that module's knowledge: the
`playback` rows vanished silently, the `playback` module could not audit or
account for them, and a caller could not tell that anything had been removed.
The same is true of the permanent-delete workflow, which already removes the
rows of several other modules through their own ownership services.

**Decision:**

1. **A cross-module foreign key restricts.** The two episode foreign keys are
   changed to `ON DELETE RESTRICT` in migration `0014`. The database refuses
   the episode deletion while a playback row still points at it.
2. **The owning module removes its own rows.** The `playback` module exposes
   `purgeEpisodePlaybackReferences(actor, episodeIds, executor?)`. The
   permanent-delete workflow calls it inside its own transaction, before the
   episode is deleted, so the two steps are one unit of work: either the
   playback rows and the episode are gone, or neither is.
3. **Every path that hard-deletes an episode has to remove the playback rows
   first.** This includes the test fixtures: the end-to-end helpers
   (`tests/e2e/support/drama-fixture.mjs` and
   `tests/e2e/support/stale-fixtures.mjs`) delete the playback rows before the
   episodes, for the same reason the production workflow does.

**Consequences:**

- A deletion that forgets the purge is refused by the database rather than
  silently dropping another module's rows. The failure is loud and immediate.
- Every new code path that deletes an episode must call the purge first. This
  is a deliberate cost of the ownership rule: a module's rows are removed by
  that module.
- The `playback` module's purge service is actor-first like every other
  administrative service, so the permanent-delete path is still subject to the
  authorization rules.

---

## D-043 — An episode has two reference levels: administrative and public

**Date:** 2026-11-23
**Status:** Approved by user (Prompts 091–103 implementation)
**Extends:** D-035 (publication), D-034 (empty-drama visibility), D-039
(direct external MP4 playback), and D-040 (progress writes in the users
module).

**Context:** `content.getEpisodeContentReference(episodeId, executor?)` resolves
the drama an episode belongs to, and it is the content module's public API for
that mapping (D-040 §2). Two callers need different answers from it. The
`playback` module asks whether the episode is still in the catalogue, so an
administrator can manage it — subtitle tracks are attached to a draft episode
long before it is published. The `users` module asks whether the public may
watch the episode *right now*, so a viewer's progress row and a viewer's manual
watched state may only point at something that is publicly playable (D-035,
D-039).

The first implementation of Prompts 091–103 made the shared reference enforce
public playability. That broke the administrative path: adding a subtitle
track to a draft episode failed with "Episode not found", and the end-to-end
test `admin episode video source › manages the subtitle tracks of an episode`
failed. The failure was silent for the administrator — the form reported an
error and the track was never stored.

**Decision:**

1. **The content module exposes two reference levels.**
   `getEpisodeContentReference(episodeId, executor?)` answers "does this episode
   exist and is it still in the catalogue?" — it refuses only a missing or
   trashed episode. `getPublicEpisodeContentReference(episodeId, executor?)`
   answers "may the public watch this episode right now?" — it additionally
   applies the full hierarchy rule: the episode, its drama, and its season have
   to be published and untrashed, and the episode has to carry a source.
2. **The administrative path uses the administrative reference.** The
   `playback` module's subtitle management keeps working on a draft episode.
3. **The viewer path uses the public reference.** A progress write, a manual
   watched-state change, and a resume point may only refer to an episode the
   public may play. A guessed episode id of a draft, unpublished, source-less,
   or trashed episode is refused with the same rule the watch page uses.
4. **Both levels read the hierarchy in one query.** The two functions share a
   single row reader, so the administrative level can never drift from the
   public level by reading a different hierarchy.

**Consequences:**

- Administrator access and public access are separate by construction, which
  is what Prompt 103 requires ("keep admin preview access separate from public
  availability").
- A viewer cannot create a progress row for content the public cannot reach,
  but an administrator can still prepare that content before it is published.
- Every new caller has to choose a level deliberately. A caller that wants the
  administrative answer must say so; it is not the default.

---

## D-044 — The public pages compose module read models; the content module never reads ratings or view counts

**Date:** 2026-11-23
**Status:** Approved by user (Prompts 091–103 implementation)
**Extends:** D-008 (module boundaries), D-011 (data ownership), and D-035
(publication).

**Context:** The drama and movie details pages show a rating and a view count.
The rating lives in the `reviews` module and the view count in the `analytics`
module, while the details themselves belong to `content`. A `content` service
that returned the rating and the view count would have to import two other
modules — which the dependency matrix forbids — and it would give the content
module write-adjacent knowledge of tables it does not own.

**Decision:**

1. **Every module keeps its own read model.**
   `reviews.getRatingSummary(type, id)` returns the aggregate rating, and
   `analytics.getContentViewCount(type, id)` returns the recorded view count.
   `content` exposes the details, the episode list, the taxonomy, the similar
   dramas, and the canonical hrefs — and nothing else.
2. **The page composes the read models.** The details page is an async Server
   Component that reads the content module's details and, in parallel, the
   rating summary, the view count, the bookmark state, and the resume point.
   The composition happens in the page, which is allowed to depend on several
   modules.
3. **Nothing is fabricated.** A rating is shown only when real ratings exist;
   the page says "No ratings yet" otherwise. A view count of zero is a real
   zero and is shown as such. No seed, estimate, or placeholder number is ever
   displayed.
4. **The public pages are server-rendered.** The details pages, the episode
   navigation, and the resume card are Server Components; the client islands
   are limited to the actions that need a browser — the bookmark button, the
   watched toggle, and the player.

**Consequences:**

- The content module stays free of cross-module imports, and a rating or a
  view count can never be read through the content module's public API.
- A page that shows a detail has to decide which read models it composes; a
  new metric is a new read model in its owning module, not a new column on the
  content read model.
- The pages are dynamic by design (`force-dynamic`): a viewer's bookmark state
  and resume point are personal, and a cached page would show one viewer's
  state to another.

---

## D-045 — The watched state moves with the position, and the automatic next episode is a navigation

**Date:** 2026-11-23
**Status:** Approved by user (Prompts 091–103 implementation)
**Extends:** D-040 (progress writes and the completion threshold), D-041 (the
source version), and D-039 (direct external MP4 playback).

**Context:** Two behaviours of Prompts 096 and 100 needed a rule that the
earlier decisions did not cover. First, a viewer may mark an episode watched
or unwatched by hand. The stored position and the watched state are two
columns of two tables, and they can disagree: an episode marked unwatched while
its position still sits at the end would be completed again by the very next
playback heartbeat, and the viewer's explicit decision would silently reverse.
Second, the automatic next-episode behaviour needs to start the next episode
immediately, without a countdown.

**Decision:**

1. **The manual watched-state change moves the progress with it.** Marking an
   episode unwatched sets the stored position back to zero and clears the
   watched state; marking it watched sets the watched state and keeps the
   first completion date that was ever recorded for it.
2. **The first completion date is never rewritten.** A later manual change
   does not move the moment the episode was first completed; the watch history
   keeps its own dates. The reset itself is recorded separately, in
   `completed_at_reset_at`, so the two moments are never confused with one
   another.
3. **The manual change moves the observation time forward.** The decision is
   dated with the server clock, and the playback report carries the moment it
   observed the position. A report that was already in flight when the viewer
   marked the episode unwatched describes the position from before the
   decision, so it is stale and is ignored. The viewer's decision therefore
   survives a report that arrives late.
4. **The browser follows the server.** The server resets the stored position;
   the media element still sits at the end of the episode. The watched toggle
   therefore raises a shared *start over* signal
   (`src/components/player/playback-reset.tsx`), and the player answers by
   dropping the pending report, returning the media to the beginning, clearing
   the resume offer, and clearing the completion flag it had reached. The
   client-side signal is a client island; it never carries the decision
   itself, which stays on the server.
5. **The automatic next episode is a full navigation to the next episode's
   canonical URL with `autoplay=1`.** The next page reads the parameter and
   starts its own player immediately. A full page load — rather than a
   client-side router transition — means the next player starts from a clean
   state, with no leftover player instance or progress timer.
6. **The browser's autoplay policy still decides.** When the browser refuses
   to start playback without a gesture, the player stays usable and the
   viewer presses play. The application does not attempt to bypass the policy.
7. **There is no countdown.** The next episode starts as soon as the current
   one ends and the completion threshold has been reached.

**Consequences:**

- The viewer's explicit decision survives the next heartbeat; the watched state
  and the position cannot drift apart.
- An item that already counts as watched is complete, not unfinished, so the
  watch pages and the details pages offer *Play* instead of a resume offer.
- The automatic next-episode flow is observable in a test through the player's
  navigation hook, and the parameter it adds is part of the public URL
  contract.
- A viewer who prefers to start an episode themselves can ignore the resume
  offer; the automatic flow only runs after an episode has actually ended.

---

## D-046 — A slug change keeps the old URL through a redirect, and the content module owns the lookup

**Date:** 2026-11-23
**Status:** Approved by user (Prompts 091–103 implementation review fixes)
**Extends:** D-007 (movie canonical URL), D-043 (episode reference levels), and
`REQUIREMENTS.md` §4.3 and §6.6.

**Context:** The canonical URL of a drama and of a movie carries its slug
(requirements §6.6), and a slug change has to preserve the old URL through a
redirect (§4.3). The first implementation of the public pages required an
exact match of the requested slug, so a renamed drama or movie answered 404 on
its old URL, and the end-to-end suite even asserted that behaviour. The
`content_slug_history` table and the admin workflows that write it already
existed; only the read was missing.

**Decision:**

1. **The content module owns the redirect lookup.**
   `content.resolvePublicContentSlug(type, contentId, requestedSlug)` reads
   `content_slug_history` and returns the *current* slug when the requested one
   is a slug the item really used. The four public routes — the drama details
   page, the episode watch page, the movie details page, and the movie watch
   page — redirect the old URL to the current canonical URL.
2. **A guessed slug is still a 404.** The resolver never invents a redirect: it
   only answers for a slug that appears in the item's own history.
3. **The redirect never reveals an unpublished item.** The resolver applies the
   same availability rule as the page it redirects to, so the current slug of a
   draft, trashed, or source-less item stays hidden.
4. **The redirect always points at the current slug.** The history records
   every change, so an old slug that was used twice is still found, and the
   answer is always the slug the item carries now.

**Consequences:**

- The public URLs keep working after a rename, which is what the requirements
  ask for; the canonical metadata and every internal link use the current slug.
- The redirect is a server-side lookup, so it costs one indexed read per
  request that reaches a stale slug. Requests for the current slug never touch
  the history table.
- The availability rule stays in one place: a redirect can never be a way
  around the public availability decision.
