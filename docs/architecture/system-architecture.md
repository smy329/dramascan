# System Architecture

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Version:** 1.0  
**Date:** 2026-11-08  

This document describes the modular monolith architecture approved in Prompt 003 and recorded in DECISIONS.md D-008–D-012.

---

## 1. Overview

The application is a **single-deployable, low-RAM modular monolith**. There is one Next.js process, one PostgreSQL database, and no service split. All domain modules, platform services, and workflows coexist in a single codebase with strict layer boundaries.

### 1.1 Architecture Goals

- **Resource-efficient:** Suitable for a low-RAM production server; no Redis, no separate workers, no job queue, no Docker.
- **Modular monolith:** Feature modules own their tables and expose narrow public APIs; cross-module coordination happens through `src/workflows/`.
- **Clear data ownership:** Each module exclusively owns and writes its tables; cross-module reads use the owner's public query API or approved read models.
- **Enforceable boundaries:** Dependency direction is fixed by the matrix in §7; upward imports and unlisted same-layer edges are forbidden.

### 1.2 Runtime Topology

```
Browser ──────────────► Nginx ──────────────► Next.js (single process)
   │                                             │
   │  direct HTTPS MP4 (CORS + byte ranges)      ├── app/          entrypoints: RSC, Server Actions, route handlers
   ▼                                             ├── workflows/    cross-module orchestration + transaction coordination
External MP4 host                                ├── modules/      11 domain modules, each owning its tables
                                                  ├── platform/     db, config, errors, logging, rate limit, cache
                                                  ├── components/   client-safe UI
                                                  └── lib/          isomorphic helpers + client-safe contracts
                                                         │
                                                        PostgreSQL
                                                         ▲
systemd timers ──► scripts/maintenance/*.ts ────────────┘
                   (short-lived, use modules + workflows)
```

### 1.3 Key Constraints

- The browser never asks the application server for video bytes. It plays the stored URL directly.
- Maintenance commands are separate process invocations. They share code with the application but are not imported by public request paths.
- There is exactly one runtime datastore. No cache server, broker, or secondary store exists.
- No event bus, message broker, outbox processor, queue, or background worker.
- Short-lived systemd-triggered maintenance commands only; no persistent workers or queue.

---

## 2. Layer Model

Modules are assigned to fixed layers. **A module may import only modules in a strictly lower layer, plus the explicitly listed same-layer edges in §7.1.** Upward imports are prohibited.

| Layer | Location | Contents | May import |
|---|---|---|---|
| 0 | `src/platform/` | DB client/pool, transaction primitive, env config, error base types, Pino logging, PG-backed rate limiter, cache helpers, HTTP helpers | Nothing from `modules`, `workflows`, `app`, `components` |
| 1 | `src/modules/auth` | Authentication, identity, sessions, account status | Platform |
| 2 | `src/modules/authorization` | RBAC, permission catalog, guards | Platform, `auth` |
| 3 | `src/modules/content`, `users`, `playback`, `reviews` | Core domain | Platform, layers 1–2, and the same-layer edges in §7.1 |
| 4 | `src/modules/moderation`, `notifications`, `analytics` | Supporting domain | Platform, layers 1–3, and listed same-layer edges |
| 5 | `src/modules/administration`, `maintenance` | Administration and operations | Platform, layers 1–4; `administration` may also read `maintenance`; `maintenance` may read any module except `administration` |
| A | `src/workflows/` | Application orchestration for cross-module operations | Any module, platform |
| E | `src/app/` | App Router entrypoints: pages, layouts, Server Actions, route handlers | Workflows, modules, platform (limited), components, lib |
| U | `src/components/` | Client-safe UI and client components | `lib`, `lib/contracts` only |
| L | `src/lib/` | Isomorphic helpers and client-safe DTO/schema contracts | Third-party isomorphic libraries only |

---

## 3. Dependency Matrix

Rows may import columns marked ✓. Everything else is forbidden. See `AGENTS.md` §7 and `ARCHITECTURE.md` §7.1 for same-layer exceptions and forbidden examples.

---

## 4. Module Catalog

