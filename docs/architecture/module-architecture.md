# Module Architecture

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Version:** 1.0  
**Date:** 2026-11-08

This document describes the eleven-domain-module structure and their boundaries, as approved in Prompt 003 and recorded in DECISIONS.md D-008–D-012.

---

## 1. Module Overview

The application has **eleven feature modules**, each owning its tables and exposing exactly one public `index.ts`. No module may import another module to trigger a side effect; cross-module coordination happens through `src/workflows/`.

### 1.1 Module Ownership Rule

- **Each table is owned by exactly one module** (`ARCHITECTURE.md` §6, §10).
- **No module writes another module's tables.** Not even a workflow; a workflow calls each owner's service inside a shared transaction.
- **Cross-module reads** use the owner's public query API or an approved read model.
- **Cross-module foreign keys** are declared in SQL migrations, not by importing another module's `schema.ts`.

### 1.2 Module Assignment to Layers

Modules are assigned to fixed layers. See `ARCHITECTURE.md` §3 for the layer matrix.

| Module           | Layer | Purpose                                                |
| ---------------- | ----- | ------------------------------------------------------ |
| `auth`           | 1     | Authentication and identity                            |
| `authorization`  | 2     | RBAC and permission catalog                            |
| `content`        | 3     | Content management (dramas, seasons, episodes, movies) |
| `users`          | 3     | User profile and bookmarks                             |
| `playback`       | 3     | Playback, progress, and history                        |
| `reviews`        | 3     | Ratings, reviews, reactions, review reports            |
| `moderation`     | 4     | Content reports and moderation records                 |
| `notifications`  | 4     | User and admin notifications                           |
| `analytics`      | 4     | Product analytics and reporting                        |
| `administration` | 5     | Admin operations and system configuration              |
| `maintenance`    | 5     | Operations and observability                           |

---

## 2. Module Catalog

### 6.1 `auth` — Authentication and identity

- **Purpose:** Better Auth integration, Google OAuth, session resolution, first-sign-in user creation, approved Google profile synchronization, account status, session revocation.
- **Owns:** Better Auth tables (`user`, `account`, `session`, `verification`), canonical user identity, `account_status` (`active` / `deactivated`), Google name and image reference, session metadata.
- **Public API:** `getSession`, `requireUser`, `resolveActorIdentity`, `syncGoogleProfile`, `setAccountStatus`, `revokeSession`, `revokeAllSessions`, `isDeactivated`.
- **Depends on:** platform.
- **Not responsible for:** roles, permissions, admin authorization, profile page composition, bookmarks, notification preferences.
- **Boundary notes:** deactivated accounts are rejected during session resolution, before any feature service runs. `auth` never queries role tables.

### 6.2 `authorization` — RBAC and guards

- **Purpose:** centralized permission catalog, roles, role-permission mappings, admin role assignment, effective permission resolution, access-control guards, last-Super-Admin invariant.
- **Owns:** `roles`, `role_permissions`, `user_roles` (administrator role assignments), and the code-level permission catalog.
- **Public API:** `PERMISSIONS` (typed catalog), `PermissionKey`, `ActorContext` and actor constructors, `resolveActor`, `requirePermission`, `requireAnyPermission`, `hasPermission`, `assertResourceAccess`, `assignRole`, `removeRole`, `assertSuperAdminInvariant`.
- **Depends on:** `auth`, platform.
- **Not responsible for:** sign-in, sessions, admin account lifecycle records, content rules, UI navigation filtering (navigation may read permissions but is not the boundary).
- **Boundary notes:** effective permissions are the union of all assigned roles; Super Admin resolves to the full catalog centrally. The last-Super-Admin check is enforced inside this module, not in the UI.

### 6.3 `content` — Content management

- **Purpose:** dramas, seasons, episodes, standalone movies, hierarchy, taxonomies, similar dramas, publication state, Trash/restore, structure conversion, episode ordering/moving, information pages, SEO overrides, slug history/redirects, sitemap eligibility, image asset metadata, direct MP4 source URL storage and syntax validation.
- **Owns:** `dramas`, `seasons`, `episodes`, `movies`, `categories`, `platforms`, `drama_categories`, `drama_platforms`, `movie_categories`, `movie_platforms`, `similar_dramas`, `information_pages`, `content_slug_history`, `content_seo`, `content_assets`, `sitemap_exclusions`; the `video_source_url` columns on episodes and movies.
- **Public API:** public detail/card/list queries with visibility enforcement, admin list queries, create/update/delete/restore/purge services, publish/unpublish, bulk publication, reorder/move, conversion, similar-drama management, slug resolution and redirect lookup, availability assertions, playback-source lookup with availability enforcement, taxonomy CRUD.
- **Depends on:** `authorization`, `auth`, platform.
- **Not responsible for:** playback progress, watch history, ratings/reviews, view counts, notifications, moderation records, image file I/O (files live on disk; this module stores metadata and paths).
- **Boundary notes:** publication workflows are invoked through `workflows/publish-content`, not by other modules. Public queries never return unpublished ortrashed content. Watch queries obtain the source URL through `playback`, not from a general details query.

