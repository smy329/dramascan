# ARCHITECTURE

**Project:** DramaScan — International Drama & Movie Streaming Platform
**Document:** Modular monolith architecture, module boundaries, and communication rules
**Version:** 1.0
**Date:** 2026-11-08
**Status:** Approved (Prompt 003). Supersedes no prior architecture document; this is the first.

**Authority chain:** `AGENTS.md` (Detailed Micro-Prompt Development Pack) → `REQUIREMENTS.md` → `DECISIONS.md` → this document. Where this document and a higher document disagree, the higher document wins and this document must be corrected.

**Scope of this document:** the internal shape of the single Next.js deployable: layers, modules, dependency direction, public APIs, entrypoint allocation, data ownership, transaction coordination, error/logging boundaries, and enforcement. It does not define the database schema (Prompt 020+), REST contracts (later prompts), or UI design.

---

## 1. Architectural Drivers

These are fixed by the specification and are not open for reinterpretation here:

| Driver                                                             | Consequence                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Single Next.js App Router deployment, low-RAM production server    | One process, one PostgreSQL database, no service split                   |
| PostgreSQL + Drizzle ORM                                           | One connection pool; transactions are local and cheap                    |
| Better Auth, Google OAuth only                                     | Authentication is a bounded integration, not a general identity platform |
| Server-side authorization is the security authority                | Guards at every entrypoint and re-checks inside services                 |
| Direct external HTTPS MP4 playback                                 | No media pipeline, no storage service, no proxy module                   |
| No Docker, Redis, queues, workers, SSE, WebSockets                 | No event bus, no asynchronous cross-module consistency                   |
| Short-lived systemd maintenance commands                           | Maintenance is a CLI entrypoint, not a runtime service                   |
| Preserve data across edits, moves, conversions, source replacement | Transactions and explicit ownership; no cross-module table writes        |
| Future extraction must remain possible                             | Modules own their tables and expose narrow public APIs                   |

### 1.1 Approved rule index

The nine rules approved with this architecture are binding. This index maps each rule to where it is specified and how it is enforced.

| Rule                     | Subject                                                          | Specified in | Enforced by                                         |
| ------------------------ | ---------------------------------------------------------------- | ------------ | --------------------------------------------------- |
| 1                        | Dependency direction and module boundaries                       | §3, §7       | ESLint boundaries, `import/no-cycle`, §17           |
| 2                        | Inter-module communication and orchestration                     | §8           | Workflow layer, dependency matrix, §17              |
| 3                        | Reads, writes, Server Actions, and REST boundaries               | §9           | Entrypoint review, shared services, §17             |
| 4                        | Database ownership and cross-module data access                  | §10          | Repository boundaries, read-model allowlist, review |
| 5                        | Centralized authentication and authorization                     | §11          | Guards, typed permission catalog, service re-checks |
| 6                        | Transaction ownership and consistency                            | §12          | `withTransaction`, explicit `DbExecutor`, review    |
| 7                        | Shared error handling and domain error boundaries                | §13          | Typed errors, single HTTP mapping, logging          |
| 8                        | Strict client-server and UI boundaries                           | §14          | `server-only`, lint zones, DTO contracts            |
| 9                        | Automated enforcement and maintainability                        | §17, §18     | CI, lint, types, decision log                       |
| Implementation principle | Single deployable, shared PostgreSQL, no excluded infrastructure | §2, §18      | Review, §17                                         |

---

## 2. System Shape

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
                                                        ▼
                                                   PostgreSQL
                                                        ▲
