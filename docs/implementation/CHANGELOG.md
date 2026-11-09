# CHANGELOG

**Project:** DramaScan — International Drama & Movie Streaming Platform

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project does not yet have
released versions; changes accumulate under `Unreleased` until the first release.

Entry conventions are defined in `CONVENTIONS.md` §12.3. Each line names the prompt that
introduced the change. Per-file detail lives in the prompt row in `PROJECT_STATUS.md`;
this file records notable outcomes, not every edit.

---

## [Unreleased]

### Added

- **Prompt 001:** Repository baseline inspection and initial `PROJECT_STATUS.md`, recording
  the greenfield state, local toolchain, and pending operational inputs.
- **Prompt 002:** `REQUIREMENTS.md` defining approved product scope, hard exclusions, and
  future backlog boundaries; `DECISIONS.md` established with product decisions D-000–D-007.
- **Prompt 003:** `ARCHITECTURE.md` defining the modular monolith: 11 feature modules, the
  `src/workflows/` orchestration layer, the acyclic dependency matrix, entrypoint
  allocation, data ownership, transaction coordination, and enforcement rules; decisions
  D-008–D-012.
- **Prompt 004:** `CONVENTIONS.md` defining naming, directory, TypeScript, database, API,
  error, logging, testing, migration, Git, and definition-of-done conventions.
- **Prompt 004:** `DATABASE.md` documenting database conventions, the planned ownership
  map, relationship integrity rules, index strategy, migration practices, and the table
  catalog placeholder.
- **Prompt 004:** `API.md` documenting the success/error envelopes, pagination, sorting,
  filtering, authentication, CSRF, caching, rate limiting, the planned REST endpoint
  catalog, the Server Action catalog, and the endpoint documentation template.
- **Prompt 004:** `SECURITY.md` documenting security principles, planned controls, the
  authorization model, external media URL risks, database and backup security, and
  explicitly accepted limitations.
- **Prompt 004:** `CHANGELOG.md` (this file).
- **Prompt 004:** Decisions D-013–D-017 recording database identity/naming, API response
  and pagination, testing and migrations, documentation/progress tracking, and
  error/logging conventions.
- **Prompt 006:** Minimal Next.js 16.4.5 App Router application with TypeScript, React
  19.3.1, npm lockfile, `dev`/`build`/`start` scripts, Node 24 engine pinning, a root
  layout, branded home route, and dark global styles. Decision D-018 records the runtime
  and package-manager baseline.
- **Prompt 007:** Strict TypeScript compiler flags (`noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`,
  `noUnusedParameters`, `forceConsistentCasingInFileNames`), a `typecheck` script backed
  by `next typegen`, and shared cross-cutting `ActionResult`/pagination contracts in
  `src/lib/contracts/common.ts`.
- **Prompt 008:** Modular directory structure separating App Router route groups
  (`(public)`, `(auth)`, `admin`, `api`, `actions`), presentational components
  (`public`, `ui`, `admin`, `player`), a domain-module area (`src/modules/README.md`
  boundary note only, no modules yet), database composition root, server platform,
  workflows, shared utilities/validation, maintenance scripts, and tests. Empty layer
  directories use `.gitkeep` placeholders only.
- **Prompt 009:** Server-only environment configuration in `src/platform/config/` with
  Zod validation, `server-only` enforcement, a validated `serverConfig`, and a
  `ConfigurationError` that lists invalid fields without values. Production requires
  `APP_URL`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, Google OAuth credentials, and
  `SUPER_ADMIN_EMAIL`; development and test may omit them while still validating any
  provided value. `src/instrumentation.ts` validates configuration at server startup;
  `.env.example` documents every variable with placeholders only. Decision D-019 records
  the contract.
- **Prompt 019:** Server-only PostgreSQL connection management in
  `src/platform/db/pool.ts` and `src/platform/db/pool-config.ts`, plus the Drizzle client
  in `src/db/client.ts`. The single pool uses a 5-connection maximum, explicit connect,
  idle, lifetime, query, and idle-in-transaction timeouts, TCP keepalive, lazy
  reconnection, and sanitized pool-error logging. `DATABASE_URL` validation now requires
  a hostname, database name, and no fragment. `drizzle-orm` and `pg` are runtime
  dependencies.

- **Prompt 020:** Modular Drizzle schema structure. `src/db/schema.ts` is the only
  composition root that imports module `schema.ts` namespaces and exports one registry;
  `src/db/client.ts` passes it to Drizzle. Eleven module schema fragments establish the
  authentication, authorization, content, users, playback, reviews, moderation,
  notifications, analytics, administration, and maintenance boundaries. Shared helpers in
  `src/platform/db/schema-helpers.ts` provide UUIDv7 primary keys, standard timestamps,
  soft deletion, and documented constraint/index names. No tables or migrations were
  created; those belong to Prompts 021–029.

### Changed

- **Prompt 003:** `PROJECT_STATUS.md` updated to record the approved architecture and the
  next task.
- **Prompt 004:** `PROJECT_STATUS.md` updated with the Prompt 004 row, the expanded
  documentation set, and the next task.
- **Prompt 006:** `README.md` now documents installation and the development/production
  scripts; progress documents and TypeScript conventions reflect the initialized
  application and Next.js 16's required `react-jsx` mode.
- **Prompt 007:** `CONVENTIONS.md` and `coding-conventions.md` now describe the strict
  settings as implemented rather than planned.
- **Repository workflow:** `AGENTS.md` now requires committing and pushing each completed
  prompt, with conventional commit messages and explicit Git safety rules.
- **Prompt 007 follow-up:** Clarified that PostgreSQL development credentials remain an
  uncommitted environment prerequisite (real values only in ignored `.env.local`, with
  `.env.example` placeholders deferred to Prompt 009) and that domain-specific types
  belong in their owning modules, with no speculative types or empty module directories.
- **Prompt 008:** The home route moved to `src/app/(public)/page.tsx`; its markup moved
  into the server-compatible presentational `src/components/public/SiteIntro.tsx`, so the
  route only composes components.
- **Prompt 009:** `README.md` now documents copying `.env.example` to `.env.local` and
  replacing placeholders. `CONVENTIONS.md` §3.4 and `SECURITY.md` record the implemented
  configuration boundary and variable contract.
- **Prompt 019:** `DATABASE.md` and `SECURITY.md` now record the implemented connection
  pool, timeout policy, validation rules, and local/private-only deployment requirement.
- **Prompt 020:** `DATABASE.md` records the schema composition rules, the SQL-migration
  boundary for cross-module foreign keys, and the approved typed-FK + CHECK model for
  drama/movie relationships. The architecture and directory documents now point to the
  settled Drizzle composition mechanism instead of deferring it.

### Fixed

- **Prompt 004:** Corrected a self-referential instruction in `DATABASE.md` §9 so the
  change process says to update "this document's relationship/index notes."

### Removed

- Nothing removed.

### Security

- **Prompt 004:** Established security documentation requirements: server-side
  authorization as the sole authority, deny-by-default behavior, no secret exposure in
  logs/exports/errors, no server-side fetching of arbitrary administrator media URLs, and
  fail-closed rate limiting for sensitive operations. No control is implemented yet.
- **Prompt 019:** Database credentials remain server-only. Connection validation errors
  never include passwords, and pool errors are logged with connection URLs, password
  fragments, and URL credentials redacted.

---

## Release History

No releases yet. The first release entry is added when a deployable application exists.
