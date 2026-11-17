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

---
