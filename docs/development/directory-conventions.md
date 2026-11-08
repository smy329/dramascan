# Directory Conventions

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Version:** 1.0  
**Date:** 2026-11-08

This document defines the canonical directory structure and file placement rules for the DramaScan codebase. It is derived from `ARCHITECTURE.md` §4 and `CONVENTIONS.md` §2 and §3, and must not be contradicted without a new recorded decision.

---

## 1. Repository Root Structure

The project root contains:

| File/Folder     | Purpose                                                                              |
| --------------- | ------------------------------------------------------------------------------------ |
| `AGENTS.md`     | Global instructions for OpenCode and coding agents (must remain in root).            |
| `README.md`     | Concise project introduction; points to `docs/README.md` for detailed documentation. |
| `package.json`  | Project configuration and scripts.                                                   |
| `tsconfig.json` | TypeScript compiler configuration.                                                   |
| `docs/`         | Project documentation directory (see `docs/README.md`).                              |
| `src/`          | Application source code (full tree defined in `ARCHITECTURE.md` §4).                 |
| `public/`       | Static, committed assets only. Not user uploads.                                     |
| `tests/`        | Test fixtures and configuration.                                                     |
| `drizzle/`      | Generated SQL migrations and Drizzle metadata.                                       |
| `.gitignore`    | Git ignore patterns.                                                                 |
| `.env.example`  | Example environment variables (committed).                                           |
| `.env.local`    | Local overrides (ignored; not committed).                                            |

---

## 2. `src/` Tree Structure

The `src/` tree is strictly layered. No module may import outside its permitted layers (see `ARCHITECTURE.md` §7 and the dependency matrix). The complete tree is:

```
src/
  instrumentation.ts          # server startup hook; validates environment config
  app/                      # App Router entrypoints
    (public)/               # public pages, Server Components by default
    (auth)/                 # sign-in, auth error pages
    admin/                  # protected admin shell and pages
    api/                    # REST route handlers (allowlist only)
      auth/[...all]/route.ts      # Better Auth handler (only auth entrypoint)
      search/suggestions/route.ts
      analytics/view/route.ts
      analytics/playback/route.ts
      playback/progress/route.ts
      notifications/unread-count/route.ts
      admin/exports/[dataset]/route.ts
      admin/backups/[id]/route.ts
      health/route.ts
      openapi/route.ts
    actions/                # Server Actions grouped by area (thin)
    layout.tsx
    globals.css
  workflows/                # cross-module orchestration; no UI, no HTTP
    publish-content/
    replace-video-source/
    permanently-delete-content/
    record-content-view/
    save-playback-progress/
    moderate-review/
    resolve-content-report/
    deactivate-user/
    authorize-admin/
    terminate-admin-session/
    export-dataset/
    import-dataset/
  modules/                  # 11 domain modules
    auth/
      index.ts              # public API, server-only
      schema.ts             # Better Auth tables + account status
      service.ts            # identity sync, sessions, status
      queries.ts
      validation.ts
      repository.ts
    authorization/
      index.ts
      schema.ts             # roles, role_permissions, user_roles
      permissions.ts        # THE permission catalog (single source)
      actors.ts             # Anonymous/User/Admin/System actor types
      guards.ts             # requirePermission, resource checks
      service.ts
      queries.ts
    content/
      index.ts
      schema.ts             # dramas, seasons, episodes, movies, taxonomies, pages, slug history
      service.ts
      queries.ts
      validation.ts
      repository.ts
      conversion.ts         # structure conversion (content-internal)
    users/
      index.ts
      schema.ts             # bookmarks
      service.ts
      queries.ts
      validation.ts
      repository.ts
      read-models/          # approved admin user listing over auth identity (read-only)
    playback/
      index.ts
      schema.ts             # subtitle_tracks, playback_progress, watch_history
      service.ts
      queries.ts
      validation.ts
      repository.ts
    reviews/
      index.ts
      schema.ts             # ratings, reviews, review_reactions, review_reports
      service.ts
      queries.ts
      validation.ts
      repository.ts
    moderation/
      index.ts
      schema.ts             # content_reports, moderation_actions
      service.ts
      queries.ts
      validation.ts
      repository.ts
    notifications/
      index.ts
      schema.ts             # preferences, notifications, push_subscriptions, announcements, deliveries
      service.ts
      queries.ts
      validation.ts
      repository.ts
      providers/            # push provider abstraction (isolated)
    analytics/
      index.ts
      schema.ts             # guest_sessions, view events, playback events, aggregates
      service.ts
      queries.ts
      validation.ts
      repository.ts
      read-models/          # approved cross-module read-only queries
    administration/
      index.ts
      schema.ts             # admin accounts, login attempts, settings, versions, layouts, audit
      service.ts
      queries.ts
      validation.ts
      repository.ts
      read-models/          # approved operational summaries
    maintenance/
      index.ts
      schema.ts             # task runs, backup manifests, alerts, incidents, error records
      service.ts            # task framework, backups, health, alerts
      queries.ts
      validation.ts
      repository.ts
  db/                       # composition root: schema registry + Drizzle instance
    schema.ts               # assembles every module's schema.ts (only place allowed to)
    client.ts               # Drizzle instance from platform pool + schema
  platform/                 # server infrastructure
    db/
      pool.ts               # connection pool
      transaction.ts        # withTransaction, DbExecutor type
    config/                 # Zod-validated environment
    errors/                 # AppError hierarchy
    logging/                # Pino, redaction, request context
    rate-limit/             # PostgreSQL-backed limiter
    cache/                  # cache tags + invalidation helpers
    http/                   # error → HTTP mapping, response helpers
  components/               # client-safe UI and client components
    ui/                     # shadcn/ui primitives
    public/                 # presentational public components
    admin/                  # presentational admin components
    player/                 # Vidstack client wrapper
  lib/                      # isomorphic helpers and client-safe contracts
    contracts/              # client-safe DTOs and form schemas per domain
    utils/                  # isomorphic helpers
  scripts/                  # maintenance commands
    maintenance/
      trash-expiry.ts
      backup.ts
      validate-backup.ts
      retention-cleanup.ts
      analytics-retention.ts
      aggregate-daily.ts
      index.ts              # command dispatcher
```