The eleven initial modules are the complete set. Adding a twelfth requires a recorded decision (§18 in ARCHITECTURE.md).

### 6.1 `auth` — Authentication and identity

### 6.2 `authorization` — RBAC and guards

### 6.3 `content` — Content management

### 6.4 `users` — User profile and bookmarks

### 6.5 `playback` — Playback, progress, and history

### 6.6 `reviews` — Ratings, reviews, reactions, review reports

### 6.7 `moderation` — Content reports and moderation records

### 6.8 `notifications` — User and admin notifications

### 6.9 `analytics` — Product analytics and reporting

### 6.10 `administration` — Admin operations and system configuration

### 6.11 `maintenance` — Operations and observability

For detailed module descriptions, see `ARCHITECTURE.md` §6.

---

## 5. Inter-Module Communication and Orchestration

### 5.1 Direct calls

A module calls another module only through that module's public `index.ts`, only when the dependency matrix permits it, and only for a read or a write that belongs to the callee. The caller passes:
1. a trusted `ActorContext` (first argument),
2. a validated input object,
3. an optional shared `DbExecutor` when participating in a workflow transaction.

### 5.2 Workflows

A **workflow** is a thin application-layer function in `src/workflows/` that coordinates two or more modules. It:
- contains sequencing, authorization entry checks, and transaction boundaries — **not** domain rules;
- calls each participating module's public API independently;
- passes validated payloads and the actor explicitly;
- owns the shared transaction when atomicity is required (§12);
- performs post-commit effects (cache invalidation, push dispatch) after the transaction commits;
- is invoked by a Server Action, route handler, or maintenance script — never by a module.

Workflows are not a general abstraction. A single-module operation stays in that module's service. A workflow exists only when coordination is genuinely required.

### 5.3 Workflow catalog (initial)

| Workflow | Modules coordinated | Why it cannot live in one module |
|---|---|---|
| `publish-content` | content, notifications (+ cache invalidation via platform) | Publishing writes content and creates notifications |
| `replace-video-source` | content, playback | Updates the URL and resets progress atomically |
| `permanently-delete-content` | content, users, playback, reviews, moderation, analytics | Purge plus cleanup of dependent records and anonymization |
| `record-content-view` | analytics, content | Verifies availability, then records a deduplicated view |
| `save-playback-progress` | playback, analytics | Persists progress and records bounded analytics in one request |
| `moderate-review` | reviews, moderation, notifications | Removes a review, records the action, notifies the reporter |
| `resolve-content-report` | moderation, notifications | Resolves a report and notifies the reporter |
| `deactivate-user` | auth, users, notifications | Changes account status and emits a mandatory security notification |
| `authorize-admin` | auth, authorization, administration, notifications | Grants roles, records the admin account, notifies |
| `change-admin-role` | authorization, administration, notifications | Changes roles and emits a security notification |
| `terminate-admin-session` | auth, administration, notifications | Revokes a session, records it, notifies |
| `export-dataset` | administration, owning module | Builds an approved dataset across modules |
| `import-dataset` | administration, owning module | Dry-run and apply metadata across modules |

### 5.4 Prohibited communication mechanisms

- No event bus, message broker, outbox processor, queue, or background worker.
- No in-process pub/sub used to avoid a direct call.
- No shared mutable module state.
- No cross-module table writes.
- No "temporary" circular import to make a side effect work.

---

## 6. Entrypoint Allocation

### 6.1 Rules

| Entrypoint | Responsibility | Must not |
|---|---|---|
| **Server Component** (`app/**/page.tsx`, layouts) | Resolve actor, call one or more module **query** services, render | Mutate data, access repositories or the DB, call write services |
| **Server Action** (`app/actions/**`) | Parse `FormData`, validate with Zod, resolve actor, call one workflow or one module **service**, map errors, revalidate cache tags | Contain domain rules, access the DB, duplicate REST logic |
| **REST route handler** (`app/api/**/route.ts`) | Parse request (params/query/body), resolve actor, call one workflow or one module service, map result/errors to HTTP, set headers | Contain domain rules, access the DB, implement logic not present in the shared service |

Every entrypoint performs authentication/authorization checks. Every protected service re-checks independently.

