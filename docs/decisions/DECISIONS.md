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

## Decision log rules

- A decision is added only after explicit user approval or when the specification
  establishes it.
- Decisions record context, the approved choice, and consequences.
- Changing a decision requires a new entry that supersedes the old one; prior entries
  are not deleted.
- Implementation must not silently contradict an active decision.