### 6.4 `users` — User profile and bookmarks

- **Purpose:** private profile projection, My List / bookmarks, user account status actions (deactivate/reactivate), admin user-management queries.
- **Owns:** `bookmarks`; admin user-listing read model (read-only projection over `auth` identity data).
- **Public API:** `getProfile`, `listBookmarks`, `isBookmarked`, `addBookmark`, `removeBookmark`, `toggleBookmark`, `listUserIdsBookmarking`, `deactivateUser`, `reactivateUser`, `listUsersForAdmin`.
- **Depends on:** `auth`, `authorization`, `content` (availability validation for bookmarks), platform.
- **Not responsible for:** authentication, sessions, roles, playback data, notifications, reviews.
- **Boundary notes:** deactivation calls `auth.setAccountStatus` and does not write auth tables directly. Bookmark validation reads content availability through `content`'s public query API.

### 6.5 `playback` — Playback, progress, and history

- **Purpose:** subtitle tracks, playback progress, watched/unwatched state, Continue Watching, watch history, progress reset after source replacement, watch-page data composition.
- **Owns:** `subtitle_tracks`, `playback_progress`, `watch_history`, `episode_watch_state`.
- **Public API:** `getWatchPageData` (returns the source URL only when the content is publicly playable), `saveProgress`, `markWatched`, `markUnwatched`, `getContinueWatching`, `getWatchHistory`, `resetEpisodeProgress`, `resetMovieProgress`, `listSubtitleTracks`, `upsertSubtitleTrack`, `deleteSubtitleTrack`.
- **Depends on:** `content`, `authorization`, `auth`, platform.
- **Not responsible for:** video validation preview (a browser concern), video hosting, analytics events, notifications, ratings.
- **Boundary notes:** progress updates are debounced by the client and bounded server-side. Older updates never overwrite newer ones (server compares timestamps). `playback` does not call `analytics`; progress/playback events are emitted by `workflows/save-playback-progress`.

### 6.6 `reviews` — Ratings, reviews, reactions, review reports

- **Purpose:** content-level ratings and reviews for dramas and movies, Enjoying reactions, review sorting and aggregates, review reporting, review removal.
- **Owns:** `ratings`, `reviews`, `review_reactions`, `review_reports`.
- **Public API:** `submitRating`, `getRatingSummary`, `submitReview`, `editReview`, `listReviews`, `addReaction`, `removeReaction`, `reportReview`, `listReportedReviews`, `removeReview` (requires `review.moderate`).
- **Depends on:** `content`, `authorization`, `auth`, platform.
- **Not responsible for:** episode ratings/reviews (excluded), content reports, moderation audit, reporter notifications.
- **Boundary notes:** one active rating and one active review per user per content item. Public averages use each user's latest active rating. Removal is permanent and only through an authorized service.

### 6.7 `moderation` — Content reports and moderation records

- **Purpose:** user-facing content reports, moderation queues, moderation outcomes, moderation audit records.
- **Owns:** `content_reports`, `moderation_actions`.
- **Public API:** `submitContentReport`, `listContentReports`, `resolveContentReport`, `getModerationQueue`, `recordModerationAction`.
- **Depends on:** `content`, `users`, `reviews`, `authorization`, `auth`, platform.
- **Not responsible for:** review storage or review removal (delegated to `reviews`), user deactivation (delegated to `users`), reporter notifications (workflow).
- **Boundary notes:** reported reviews remain visible while pending. `getModerationQueue` is an approved read model combining content reports and review reports; it is read-only.

### 6.8 `notifications` — User and admin notifications