### 6.2 REST allowlist

REST exists only for these categories. Anything else is a Server Action or a Server Component read:

1. Client-driven reads and polling (search autocomplete, notification unread count, admin operational metrics refresh).
2. Analytics beacons (content view, playback heartbeat) sent with `sendBeacon`/`fetch(..., { keepalive: true })`.
3. Exports and downloads (CSV datasets, authorized backup download).
4. Better Auth integration (`/api/auth/[...all]`).
5. Health checks (public minimal; authenticated detailed).
6. OpenAPI document.
7. Explicitly approved external integrations (webhooks) — none in the initial release.

Push subscription management is a client-driven mutation and uses a Server Action, not REST.

---

## 7. Dependency Matrix

See `ARCHITECTURE.md` §7 for the full matrix. Only these same-layer edges are permitted:

| Edge | Reason |
|---|---|
| `users → content` | Validate that a bookmarked drama/movie exists and is publicly available |
| `playback → content` | Resolve episode/movie metadata, ordering, and the stored source URL for watch queries |
| `reviews → content` | Validate that the rated/reviewed content item exists and is publicly available |
| `administration → maintenance` | Admin operational summaries read health, alerts, and task history |

No other same-layer imports are allowed. Adding one requires a recorded decision.

`components` may import `lib` and `lib/contracts`; `lib` imports only isomorphic third-party code.

---

## 8. Data Ownership and Cross-Module Reads

1. **One owner per table.** The module that defines a table in `schema.ts` is its only writer.
2. **No foreign writes.** No module, workflow, route handler, or script inserts/updates/deletes another module's tables. A workflow achieves cross-module changes by calling each owner's service inside one transaction.
3. **Reads default to public query APIs.** Cross-module reads go through the owner's `queries.ts`/`index.ts`.
4. **Approved read models.** Cross-module JOINs are allowed only in:
   - `modules/analytics/read-models/` — reporting and analytics;
   - `modules/administration/read-models/` — admin operational summaries;
   - `modules/users/read-models/` — admin user listing over the `auth` identity table;
   - `modules/moderation/queries.ts` — the moderation queue combining content and review reports, documented as an approved read model.
   Each read model documents the tables it reads, its owner, and why a public query is insufficient.
5. **Reporting is not a gatekeeper.** `analytics` is the reporting module, but the watch page reads `playback` + `content` directly, and the admin dashboard reads `administration` + `analytics`. Ordinary operational reads must not be forced through reporting.
6. **Availability is enforced by the owner.** `content` enforces publication/Trash/empty-drama visibility. `playback` returns a source URL only after `content` confirms the content is publicly playable. A guessed URL or direct API call must not bypass this.
7. **Sensitive projections are opt-in.** The video source URL is returned only by watch queries. Admin-only fields are returned only by admin query functions after authorization.

### 8.1 Foreign keys across modules

Cross-module foreign keys are permitted at the database level (for example, `bookmarks.content_id` referencing content). They do not grant write permission. Referential actions are chosen conservatively; destructive cleanup is performed explicitly by the owning module inside `workflows/permanently-delete-content`, not by `ON DELETE CASCADE` across ownership boundaries.

A module's `schema.ts` must not import another module's `schema.ts`. Cross-module foreign-key constraints are declared in SQL migrations (and, where needed, assembled in `src/db/schema.ts`). The exact Drizzle mechanism is settled in Prompt 020; the boundary rule is fixed here.

---

## 9. Authentication and Authorization

### 9.1 Actor kinds

| Actor | Construction | Typical use |
|---|---|---|
| `AnonymousActor` | No session; optional guest session id for analytics | Public reads, view counting |
| `UserActor` | Session → active `auth` user | Authenticated features |
| `AdminActor` | `UserActor` + resolved roles + effective permission set | Admin pages and operations |
| `SystemActor` | Created only by a maintenance script; carries an explicit task identity and a narrow system permission set | Backups, retention, health, aggregation |

Actors are server-generated. A request body, header, cookie value, or client state can never assert a user id, role, or permission.

### 9.2 Permission catalog