Repository-root tests hold the test suites:

```
tests/
  unit/
  integration/
  e2e/
  fixtures/
```

### 2.1 Rules for the Tree

- `src/app` contains routing and entrypoint adaptation only. No business rules.
- `src/modules/*/index.ts` is the only cross-module import target. Everything else inside a module is private.
- `src/components` contains no data fetching and imports no module. Data fetching happens in `app` Server Components; presentational components receive props.
- `src/lib/contracts` holds the only types/schemas that may cross into the browser bundle from a domain. It imports no server code.
- Do not create empty directories or placeholder types for unimplemented modules. A module's structure is added when its implementation begins; domain-specific types stay inside that module.
- Non-module layer directories (`app/*`, `components/*`, `db`, `platform`, `workflows`, `lib/utils`, `lib/validation`, `scripts/maintenance`, `tests/*`) may exist as `.gitkeep` placeholders until their assigned implementation prompt fills them.
- `src/db` is the schema/client composition root. It may import every module's `schema.ts` and the platform pool; nothing else may import `@/db/schema`. This is the single documented exception to the module `index.ts` import rule, because assembling the Drizzle schema requires the table definitions.
- `src/scripts/maintenance` is an application-layer consumer of modules and workflows. It is never imported by `app`.

---

## 2.2 Module Sub-Layout

Each module follows the same sub-layout:

```
modules/<domain>/
  index.ts                    # public re-exports only; begins with "import "server-only""
  schema.ts                   # Drizzle table definitions owned by the module
  service.ts                  # write services, domain rules, transaction participation
  queries.ts                  # read services; authorization and visibility filtering; DTO shaping
  validation.ts               # Zod input schemas and parsers
  repository.ts               # all Drizzle queries and mutations for owned tables
  read-models/                # approved cross-module read-only queries (optional)
  providers/                  # isolated external-provider adapters (optional, notifications only)
```

Large modules may split `service.ts` and `repository.ts` into folders, provided `index.ts` remains the only public surface.

---

## 3. `docs/` Documentation Structure

The documentation directory is organized by category:

```
docs/
  README.md                 # central documentation index (see this file)
  project/                  # project scope, future upgrades, hard exclusions
    project-scope.md
  architecture/             # system architecture, module boundaries, dependency rules
    system-architecture.md
    module-architecture.md
    dependency-rules.md
  requirements/             # functional and non-functional requirements
    functional-requirements.md
    non-functional-requirements.md
  decisions/                # recorded technical and architecture decisions
    technical-decisions.md
    architecture-decisions.md
  development/              # coding, directory, database, API, error, logging, testing, migration conventions
    coding-conventions.md
    directory-conventions.md
    database-conventions.md
    api-conventions.md
    error-handling.md
    logging-conventions.md
    testing-conventions.md
    migration-conventions.md
  implementation/           # implementation plan, progress tracker
    implementation-plan.md
    progress-tracker.md
  future/                   # future upgrade backlog
    future-upgrade-backlog.md
```