systemd timers ──► scripts/maintenance/*.ts ────────────┘
                   (short-lived, use modules + workflows)
```

- The browser never asks the application server for video bytes. It plays the stored URL directly.
- Maintenance commands are separate process invocations. They share code with the application but are not imported by public request paths.
- There is exactly one runtime datastore. No cache server, broker, or secondary store exists.

---

## 3. Layers

Modules are assigned to fixed layers. **A module may import only modules in a strictly lower layer, plus the explicitly listed same-layer edges in §7.1.** Upward imports are prohibited.

| Layer | Location                                               | Contents                                                                                                                               | May import                                                                                                                    |
| ----- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 0     | `src/platform/`                                        | DB client/pool, transaction primitive, env config, error base types, Pino logging, PG-backed rate limiter, cache helpers, HTTP helpers | Nothing from `modules`, `workflows`, `app`, `components`                                                                      |
| 1     | `src/modules/auth`                                     | Authentication, identity, sessions, account status                                                                                     | Platform                                                                                                                      |
| 2     | `src/modules/authorization`                            | RBAC, permission catalog, guards                                                                                                       | Platform, `auth`                                                                                                              |
| 3     | `src/modules/content`, `users`, `playback`, `reviews`  | Core domain                                                                                                                            | Platform, layers 1–2, and the same-layer edges in §7.1                                                                        |
| 4     | `src/modules/moderation`, `notifications`, `analytics` | Supporting domain                                                                                                                      | Platform, layers 1–3, and listed same-layer edges                                                                             |
| 5     | `src/modules/administration`, `maintenance`            | Administration and operations                                                                                                          | Platform, layers 1–4; `administration` may also read `maintenance`; `maintenance` may read any module except `administration` |
| A     | `src/workflows/`                                       | Application orchestration for cross-module operations                                                                                  | Any module, platform                                                                                                          |
| E     | `src/app/`                                             | App Router entrypoints: pages, layouts, Server Actions, route handlers                                                                 | Workflows, modules, platform (limited), components, lib                                                                       |
| U     | `src/components/`                                      | Client-safe UI and client components                                                                                                   | `lib`, `lib/contracts` only                                                                                                   |
| L     | `src/lib/`                                             | Isomorphic helpers and client-safe DTO/schema contracts                                                                                | Third-party isomorphic libraries only                                                                                         |

`platform` is infrastructure, not a domain module. It owns no domain tables.

`src/db` is a composition root outside the layer stack. It may import `platform` and module `schema.ts` files only; no module service, query, or repository. It is the sole place where the Drizzle schema registry is assembled.

### 3.1 Authentication vs authorization dependency direction

- **`authorization` may import `auth`. `auth` must never import `authorization`.**
- `auth` answers _who is this?_ It resolves a session to a canonical user identity and account status. It makes no permission decisions and has no concept of roles.
- `authorization` answers _what may this actor do?_ It resolves identity → roles → effective permissions and evaluates permission keys and resource-level rules.
- This direction prevents the classic cycle where sign-in needs roles and roles need sign-in. Authentication is complete before authorization is consulted.

---

## 4. Directory Structure

```
src/
  instrumentation.ts              # server startup hook; validates environment config
  app/
    (public)/                     # public pages, Server Components by default
    (auth)/                       # sign-in, auth error pages
    admin/                        # protected admin shell and pages
    api/
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
    actions/                      # Server Actions grouped by area (thin)
    layout.tsx
    globals.css
  workflows/                      # cross-module orchestration; no UI, no HTTP
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
  modules/
    auth/
      index.ts                    # public API, server-only
      schema.ts                   # Better Auth tables + account status
      service.ts                  # identity sync, sessions, status
      queries.ts
      validation.ts
      repository.ts
    authorization/
      index.ts
      schema.ts                   # roles, permissions, user_roles
      permissions.ts              # THE permission catalog (single source)
      actors.ts                   # Anonymous/User/Admin/System actor types
      guards.ts                   # requirePermission, resource checks
      service.ts
      queries.ts
    content/
      index.ts
      schema.ts                   # dramas, seasons, episodes, movies, taxonomies, pages, slug history
      service.ts
      queries.ts
      validation.ts
      repository.ts
      conversion.ts               # structure conversion (content-internal)
    users/
      index.ts
      schema.ts                   # bookmarks
      service.ts
      queries.ts
      validation.ts
      repository.ts
      read-models/                # approved admin user listing over auth identity (read-only)
    playback/
      index.ts
      schema.ts                   # subtitle_tracks, playback_progress, watch_history
      service.ts
      queries.ts
      validation.ts
      repository.ts
    reviews/
      index.ts
      schema.ts                   # ratings, reviews, review_reactions, review_reports
      service.ts
      queries.ts
      validation.ts
      repository.ts
    moderation/
      index.ts
      schema.ts                   # content_reports, moderation_actions
      service.ts
      queries.ts
      validation.ts
      repository.ts
    notifications/
      index.ts
      schema.ts                   # preferences, notifications, push_subscriptions, announcements, deliveries
      service.ts
      queries.ts
      validation.ts
      repository.ts
      providers/                  # push provider abstraction (isolated)
    analytics/
      index.ts
      schema.ts                   # guest_sessions, view events, playback events, aggregates
      service.ts
      queries.ts
      validation.ts
      repository.ts
      read-models/                # approved cross-module read-only queries
    administration/
      index.ts
      schema.ts                   # admin accounts, login attempts, settings, versions, layouts, audit
      service.ts
      queries.ts
      validation.ts
      repository.ts
      read-models/                # approved operational summaries
    maintenance/
      index.ts
      schema.ts                   # task runs, backup manifests, alerts, incidents, error records
      service.ts                  # task framework, backups, health, alerts
      queries.ts
      validation.ts
      repository.ts
  db/                             # composition root: schema registry + Drizzle instance
    schema.ts                     # assembles every module's schema.ts (only place allowed to)
    client.ts                     # Drizzle instance from platform pool + schema
  platform/
    db/
      pool.ts                     # connection pool
      transaction.ts              # withTransaction, DbExecutor type
    config/                       # Zod-validated environment
    errors/                       # AppError hierarchy
    logging/                      # Pino, redaction, request context
    rate-limit/                   # PostgreSQL-backed limiter
    cache/                        # cache tags + invalidation helpers
    http/                         # error → HTTP mapping, response helpers
  components/
    ui/                           # shadcn/ui primitives
    public/                       # presentational public components
    admin/                        # presentational admin components
    player/                       # Vidstack client wrapper
  lib/
    contracts/                    # client-safe DTOs and form schemas per domain
    utils/                        # isomorphic helpers
  scripts/
    maintenance/
      trash-expiry.ts
      backup.ts
      validate-backup.ts
      retention-cleanup.ts
      analytics-retention.ts
      aggregate-daily.ts
      health-report.ts
      index.ts                    # command dispatcher
```

Repository-root tests hold the test suites:

```
tests/
  unit/
  integration/
  e2e/
  fixtures/
```

Rules for the tree:

- `src/app` contains routing and entrypoint adaptation only. No business rules.
- `src/modules/*/index.ts` is the only cross-module import target. Everything else inside a module is private.
- `src/components` contains no data fetching and imports no module. Data fetching happens in `app` Server Components; presentational components receive props.
- `src/lib/contracts` holds the only types/schemas that may cross into the browser bundle from a domain.
- `src/db` is the schema/client composition root. It may import every module's `schema.ts` and the platform pool; nothing else may import `@/db/schema`. This is the single documented exception to the module `index.ts` import rule, because assembling the Drizzle schema requires the table definitions.
- `src/scripts/maintenance` is an application-layer consumer of modules and workflows. It is never imported by `app`.
- Do not pre-create module directories or speculative domain types. Add a module's structure when its implementation begins; shared cross-cutting contracts remain in `src/lib/contracts`.

---

## 5. Rules That Apply to Every Module

1. **Public API only.** A module exposes `index.ts`. It exports query functions, mutation services, and public types. It never exports Drizzle tables, repositories, the DB client, or internal helpers.
2. **Server-only.** Every `index.ts` begins with `import "server-only"`. Module code is never imported by `components` or any file with `"use client"`.
3. **Owns its schema and writes.** `schema.ts` and `repository.ts` belong to the module. Only that module's repository writes its tables. Other modules read through public query functions or approved read models.
4. **Services receive a trusted actor.** Every exported mutation and protected query takes `actor: ActorContext` as its first argument. The actor is built server-side from the session and database; client-supplied identity, roles, or permissions are ignored.
5. **Validate at the boundary.** Every service validates its input with Zod, even when the caller already validated it. Validation lives in `validation.ts`; client form schemas live in `lib/contracts` and are composed, not trusted.
6. **No HTTP knowledge.** Services throw typed application errors. They never import `Request`, `Response`, `NextResponse`, status codes, or route helpers.
7. **Return DTOs, not rows.** Public functions return explicit result types. Sensitive columns (video source URLs outside watch queries, internal flags, admin metadata) are never included by default.
8. **Explicit permission keys.** Guards use keys from the central catalog (`drama.create`, `episode.read`, `drama.update`, `review.moderate`, `user.manage`). No role-name comparisons and no generic `isAdmin` checks.
9. **No cross-module side effects.** A module never imports another module to trigger a side effect. That is a workflow's job (§8).
10. **Transactions are passed in.** Write services accept an optional `tx: DbExecutor` and use it for every statement. They never open a competing transaction or commit independently.
11. **No hidden state.** Modules do not keep request-scoped mutable singletons. Any per-request context (actor, request ID, transaction) is passed explicitly.
12. **No mock data.** Production services never return fabricated records, counts, or ratings.

### 5.1 Standard module file roles

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

### 5.2 Service categories

| Category                       | Location                  | Called by                                           | Contains                                                               | Must not                                                     |
| ------------------------------ | ------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| Module query service           | `modules/*/queries.ts`    | Server Components, workflows, permitted modules     | Visibility/authorization filtering, DTO shaping, read-only composition | Writes, HTTP, cache invalidation                             |
| Module mutation service        | `modules/*/service.ts`    | Server Actions, route handlers, workflows           | Domain rules, input validation, transaction participation              | HTTP, cross-module side effects, independent commits         |
| Workflow (application service) | `src/workflows/`          | Server Actions, route handlers, maintenance scripts | Sequencing, transaction boundary, post-commit effects                  | Domain rules, SQL, HTTP parsing                              |
| Platform service               | `src/platform/`           | Modules, workflows, `app`                           | DB pool, config, errors, logging, rate limiting, cache, HTTP mapping   | Domain rules, module imports                                 |
| Repository                     | `modules/*/repository.ts` | The owning module's services, queries, read models  | Drizzle reads/writes for the module's own tables                       | Cross-module writes, business rules, authorization decisions |

There is no general-purpose "shared domain service" bucket. Cross-module reuse happens through a module's public API or a workflow. Shared code is limited to `platform` (server infrastructure) and `lib` (isomorphic helpers and contracts). This prevents a second, unowned domain layer from forming.

---

## 6. Module Catalog

The eleven modules below are the complete initial module set. Adding a twelfth requires a recorded decision (§18).

### 6.1 `auth` — Authentication and identity

- **Purpose:** Better Auth integration, Google OAuth, session resolution, first-sign-in user creation, approved Google profile synchronization, account status, session revocation.
- **Owns:** Better Auth tables (`user`, `account`, `session`, `verification`), canonical user identity, `account_status` (`active` / `deactivated`), Google name and image reference, session metadata.
- **Public API:** `getSession`, `requireUser`, `resolveActorIdentity`, `syncGoogleProfile`, `setAccountStatus`, `revokeSession`, `revokeAllSessions`, `isDeactivated`.
- **Depends on:** platform.
- **Not responsible for:** roles, permissions, admin authorization, profile page composition, bookmarks, notification preferences.
- **Boundary notes:** deactivated accounts are rejected during session resolution, before any feature service runs. `auth` never queries role tables.

### 6.2 `authorization` — RBAC and guards

- **Purpose:** centralized permission catalog, roles, role-permission mappings, admin role assignment, effective permission resolution, access-control guards, last-Super-Admin invariant.
- **Owns:** `roles`, `permissions` (action/resource → granted, composing the canonical `resource.action` key), `user_roles` (administrator role assignments), and the code-level permission catalog.
- **Public API:** `PERMISSIONS`, `ALL_PERMISSION_KEYS`, `SUPER_ADMIN_PERMISSION_KEYS`, `PermissionKey`, `PermissionDefinition`, `isPermissionKey`, `toPermissionKey`, `PERMISSION_RESOURCES`, `PERMISSION_ACTIONS`, `ActorContext`, `anonymousActor`, `userActor`, `resolveActor`, `resolveEffectivePermissionsForUser`, `resolveEffectivePermissions`, `hasPermission`, `requirePermission`, `requireAnyPermission`, `requireUser`, `requireAdmin`, `assertResourceAccess`.
- **Depends on:** `auth`, platform.
- **Not responsible for:** sign-in, sessions, admin account lifecycle records, content rules, UI navigation filtering (navigation may read permissions but is not the boundary).
- **Boundary notes:** effective permissions are the union of all granted permissions across all assigned roles; Super Admin resolves to the full catalog centrally. The last-Super-Admin check is enforced inside this module, not in the UI.

### 6.3 `content` — Content management

- **Purpose:** dramas, seasons, episodes, standalone movies, hierarchy, taxonomies, similar dramas, publication state, Trash/restore, structure conversion, episode ordering/moving, information pages, SEO overrides, slug history/redirects, sitemap eligibility, image asset metadata, direct MP4 source URL storage and syntax validation.
- **Owns:** `dramas`, `seasons`, `episodes`, `movies`, `categories`, `platforms`, `drama_categories`, `drama_platforms`, `movie_categories`, `movie_platforms`, `similar_dramas`, `information_pages`, `content_slug_history`, `content_seo`, `content_assets`, `sitemap_exclusions`; the `video_source_url` columns on episodes and movies.
- **Public API:** public detail/card/list queries with visibility enforcement, admin list queries, create/update/delete/restore/purge services, publish/unpublish, bulk publication, reorder/move, conversion, similar-drama management, slug resolution and redirect lookup, availability assertions, playback-source lookup with availability enforcement, taxonomy CRUD.
- **Depends on:** `authorization`, `auth`, platform.
- **Not responsible for:** playback progress, watch history, ratings/reviews, view counts, notifications, moderation records, image file I/O (files live on disk; this module stores metadata and paths).
- **Boundary notes:** publication workflows are invoked through `workflows/publish-content`, not by other modules. Public queries never return unpublished or trashed content. Watch queries obtain the source URL through `playback`, not from a general details query.

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

## 7. Dependency Matrix

Rows may import columns marked ✓. Everything else is forbidden.

| ↓ imports →        | platform    | auth | authz | content | users | playback | reviews | moderation | notifications | analytics | administration | maintenance | workflows |
| ------------------ | ----------- | ---- | ----- | ------- | ----- | -------- | ------- | ---------- | ------------- | --------- | -------------- | ----------- | --------- |
| **platform**       | —           | ✗    | ✗     | ✗       | ✗     | ✗        | ✗       | ✗          | ✗             | ✗         | ✗              | ✗           | ✗         |
| **auth**           | ✓           | —    | ✗     | ✗       | ✗     | ✗        | ✗       | ✗          | ✗             | ✗         | ✗              | ✗           | ✗         |
| **authorization**  | ✓           | ✓    | —     | ✗       | ✗     | ✗        | ✗       | ✗          | ✗             | ✗         | ✗              | ✗           | ✗         |
| **content**        | ✓           | ✓    | ✓     | —       | ✗     | ✗        | ✗       | ✗          | ✗             | ✗         | ✗              | ✗           | ✗         |
| **users**          | ✓           | ✓    | ✓     | ✓       | —     | ✗        | ✗       | ✗          | ✗             | ✗         | ✗              | ✗           | ✗         |
| **playback**       | ✓           | ✓    | ✓     | ✓       | ✗     | —        | ✗       | ✗          | ✗             | ✗         | ✗              | ✗           | ✗         |
| **reviews**        | ✓           | ✓    | ✓     | ✓       | ✗     | ✗        | —       | ✗          | ✗             | ✗         | ✗              | ✗           | ✗         |
| **moderation**     | ✓           | ✓    | ✓     | ✓       | ✓     | ✗        | ✓       | —          | ✗             | ✗         | ✗              | ✗           | ✗         |
| **notifications**  | ✓           | ✓    | ✓     | ✗       | ✓     | ✗        | ✗       | ✗          | —             | ✗         | ✗              | ✗           | ✗         |
| **analytics**      | ✓           | ✓    | ✓     | ✓       | ✓     | ✓        | ✓       | ✗          | ✗             | —         | ✗              | ✗           | ✗         |
| **administration** | ✓           | ✓    | ✓     | ✓       | ✓     | ✓        | ✓       | ✓          | ✓             | ✓         | —              | ✓           | ✗         |
| **maintenance**    | ✓           | ✓    | ✓     | ✓       | ✓     | ✓        | ✓       | ✓          | ✓             | ✓         | ✗              | —           | ✗         |
| **workflows**      | ✓           | ✓    | ✓     | ✓       | ✓     | ✓        | ✓       | ✓          | ✓             | ✓         | ✓              | ✓           | —         |
| **app**            | ✓ (limited) | ✓    | ✓     | ✓       | ✓     | ✓        | ✓       | ✓          | ✓             | ✓         | ✓              | ✓           | ✓         |
| **components**     | ✗           | ✗    | ✗     | ✗       | ✗     | ✗        | ✗       | ✗          | ✗             | ✗         | ✗              | ✗           | ✗         |
| **lib**            | ✗           | ✗    | ✗     | ✗       | ✗     | ✗        | ✗       | ✗          | ✗             | ✗         | ✗              | ✗           | ✗         |

### 7.1 Same-layer exceptions (exhaustive)

Only these same-layer edges are permitted:

| Edge                           | Reason                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `users → content`              | Validate that a bookmarked drama/movie exists and is publicly available               |
| `playback → content`           | Resolve episode/movie metadata, ordering, and the stored source URL for watch queries |
| `reviews → content`            | Validate that the rated/reviewed content item exists and is publicly available        |
| `administration → maintenance` | Admin operational summaries read health, alerts, and task history                     |

No other same-layer imports are allowed. Adding one requires a recorded decision.

`components` may import `lib` and `lib/contracts`; `lib` imports only isomorphic third-party code. The matrix omits those columns because no module may import either of them.

### 7.2 Forbidden examples (explicitly called out)

- `content` → `notifications` (publishing an episode must not import notification code; `workflows/publish-content` coordinates both).
- `playback` → `analytics` (progress and playback events are emitted by a workflow).
- `reviews` → `notifications` (reporter notification is a workflow).
- `auth` → `authorization` (authentication must not depend on roles).
- `platform` → any module (no upward infrastructure dependency).
- `components` → any module (client bundle must not reach server code).
- Any module → `app` or `workflows`.
- Any import of `modules/<name>/<anything other than index.ts>`.

---

## 8. Inter-Module Communication and Orchestration

### 8.1 Direct calls

A module calls another module only through that module's public `index.ts`, only when the dependency matrix permits it, and only for a read or a write that belongs to the callee. The caller passes:

1. a trusted `ActorContext` (first argument),
2. a validated input object,
3. an optional shared `DbExecutor` when participating in a workflow transaction.

### 8.2 Workflows

A **workflow** is a thin application-layer function in `src/workflows/` that coordinates two or more modules. It:

- contains sequencing, authorization entry checks, and transaction boundaries — **not** domain rules;
- calls each participating module's public API independently;
- passes validated payloads and the actor explicitly;
- owns the shared transaction when atomicity is required (§12);
- performs post-commit effects (cache invalidation, push dispatch) after the transaction commits;
- is invoked by a Server Action, route handler, or maintenance script — never by a module.

Workflows are not a general abstraction. A single-module operation stays in that module's service. A workflow exists only when coordination is genuinely required.

### 8.3 Workflow catalog (initial)

| Workflow                     | Modules coordinated                                        | Why it cannot live in one module                                   |
| ---------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `publish-content`            | content, notifications (+ cache invalidation via platform) | Publishing writes content and creates notifications                |
| `replace-video-source`       | content, playback                                          | Updates the URL and resets progress atomically                     |
| `permanently-delete-content` | content, users, playback, reviews, moderation, analytics   | Purge plus cleanup of dependent records and anonymization          |
| `record-content-view`        | analytics, content                                         | Verifies availability, then records a deduplicated view            |
| `save-playback-progress`     | playback, analytics                                        | Persists progress and records bounded analytics in one request     |
| `moderate-review`            | reviews, moderation, notifications                         | Removes a review, records the action, notifies the reporter        |
| `resolve-content-report`     | moderation, notifications                                  | Resolves a report and notifies the reporter                        |
| `deactivate-user`            | auth, users, notifications                                 | Changes account status and emits a mandatory security notification |
| `authorize-admin`            | auth, authorization, administration, notifications         | Grants roles, records the admin account, notifies                  |
| `change-admin-role`          | authorization, administration, notifications               | Changes roles and emits a security notification                    |
| `terminate-admin-session`    | auth, administration, notifications                        | Revokes a session, records it, notifies                            |
| `export-dataset`             | administration, owning module                              | Builds an approved dataset across modules                          |
| `import-dataset`             | administration, owning module                              | Dry-run and apply metadata across modules                          |

### 8.4 Prohibited communication mechanisms

- No event bus, message broker, outbox processor, queue, or background worker.
- No in-process pub/sub used to avoid a direct call.
- No shared mutable module state.
- No cross-module table writes.
- No "temporary" circular import to make a side effect work.

---

## 9. Entrypoint Allocation

### 9.1 Rules

| Entrypoint                                        | Responsibility                                                                                                                     | Must not                                                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Server Component** (`app/**/page.tsx`, layouts) | Resolve actor, call one or more module **query** services, render                                                                  | Mutate data, access repositories or the DB, call write services                        |
| **Server Action** (`app/actions/**`)              | Parse `FormData`, validate with Zod, resolve actor, call one workflow or one module **service**, map errors, revalidate cache tags | Contain domain rules, access the DB, duplicate REST logic                              |
| **REST route handler** (`app/api/**/route.ts`)    | Parse request (params/query/body), resolve actor, call one workflow or one module service, map result/errors to HTTP, set headers  | Contain domain rules, access the DB, implement logic not present in the shared service |

Every entrypoint performs authentication/authorization checks. Every protected service re-checks independently.

### 9.2 REST allowlist

REST exists only for these categories. Anything else is a Server Action or a Server Component read.

1. Client-driven reads and polling (search autocomplete, notification unread count, admin operational metrics refresh).
2. Analytics beacons (content view, playback heartbeat) sent with `sendBeacon`/`fetch(..., { keepalive: true })`.
3. Exports and downloads (CSV datasets, authorized backup download).
4. Better Auth integration (`/api/auth/[...all]`).
5. Health checks (public minimal; authenticated detailed).
6. OpenAPI document.
7. Explicitly approved external integrations (webhooks) — none in the initial release.

Push subscription management is a client-driven mutation and uses a Server Action, not REST.

### 9.3 Examples

| Operation                   | Entrypoint                                 | Service/workflow                                                                        |
| --------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| Public drama/movie details  | Server Component                           | `content.getDramaDetails` / `content.getMovieDetails` + `analytics.getContentViewCount` |
| Record a details-page view  | REST `POST /api/analytics/view`            | `workflows/record-content-view`                                                         |
| Live search suggestions     | REST `GET /api/search/suggestions`         | `content.searchContent`                                                                 |
| Search results page         | Server Component                           | `content.searchContent`                                                                 |
| Bookmark toggle             | Server Action                              | `users.toggleBookmark`                                                                  |
| Playback heartbeat          | REST `POST /api/playback/progress`         | `workflows/save-playback-progress`                                                      |
| Continue Watching page      | Server Component                           | `playback.getContinueWatching`                                                          |
| Submit rating/review        | Server Action                              | `reviews.submitRating` / `reviews.submitReview`                                         |
| Submit content report       | Server Action                              | `moderation.submitContentReport`                                                        |
| Admin content list          | Server Component (search params)           | `content.listAdminContent`                                                              |
| Publish episode/drama/movie | Server Action                              | `workflows/publish-content`                                                             |
| Replace video source        | Server Action                              | `workflows/replace-video-source`                                                        |
| Permanently delete content  | Server Action                              | `workflows/permanently-delete-content`                                                  |
| CSV export                  | REST `GET /api/admin/exports/[dataset]`    | `workflows/export-dataset`                                                              |
| Admin dashboard             | Server Component                           | `administration.getOperationalSummary` + `analytics.getAnalyticsOverview`               |
| Notification unread count   | REST `GET /api/notifications/unread-count` | `notifications.getUnreadCount`                                                          |
| Push subscribe/unsubscribe  | Server Action                              | `notifications.upsertPushSubscription` / `removePushSubscription`                       |
| Health                      | REST `GET /api/health`                     | `maintenance.getHealth`                                                                 |
| OpenAPI                     | REST `GET /api/openapi`                    | Static/generated document                                                               |

### 9.4 HTTP concerns stay at the edge

Request parsing, status-code mapping, headers, cookies, and response envelopes live in `app` and `platform/http`. Domain services return typed results or throw typed errors. No module imports HTTP types.

---

## 10. Data Ownership and Cross-Module Reads

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

### 10.1 Foreign keys across modules

Cross-module foreign keys are permitted at the database level (for example, `bookmarks.content_id` referencing content). They do not grant write permission. Referential actions are chosen conservatively; destructive cleanup is performed explicitly by the owning module inside `workflows/permanently-delete-content`, not by `ON DELETE CASCADE` across ownership boundaries.

A module's `schema.ts` must not import another module's `schema.ts`. Cross-module foreign-key constraints are declared in SQL migrations, not in the Drizzle schema. `src/db/schema.ts` spreads each module's namespace into one registry; intra-module constraints use named Drizzle builders. The boundary rule is fixed here; the Prompt 020 composition is documented in `DATABASE.md` §2.4.

---

## 11. Authentication and Authorization

### 11.1 Actor kinds

| Actor            | Construction                                                                                               | Typical use                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `AnonymousActor` | No session; optional guest session id for analytics                                                        | Public reads, view counting             |
| `UserActor`      | Session → active `auth` user                                                                               | Authenticated features                  |
| `AdminActor`     | `UserActor` + resolved roles + effective permission set                                                    | Admin pages and operations              |
| `SystemActor`    | Created only by a maintenance script; carries an explicit task identity and a narrow system permission set | Backups, retention, health, aggregation |

Actors are server-generated. A request body, header, cookie value, or client state can never assert a user id, role, or permission.

### 11.2 Permission catalog

- The catalog lives in `modules/authorization/permissions.ts` and is the **only** place permission keys are defined.
- Keys use the canonical `resource.action` form: `drama.create`, `drama.read`, `drama.update`, `drama.delete`, `drama.manage`, the equivalent `movie.*`, `episode.*`, `category.*`, and `platform.*` families, plus `user.read`, `user.manage`, `review.*`, `rating.*`, `analytics.*`, `settings.*`, and `admin.manage` keys.
- `PermissionKey` is a union type. Passing an arbitrary string to a guard is a type error.
- Modules import keys from `authorization`; they never define local permission strings.
- Super Admin resolves to the complete catalog centrally. No code special-cases the role name.

### 11.3 Enforcement points

Authorization is checked twice by design:

1. **Entrypoint guard** — the Server Action, route handler, or protected page resolves the actor and performs a coarse check (`requireUser`, `requireAdmin`, `requirePermission`).
2. **Service guard** — the called service re-checks the specific permission and resource-level rules (ownership, target state, last-Super-Admin invariant) using the passed actor.

Query services additionally filter by visibility and ownership. A caller cannot obtain another user's private data by passing a different id.

### 11.4 Resource-level rules

- Users may mutate only their own ratings, reviews, reactions, reports, bookmarks, and progress.
- Moderators act only through `review.moderate` and the moderation permissions. Review removal is permanent and cannot be undone.
- Only Super Admin may permanently delete content, export datasets, or change system configuration.
- The last effective Super Admin cannot be removed.
- Deactivated accounts cannot use authenticated features even if a stale session exists.

### 11.5 Navigation is not authorization

Admin navigation may hide links the actor cannot use, but every page, action, and endpoint enforces access independently. Hidden UI is never treated as a boundary.

---

## 12. Transactions and Consistency

### 12.1 Primitives

- `platform/db/pool.ts` owns the single connection pool.
- `src/db/client.ts` creates the Drizzle instance from the pool and the schema registry.
- `src/db/schema.ts` assembles every module's `schema.ts`. It is the only file allowed to import them.
- `platform/db/transaction.ts` exports `withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T>` and the `DbExecutor` type.
- Repositories accept a `DbExecutor`. Services accept an optional `DbExecutor` and forward it to every repository call. When omitted, the repository uses the pool.

### 12.2 Rules

1. A workflow that requires atomicity opens exactly one `withTransaction` and passes the same `tx` to every participating module operation.
2. Modules never call `withTransaction` inside a workflow-participating operation, and never commit independently.
3. Any thrown error rolls the transaction back. Partial writes are not permitted when the operation is all-or-nothing.
4. Post-commit effects (cache invalidation, push dispatch) run after commit. If a post-commit effect fails, the committed data remains valid and the failure is recorded; there is no automatic retry loop.
5. No distributed transactions, no two-phase commit, no eventual consistency, no outbox, no queue.
6. Reads that do not require atomicity do not open transactions.
7. Long-running work (backups, exports) uses bounded queries and does not hold a transaction open across user interaction.

### 12.3 Operations that require a transaction

Publishing with notifications, source replacement with progress reset, permanent deletion with dependent cleanup, structure conversion, episode moves/reordering, bulk publication, rating/review uniqueness enforcement, admin role changes, and CSV import apply steps.

---

## 13. Errors, Logging, and HTTP Mapping

### 13.1 Error hierarchy

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

### 13.2 Rules

- Services throw typed errors. They never return HTTP objects or status codes.
- `platform/http` maps errors to responses; `app` Server Actions map errors to action results. Mapping logic exists once.
- Authorization failures are typed: `AuthenticationError` maps to `401` (`authentication_required`) and `AuthorizationError` maps to `403` (`forbidden`) through `platform/http` (`mapErrorToRest`); REST entrypoints return the JSON error envelope with the `X-Request-Id` header.
- Internal details (SQL, stack traces, credentials, URLs with tokens) never reach the client.
- Unknown errors are wrapped as `InternalError`, logged with full context, and returned as a generic message.

### 13.3 Logging

- `platform/logging` configures Pino with JSON output, timestamps, severity, request/correlation id, and module context.
- Redaction covers passwords, OAuth tokens, cookies, session secrets, authorization headers, sensitive query parameters, and video source URLs where required.
- `app` establishes the request id; services accept a logging context and never create ad-hoc loggers.
- Logs are suitable for journald. No external log service is introduced.

---

## 14. Server/Client Boundary

- **Server Components are the default.** Client Components are introduced only for the Vidstack player, forms with local state, interactive tables/filters, the notification bell, and push-permission flows.
- `modules/**` and `platform/**` are server-only. Every module `index.ts` and every platform entrypoint imports `server-only`.
- `components/**` may import only `lib`, `lib/contracts`, and third-party client libraries. It may not import a module, repository, DB client, or authorization code.
- Client Components receive serializable DTOs as props. They never receive raw rows, DB handles, session secrets, or permission internals.
- `lib/contracts/**` contains the client-safe DTO and form-schema definitions. It imports no server code.
- Secrets are read only by `platform/config` in server code. No secret uses a `NEXT_PUBLIC_*` variable.

---

## 15. Caching and Invalidation

- Only public, non-personalized data may be cached. Private user data, admin data, and unpublished content are never cached in a shared layer.
- `platform/cache` exposes tag helpers. Tags are derived from content identity and list identity, for example `content:drama:<id>`, `content:movie:<id>`, `content:list:trending`, `content:list:recent`.
- Mutating workflows invalidate the affected tags after commit.
- Analytics aggregates may be cached separately from raw events and must show their last-updated time.
- No Redis. Caching uses Next.js built-in facilities and PostgreSQL-backed data access.

---

## 16. Maintenance Commands and System Actors

- `scripts/maintenance/index.ts` dispatches a named task; each task is a short-lived process invoked by systemd.
- Tasks use `maintenance.runTask(name, fn)` for structured logs, timing, success/failure, and exit codes.
- A task receives a `SystemActor` with only the permissions it needs (`admin.manage` for privileged maintenance operations, plus read permissions for the data it processes).
- Cross-module cleanup (Trash expiry, analytics retention, permanent deletion) is orchestrated by the script through workflows; `maintenance` never writes another module's tables.
- Task history is recorded in `maintenance_task_runs`. Successful routine runs are lightweight; failures retain safe error detail.
- No task runs continuously, sleeps in a loop, or waits on a queue. No persistent worker exists.

---

## 17. Enforcement

Architecture rules are enforced by tooling, not only by documentation.

| Rule                                       | Enforcement                                                                                                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layer/module dependency direction          | `eslint-plugin-boundaries` (or equivalent zone rules) in Prompt 013                                                                                                                                      |
| No circular dependencies                   | `import/no-cycle` across `src`                                                                                                                                                                           |
| Public API only (`modules/x/index.ts`)     | `no-restricted-imports` pattern `@/modules/*/**` excluding `index.ts`                                                                                                                                    |
| Server-only modules                        | `server-only` imports + lint rule forbidding `@/modules/*` and `@/platform/*` in `components` and `"use client"` files                                                                                   |
| DB access only in repositories/read-models | `no-restricted-imports` for `@/db/client` outside `modules/*/repository*`, `modules/*/read-models*`, and `src/db`; `@/db/schema` only in `src/db`; workflows may import only `@/platform/db/transaction` |
| Permission catalog single source           | Typed `PermissionKey` union; lint forbids permission-looking string literals in guard calls                                                                                                              |
| Type safety                                | TypeScript strict mode; no unrestricted `any`; no ignored type errors                                                                                                                                    |
| Data ownership                             | Repository boundaries + code review + read-model allowlist review                                                                                                                                        |
| New module/dependency/exception            | Requires a `DECISIONS.md` entry and an update to this document before implementation                                                                                                                     |

CI runs install, type check, lint (including architecture rules), unit tests, integration tests, and production build. A pull request that violates a boundary fails before review.

### 17.1 Review checklist for a new cross-module dependency

1. Is the target in a strictly lower layer or an approved same-layer edge?
2. Is the call a read through a public query, or a write through the owner's service?
3. Does the interaction belong in a workflow instead?
4. Is the payload validated and the actor passed?
5. Is a transaction required, and is it opened once?
6. Does the change need a decision entry and an update to §6–§8?

---

## 18. Extensibility and Future Extraction

- Each module owns its tables and exposes a narrow API, so a module can be extracted later without rewriting its callers' domain logic.
- The shared PostgreSQL transaction is an accepted monolith trade-off. Extracting a module that participates in cross-module transactions requires a future architecture decision; no distributed transaction mechanism is introduced now.
- Provider-specific integrations (push, backups) sit behind internal interfaces so they can change without touching domain rules.
- No microservice infrastructure, service discovery, message broker, or separate deployment is introduced in the initial release.

---

## 19. Open Items and Deferred Choices

These do not block Prompt 003 and are recorded so later prompts do not guess:

| Item                                                  | Status                                                          | Owner prompt             |
| ----------------------------------------------------- | --------------------------------------------------------------- | ------------------------ |
| Package manager (npm available; pnpm not installed)   | Resolved: npm, lockfile committed (D-018)                       | Prompt 006               |
| PostgreSQL development credentials                    | Resolved: supplied in ignored `.env.local`; connection verified | Prompt 019               |
| Git repository initialization                         | Resolved: initialized on `main` with GitHub `origin`            | Prompt 006               |
| Exact ESLint boundary configuration and plugin choice | Deferred, rules fixed here                                      | Prompt 013               |
| Path alias (`@/*` → `src/*`) and `src/` root          | Implemented in Prompt 006                                       | Prompt 006               |
| Browser push provider (FCM vs native Web Push)        | Deferred behind provider interface                              | Notification phase       |
| Image delivery (Nginx static vs route handler)        | Deferred; metadata owned by `content`                           | Image management prompt  |
| OpenAPI generation approach                           | Deferred                                                        | API documentation prompt |

---

## 20. Traceability

| Module           | Primary requirement sections     |
| ---------------- | -------------------------------- |
| `auth`           | §7.1, §12.2                      |
| `authorization`  | §3.2, §12.1, §12.3               |
| `content`        | §4, §6, §8.3, §8.6–8.7           |
| `users`          | §7.1–7.2, §8.5                   |
| `playback`       | §5, §7.3–7.4                     |
| `reviews`        | §7.5, §9                         |
| `moderation`     | §7.6, §9                         |
| `notifications`  | §11                              |
| `analytics`      | §10                              |
| `administration` | §8.1–8.2, §8.5, §8.8–8.10, §12.3 |
| `maintenance`    | §13, §14                         |
| `workflows`      | §4.6, §5.7, §8.3, §11.4, §13.3   |
| Platform         | §12, §15                         |
| Entrypoints      | §15.9, §12.7                     |

---

## 21. Acceptance

This architecture is accepted when:

1. Every module has a stated purpose, owned data, public API, allowed dependencies, and explicit non-responsibilities.
2. The dependency matrix is acyclic and every same-layer edge is listed.
3. Cross-module side effects are owned by workflows, not by module-to-module imports.
4. Server Component, Server Action, and REST responsibilities are separated, and REST has an explicit allowlist.
5. Data ownership, transaction coordination, error handling, logging, and server/client boundaries are documented.
6. The rules are enforceable by lint, types, and review.
7. No hard-excluded infrastructure is introduced.