- The catalog lives in `modules/authorization/permissions.ts` and is the **only** place permission keys are defined.
- Keys use `resource.action` form: `drama.update`, `episode.publish`, `content.purge`, `review.moderate`, `user.deactivate`, `admin.role.assign`, `settings.update`, `analytics.view`, `export.dataset`, `maintenance.run`.
- `PermissionKey` is a union type. Passing an arbitrary string to a guard is a type error.
- Modules import keys from `authorization`; they never define local permission strings.
- Super Admin resolves to the complete catalog centrally. No code special-cases the role name.

### 9.3 Enforcement points

Authorization is checked twice by design:

1. **Entrypoint guard** — the Server Action, route handler, or protected page resolves the actor and performs a coarse check (`requireUser`, `requireAdmin`, `requirePermission`).
2. **Service guard** — the called service re-checks the specific permission and resource-level rules (ownership, target state, last-Super-Admin invariant) using the passed actor.

Query services additionally filter by visibility and ownership. A caller cannot obtain another user's private data by passing a different id.

### 9.4 Resource-level rules

- Users may mutate only their own ratings, reviews, reactions, reports, bookmarks, and progress.
- Moderators act only through `review.moderate` and the moderation permissions. Review removal is permanent and cannot be undone.
- Only Super Admin may permanently delete content, export datasets, or change system configuration.
- The last effective Super Admin cannot be removed.
- Deactivated accounts cannot use authenticated features even if a stale session exists.

### 9.5 Navigation is not authorization

Admin navigation may hide links the actor cannot use, but every page, action, and endpoint enforces access independently. Hidden UI is never treated as a boundary.

---

## 10. Transactions and Consistency

### 10.1 Primitives

- `platform/db/pool.ts` owns the single connection pool.
- `src/db/client.ts` creates the Drizzle instance from the pool and the schema registry.
- `src/db/schema.ts` assembles every module's `schema.ts`. It is the only file allowed to import them.
- `platform/db/transaction.ts` exports `withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T>` and the `DbExecutor` type.
- Repositories accept a `DbExecutor`. Services accept an optional `DbExecutor` and forward it to every repository call. When omitted, the repository uses the pool.

### 10.2 Rules

1. A workflow that requires atomicity opens exactly one `withTransaction` and passes the same `tx` to every participating module operation.
2. Modules never call `withTransaction` inside a workflow-participating operation, and never commit independently.
3. Any thrown error rolls the transaction back. Partial writes are not permitted when the operation is all-or-nothing.
4. Post-commit effects (cache invalidation, push dispatch) run after commit. If a post-commit effect fails, the committed data remains valid and the failure is recorded; there is no automatic retry loop.
5. No distributed transactions, no two-phase commit, no eventual consistency, no outbox, no queue.
6. Reads that do not require atomicity do not open transactions.
7. Long-running work (backups, exports) uses bounded queries and does not hold a transaction open across user interaction.

### 10.3 Operations that require a transaction

Publishing with notifications, source replacement with progress reset, permanent deletion with dependent cleanup, structure conversion, episode moves/reordering, bulk publication, rating/review uniqueness enforcement, admin role changes, and CSV import apply steps.

---

## 11. Errors, Logging, and HTTP Mapping

### 11.1 Error hierarchy

`platform/errors` defines the base `AppError` with a stable `code`, a safe message, optional field errors, and an internal cause. Subclasses:

| Error | Meaning | HTTP | Server Action result |
|---|---|---|---|
| `ValidationError` | Invalid input | 400 | `{ ok: false, code, fieldErrors }` |
| `AuthenticationError` | No/invalid session | 401 | `{ ok: false, code }` |
| `AuthorizationError` | Authenticated but not permitted | 403 | `{ ok: false, code }` |
| `NotFoundError` | Missing or not visible | 404 | `{ ok: false, code }` |
| `ConflictError` | State conflict, duplicate, invariant violation | 409 | `{ ok: false, code }` |
| `RateLimitError` | Limit exceeded | 429 | `{ ok: false, code, retryAfter }` |
| `InternalError` | Unexpected failure | 500 | `{ ok: false, code: "internal" }` |

