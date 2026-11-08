# DECISIONS

**Project:** DramaScan — International Drama & Movie Streaming Platform
**Status:** Active decision log
**Last updated:** 2026-11-08

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

## Decision log rules

- A decision is added only after explicit user approval or when the specification
  establishes it.
- Decisions record context, the approved choice, and consequences.
- Changing a decision requires a new entry that supersedes the old one; prior entries
  are not deleted.
- Implementation must not silently contradict an active decision.