- **Purpose:** notification preferences, in-app notifications, browser push subscriptions and delivery, announcements, admin notification center, unread counts, delivery records.
- **Owns:** `notification_preferences`, `notifications`, `push_subscriptions`, `notification_deliveries`, `announcements`, `admin_notifications`.
- **Public API:** `createContentPublishedNotifications`, `createSeasonNotifications`, `createAnnouncementNotifications`, `notifyAccountSecurity`, `notifyReporter`, `listNotifications`, `markRead`, `markUnread`, `getUnreadCount`, `upsertPushSubscription`, `removePushSubscription`, `publishAnnouncement`, `listAdminNotifications`.
- **Depends on:** `users` (bookmark-based recipient resolution), `authorization`, `auth`, platform.
- **Not responsible for:** deciding when content is published, content metadata ownership, admin authorization, analytics.
- **Boundary notes:** callers pass validated payload snapshots (content id, type, title, deep link). `notifications` does not import `content`. Push providers sit behind an internal provider interface so the provider can change without touching notification rules.

### 6.9 `analytics` — Product analytics and reporting

- **Purpose:** privacy-conscious guest sessions, content view counting with the six-hour rule, playback analytics ingestion, aggregation, admin analytics dashboards, and the designated cross-module reporting read models.
- **Owns:** `guest_sessions`, `content_view_events`, `playback_analytics_events`, `analytics_daily_aggregates`, `search_events` (if required by later prompts).
- **Public API:** `recordContentView`, `recordPlaybackEvent`, `getContentViewCount`, `getAnalyticsOverview`, `getContentPerformance`, `getViewerActivity`, `getEngagementTrends`, `purgeExpiredGuestData`.
- **Depends on:** `content`, `users`, `playback`, `reviews` (reporting reads only), `authorization`, `auth`, platform.
- **Not responsible for:** personal watch history or progress (owned by `playback`), operational system metrics and errors (owned by `maintenance`), notifications.
- **Boundary notes:** this is the reporting module. Cross-module joins are allowed only in `analytics/read-models/` and only for read-only reporting. It is **not** a mandatory intermediary for the watch page or admin operational summaries.

### 6.10 `administration` — Admin operations and system configuration

- **Purpose:** administrator account lifecycle records, admin session policy and termination records, login-attempt monitoring, system configuration and version history, maintenance-mode configuration, admin dashboard layouts, admin audit, operational dashboard summaries.
- **Owns:** `admin_accounts`, `admin_login_attempts`, `admin_session_events`, `system_settings`, `system_setting_versions`, `admin_dashboard_layouts`, `admin_audit_log`.
- **Public API:** `authorizeAdminRecord`, `deactivateAdminRecord`, `listAdminSessions`, `recordSessionTermination`, `recordLoginAttempt`, `getSetting`, `listSettings`, `updateSetting`, `getSettingHistory`, `restoreSettingVersion`, `getOperationalSummary`, `getDashboardLayout`, `saveDashboardLayout`.
- **Depends on:** all modules (read-only for summaries), `authorization`, `auth`, platform.
- **Not responsible for:** role definitions (owned by `authorization`), session storage (owned by `auth`), admin notifications (owned by `notifications`), backups and health (owned by `maintenance`).
- **Boundary notes:** multi-module state changes (authorizing an admin, changing roles, terminating sessions) run through workflows. `getOperationalSummary` is an approved read-only cross-module query in `administration/read-models/`.

### 6.11 `maintenance` — Operations and observability

- **Purpose:** maintenance command framework, task history, backup creation/validation/retention records, health checks, disk/capacity monitoring, alerts, incidents, built-in error records.
- **Owns:** `maintenance_task_runs`, `backup_manifests`, `system_alerts`, `incidents`, `incident_notes`, `incident_attachments`, `error_records`, `health_snapshots`.
- **Public API:** `runTask` (framework), `getTaskHistory`, `createBackup`, `validateBackup`, `applyBackupRetention`, `getHealth`, `getDiskUsage`, `createAlert`, `acknowledgeAlert`, `listIncidents`, `recordIncidentNote`, `recordError`, `purgeExpiredErrors`.
- **Depends on:** platform, `authorization`, `auth`; may read any other module except `administration` for diagnostics.
- **Not responsible for:** serving public traffic, persistent scheduling, retries, queueing, product analytics.
- **Boundary notes:** executed by `scripts/maintenance/*` under a `SystemActor`. Cross-module cleanup (Trash expiry, retention) is orchestrated by the script through workflows, not by `maintenance` writing other modules' tables. Error ingestion is called from `app`-level error boundaries/instrumentation, never from `platform`.

---

## 3. Standard Module File Roles