Modules may define domain errors that extend these classes (for example, `ContentNotPlayableError extends ConflictError`). They must not invent new transport semantics.

### 11.2 Rules

- Services throw typed errors. They never return HTTP objects or status codes.
- `platform/http` maps errors to responses; `app` Server Actions map errors to action results. Mapping logic exists once.
- Internal details (SQL, stack traces, credentials, URLs with tokens) never reach the client.
- Unknown errors are wrapped as `InternalError`, logged with full context, and returned as a generic message.

### 11.3 Logging

- `platform/logging` configures Pino with JSON output, timestamps, severity, request/correlation id, and module context.
- Redaction covers passwords, OAuth tokens, cookies, session secrets, authorization headers, sensitive query parameters, and video source URLs where required.
- `app` establishes the request id; services accept a logging context and never create ad-hoc loggers.
- Logs are suitable for journald. No external log service is introduced.

### 11.4 Server/client boundary

- **Server Components are the default.** Client Components are introduced only for the Vidstack player, forms with local state, interactive tables/filters, the notification bell, and push-permission flows.
- `modules/**` and `platform/**` are server-only. Every module `index.ts` and every platform entrypoint imports `server-only`.
- `components/**` may import only `lib`, `lib/contracts`, and third-party client libraries. It may not import a module, repository, DB client, or authorization code.
- Client Components receive serializable DTOs as props. They never receive raw rows, DB handles, session secrets, or permission internals.
- `lib/contracts/**` contains the client-safe DTO and form-schema definitions. It imports no server code.
- Secrets are read only by `platform/config` in server code. No secret uses a `NEXT_PUBLIC_*` variable.

### 11.5 Caching and invalidation

- Only public, non-personalized data may be cached. Private user data, admin data, and unpublished content are never cached in a shared layer.
- `platform/cache` exposes tag helpers. Tags are derived from content identity and list identity, for example `content:drama:<id>`, `content:movie:<id>`, `content:list:trending`, `content:list:recent`.
- Mutating workflows invalidate the affected tags after commit.
- Analytics aggregates may be cached separately from raw events and must show their last-updated time.

---

## 12. Progress and Maintenance

### 12.1 Maintenance command framework

- Provide a common framework for short-lived systemd-triggered maintenance commands: structured logs, safe configuration loading, execution results, error handling, and exit codes.
- Support backup, validation, retention cleanup, and approved low-frequency aggregation tasks.
- Do not create persistent workers, a job queue, a general-purpose task scheduler, or a separate worker service.

### 12.2 Task monitoring and history

- Record task name, start/end time, duration, success/failure, and safe error information for short-lived scheduled maintenance commands.
- Do not implement worker heartbeats, queue monitoring, queue wait times, or persistent worker dashboards.
- Maintain execution history for failed, retried, recovered, and critical maintenance operations.
- Keep successful routine records lightweight.
- Use configurable retention and redact secrets; prevent unbounded growth.

### 12.3 Task dependencies and controls

- Approved dependencies:
  - Backup before backup validation.
  - Backup validation before retention cleanup.
  - Image upload before validating image metadata and activating the asset.
  - Direct MP4 URL entry before browser preview, administrator confirmation, and manual publication.
- Ensure dependent operations do not run against invalid or incomplete data.
- Provide Super Admin controls appropriate to short-lived maintenance execution, including emergency pause/resume where meaningful.
- Do not introduce queue priorities, worker concurrency management, queue dashboards, or advanced worker scaling. Concurrency controls may only address actual short-lived maintenance execution and prevent conflicting operations.

### 12.4 Maintenance mode

- [Content to be developed in later prompts]

---

## 13. Future Extraction

- The modular monolith design preserves the possibility of future extraction. Modules own their tables and expose narrow public APIs; a future split into separate frontend/backend services would require redefining the dependency matrix and migrating data ownership, but the single-deployable architecture is not a technical constraint—it is a product decision for the initial release.
- If a future upgrade requires separating services, it must be designed and approved as a separate decision (see §16.2 in REQUIREMENTS.md and the future upgrade backlog in `INITIAL_SCOPE_AND_FUTURE_BACKLOG.md`).