---

## 3. `drizzle/` Migration Directory

Migrations live in `drizzle/` and are numbered sequentially:

```
drizzle/
  0001_create_auth_tables.sql
  0002_create_content_tables.sql
  ...
```

- Never edit an applied migration. Create a new migration.
- Migrations are reviewed like code and committed with the schema change.
- `drizzle-kit push` is forbidden in production. Production uses versioned migrations only.

---

## 4. Ignored and Local Files

These files exist at the root but are **not** part of the application source or documentation:

| File            | Purpose                                              | Status                       |
| --------------- | ---------------------------------------------------- | ---------------------------- |
| `.env.example`  | Example env vars with safe placeholders and comments | Committed to repo            |
| `.env.local`    | Local overrides (not committed)                      | Ignored by `.gitignore`      |
| `node_modules/` | Dependencies; installed via npm                      | Ignored by `.gitignore`      |
| `.next/`        | Next.js build output                                 | Ignored by `.gitignore`      |
| `drizzle/`      | Generated migrations (during development)            | Not committed until reviewed |
| `*.profiler`    | Performance profiling data                           | Not committed                |
| `coverage/`     | Test coverage reports                                | Not committed                |

---

## 5. Path Conventions

- All relative paths in documentation and code must resolve correctly from the file containing them.
- Use forward slashes (`/`) in path references, even on Windows.
- Do not use machine-specific absolute paths (e.g., `C:\Users\User\...`) in documentation, links, or comments.
- Do not use `../` to reference documents outside the intended scope without a clear reason.

---

## 6. Preventing Documentation Path Problems

- All internal Markdown links in documentation must use valid relative paths from the containing document's location.
- Verify that every documentation link points to an existing file at its intended location.
- Avoid circular documentation references (A links to B, B links to A).
- Do not modify application imports or runtime paths unless a documentation file was genuinely being used by application code and the change is necessary and safe.
- Check references in `AGENTS.md`, root `README.md`, other Markdown documents, and project-specific instructions.

---

## 7. AGENTS.md and Root `README.md`

- `AGENTS.md` must remain in the project root. It contains persistent instructions for OpenCode and other coding agents.
- The root `README.md` must link to `docs/README.md` as the documentation index. It must not duplicate the documentation structure.
- Do not move source code, configuration files, environment files, migrations, tests, or other application assets into `docs/` merely because they contain documentation-like text.
- Do not create unnecessary duplicate documents.

---

## 7. Documentation Discovery Rules

- Coding agents must read `AGENTS.md` before starting any project task.
- Read `docs/README.md` to discover the documentation structure.
- Read the relevant architecture, requirements, and technical decision documents before modifying related functionality.
- Read the current `PROJECT_STATUS.md` to understand the current prompt, completed work, changed files, tests, unresolved issues, and the next task.
- Inspect the relevant module's `index.ts` (its only public API), then its service/query/repository files, then its tests.
- Search before creating. Use `grep`/`glob` to find an existing helper, service, type, or convention.
- Run the current checks (typecheck, lint, tests) before changing behavior.
- Preserve working code, established architecture, public APIs, and user data.
- Update `PROJECT_STATUS.md`, and `CHANGELOG.md`/`DECISIONS.md` when applicable.
- Never invent, contradict, or silently change previously approved decisions.
- Treat the initial implementation scope and future upgrade backlog as separate boundaries.
- Use the canonical documentation locations (`docs/`) rather than creating new documentation files randomly in the project root.

---

## 8. Progress Tracking Format

| Field             | Description                                        |
| ----------------- | -------------------------------------------------- |
| Prompt Number     | Original micro-prompt number                       |
| Prompt Title      | Name of the implementation prompt                  |
| Status            | Not Started / In Progress / Completed / Blocked    |
| Changed Files     | Files created, modified, or removed                |
| Tests             | Tests executed and their results                   |
| Unresolved Issues | Remaining problems or decisions requiring approval |
| Completion Date   | Date of completion                                 |

Do not falsely mark prompts as completed. Preserve existing progress information.

---

## 9. Verification

After organizing documents, verify:

- The project has one clear, canonical documentation structure.
- All documentation is discoverable through `docs/README.md`.
- Persistent agent instructions remain in root `AGENTS.md`.
- All internal documentation links and path references work correctly throughout the repository.
- `AGENTS.md` and the root `README.md` remain in the project root.
- No important document was lost or unintentionally duplicated.
- No unnecessary documentation files were created simply to fill the folder structure.

Files moved: list files that were relocated.
Files created: list new files.
Files updated: list modified files.
Files left unchanged: list files that remain in their original location.

---