| File                            | Responsibility                                                                        | May use the database client         |
| ------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------- |
| `index.ts`                      | Public re-exports only                                                                | No                                  |
| `schema.ts`                     | Drizzle table definitions owned by the module                                         | No (types only)                     |
| `validation.ts`                 | Zod input schemas and parsers                                                         | No                                  |
| `repository.ts` / `repository/` | All Drizzle queries and mutations for owned tables                                    | Yes (`@/db/client`)                 |
| `queries.ts` / `queries/`       | Read services; authorization and visibility filtering; DTO shaping                    | No (calls repository)               |
| `service.ts` / `service/`       | Write services, domain rules, transaction participation                               | No (type-only `DbExecutor` allowed) |
| `read-models/`                  | Approved cross-module read-only queries (`analytics`, `administration`, `users` only) | Yes (`@/db/client`)                 |
| `providers/`                    | Isolated external-provider adapters (`notifications` only)                            | No                                  |

Large modules may split `service.ts` and `repository.ts` into folders, provided `index.ts` remains the only public surface.

---

## 4. Service Categories

| Category                       | Location                  | Called by                                           | Contains                                                               | Must not                                                     |
| ------------------------------ | ------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| Module query service           | `modules/*/queries.ts`    | Server Components, workflows, permitted modules     | Visibility/authorization filtering, DTO shaping, read-only composition | Writes, HTTP, cache invalidation                             |
| Module mutation service        | `modules/*/service.ts`    | Server Actions, route handlers, workflows           | Domain rules, input validation, transaction participation              | HTTP, cross-module side effects, independent commits         |
| Workflow (application service) | `src/workflows/`          | Server Actions, route handlers, maintenance scripts | Sequencing, transaction boundary, post-commit effects                  | Domain rules, SQL, HTTP parsing                              |
| Platform service               | `src/platform/`           | Modules, workflows, `app`                           | DB pool, config, errors, logging, rate limiting, cache, HTTP mapping   | Domain rules, module imports                                 |
| Repository                     | `modules/*/repository.ts` | The owning module's services, queries, read models  | Drizzle reads/writes for the module's own tables                       | Cross-module writes, business rules, authorization decisions |

There is no general-purpose "shared domain service" bucket. Cross-module reuse happens through a module's public API or a workflow. Shared code is limited to `platform` (server infrastructure) and `lib` (isomorphic helpers and contracts). This prevents a second, unowned domain layer from forming.

---

## 5. Directory Structure Overview

```
src/
  app/                      # App Router entrypoints
  workflows/                # cross-module orchestration; no UI, no HTTP
  modules/                  # 11 domain modules
    auth/
    authorization/
    content/
    users/
    playback/
    reviews/
    moderation/
    notifications/
    analytics/
    administration/
    maintenance/
    db/                     # composition root: schema registry + Drizzle instance
    platform/               # server infrastructure
    components/             # client-safe UI
    lib/                    # isomorphic helpers + client-safe contracts
  db/                       # composition root: schema registry + Drizzle instance
  platform/                 # server infrastructure
  components/               # client-safe UI
  lib/                      # isomorphic helpers + client-safe contracts
scripts/                    # maintenance commands
tests/                      # unit, integration, e2e
```

Rules for the tree:

- `src/app` contains routing and entrypoint adaptation only. No business rules.
- `src/modules/*/index.ts` is the only cross-module import target. Everything else inside a module is private.
- `src/components` contains no data fetching and imports no module. Data fetching happens in `app` Server Components; presentational components receive props.
- `src/lib/contracts` holds the only types/schemas that may cross into the browser bundle from a domain.
- `src/db` is the schema/client composition root. It may import every module's `schema.ts` and the platform pool; nothing else may import `@/db/schema`. This is the single documented exception to the module `index.ts` import rule, because assembling the Drizzle schema requires the table definitions.
- `src/scripts/maintenance` is an application-layer consumer of modules and workflows. It is never imported by `app`.

---

## 6. Dependency Matrix

See `ARCHITECTURE.md` §7 for the full matrix. Only these same-layer edges are permitted (exhaustive list in §7.1):

- `users → content`
- `playback → content`
- `reviews → content`
- `administration → maintenance`

No other same-layer imports are allowed.

`components` may import `lib` and `lib/contracts`; `lib` imports only isomorphic third-party code.

---

## 7. Inter-Module Communication and Orchestration

### 7.1 Direct calls

A module calls another module only through that module's public `index.ts`, only when the dependency matrix permits it, and only for a read or a write that belongs to the callee. The caller passes:

1. a trusted `ActorContext` (first argument),
2. a validated input object,
3. an optional shared `DbExecutor` when participating in a workflow transaction.

### 7.2 Workflows

A **workflow** is a thin application-layer function in `src/workflows/` that coordinates two or more modules. It:

- contains sequencing, authorization entry checks, and transaction boundaries — **not** domain rules;
- calls each participating module's public API independently;
- passes validated payloads and the actor explicitly;
- owns the shared transaction when atomicity is required (§12);
- performs post-commit effects (cache invalidation, push dispatch) after the transaction commits;
- is invoked by a Server Action, route handler, or maintenance script — never by a module.

Workflows are not a general abstraction. A single-module operation stays in that module's service. A workflow exists only when coordination is genuinely required.

### 7.3 Workflow catalog (initial)

See `ARCHITECTURE.md` §8.4 for the full workflow catalog.

### 7.4 Prohibited communication mechanisms

- No event bus, message broker, outbox processor, queue, or background worker.
- No in-process pub/sub used to avoid a direct call.
- No shared mutable module state.
- No cross-module table writes.
- No "temporary" circular import to make a side effect work.

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

Cross-module foreign keys are permitted at the database level but do not grant write permission. Referential actions are chosen conservatively; destructive cleanup is performed explicitly by the owning module inside `workflows/permanently-delete-content`, not by `ON DELETE CASCADE` across ownership boundaries.

A module's `schema.ts` must not import another module's `schema.ts`. Cross-module foreign-key constraints are declared in SQL migrations, not in the Drizzle schema. `src/db/schema.ts` spreads each module's namespace into one registry; intra-module constraints use named Drizzle builders. The boundary rule is fixed here; the Prompt 020 composition is documented in `DATABASE.md` §2.4.

---

## 9. Authentication and Authorization

### 9.1 Actor kinds

| Actor            | Construction                                                                                               | Typical use                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `AnonymousActor` | No session; optional guest session id for analytics                                                        | Public reads, view counting             |
| `UserActor`      | Session → active `auth` user                                                                               | Authenticated features                  |
| `AdminActor`     | `UserActor` + resolved roles + effective permission set                                                    | Admin pages and operations              |
| `SystemActor`    | Created only by a maintenance script; carries an explicit task identity and a narrow system permission set | Backups, retention, health, aggregation |

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

### 9.1 Primitives

- `platform/db/pool.ts` owns the single connection pool.
- `src/db/client.ts` creates the Drizzle instance from the pool and the schema registry.
- `src/db/schema.ts` assembles every module's `schema.ts`. It is the only file allowed to import them.
- `platform/db/transaction.ts` exports `withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T>` and the `DbExecutor` type.
- Repositories accept a `DbExecutor`. Services accept an optional `DbExecutor` and forward it to every repository call. When omitted, the repository uses the pool.

### 9.2 Rules

1. A workflow that requires atomicity opens exactly one `withTransaction` and passes the same `tx` to every participating module operation.
2. Modules never call `withTransaction` inside a workflow-participating operation, and never commit independently.
3. Any thrown error rolls the transaction back. Partial writes are not permitted when the operation is all-or-nothing.
4. Post-commit effects (cache invalidation, push dispatch) run after commit. If a post-commit effect fails, the committed data remains valid and the failure is recorded; there is no automatic retry loop.
5. No distributed transactions, no two-phase commit, no eventual consistency, no outbox, no queue.
6. Reads that do not require atomicity do not open transactions.
7. Long-running work (backups, exports) uses bounded queries and does not hold a transaction open across user interaction.

### 9.3 Operations that require a transaction

Publishing with notifications, source replacement with progress reset, permanent deletion with dependent cleanup, structure conversion, episode moves/reordering, bulk publication, rating/review uniqueness enforcement, admin role changes, and CSV import apply steps.

---

## 11. Errors, Logging, and HTTP Mapping

### 11.1 Error hierarchy

`platform/errors` defines the base `AppError` with a stable `code`, a safe message, optional field errors, and an internal cause. Subclasses:

| Error                 | Meaning                                        | HTTP | Server Action result               |
| --------------------- | ---------------------------------------------- | ---- | ---------------------------------- |
| `ValidationError`     | Invalid input                                  | 400  | `{ ok: false, code, fieldErrors }` |
| `AuthenticationError` | No/invalid session                             | 401  | `{ ok: false, code }`              |
| `AuthorizationError`  | Authenticated but not permitted                | 403  | `{ ok: false, code }`              |
| `NotFoundError`       | Missing or not visible                         | 404  | `{ ok: false, code }`              |
| `ConflictError`       | State conflict, duplicate, invariant violation | 409  | `{ ok: false, code }`              |
| `RateLimitError`      | Limit exceeded                                 | 429  | `{ ok: false, code, retryAfter }`  |
| `InternalError`       | Unexpected failure                             | 500  | `{ ok: false, code: "internal" }`  |

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
