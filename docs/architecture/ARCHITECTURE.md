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
| 0     | `src/platform/`                                        | DB client/pool, transaction primitive, env config, error base types, Pino logging, PG-backed rate limiter, cache helpers, HTTP helpers, media storage | Nothing from `modules`, `workflows`, `app`, `components`                                                                      |
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
      admin/api/users/[id]/status/route.ts
      admin/api/users/[id]/roles/route.ts
      admin/api/users/[id]/sessions/route.ts
      admin/exports/[dataset]/route.ts
      admin/backups/[id]/route.ts
      health/route.ts
      openapi/route.ts
    actions/                      # reserved for thin app-level Server Actions
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
    admin/                        # administration workflows; the Server Actions live here (D-086)
    analytics/                    # analytics workflows; the Server Actions live here (D-086)
    notifications/                # notification workflows; the Server Actions live here (D-086)
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
      movie-conversion.ts         # drama → movie plan, fingerprint, publication mapping
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
      *.shared.ts                 # client-safe DTOs: preferences, notification centre, subscriptions, admin alerts, announcements (D-085)
    analytics/
      index.ts
      schema.ts                   # guest_sessions, view events, playback events, aggregates
      service.ts
      queries.ts
      validation.ts
      repository.ts
      read-models/                # approved cross-module read-only queries
      typed-targets.ts            # the typed target expressions of D-082
      playback-events.shared.ts   # the playback event catalogue of D-085
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
8. **Explicit permission keys.** Guards use keys from the central catalog (`drama.create`, `episode.read`, `drama.update`, `review.manage`, `user.manage`). No role-name comparisons and no generic `isAdmin` checks. The catalog is the only source of the key names: a permission that is not in `src/modules/authorization/permissions.ts` does not exist, and adding one is a recorded decision (D-047).
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
| `*.shared.ts`                   | Pure, testable helpers a client island may import directly (D-049)                     | No (no database import at all)      |

Large modules may split `service.ts` and `repository.ts` into folders, provided `index.ts` remains the only public surface.

A `*.shared.ts` file is the one exception to "the module index is the only
public surface": it exists so a client island can use a pure catalog or parser
without reaching a `server-only` barrel. It carries no `server-only` marker,
no database import, and no side effect. A client component imports the
`*.shared.ts` file directly and never the module index.

### 5.2 Service categories

| Category                       | Location                  | Called by                                           | Contains                                                               | Must not                                                     |
| ------------------------------ | ------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| Module query service           | `modules/*/queries.ts`    | Server Components, workflows, permitted modules     | Visibility/authorization filtering, DTO shaping, read-only composition | Writes, HTTP, cache invalidation                             |
| Module mutation service        | `modules/*/service.ts`    | Server Actions, route handlers, workflows           | Domain rules, input validation, transaction participation              | HTTP, cross-module side effects, independent commits         |
| Workflow (application service) | `src/workflows/`          | Server Actions, route handlers, maintenance scripts | Sequencing, transaction boundary, post-commit effects                  | Domain rules, SQL, HTTP parsing                              |
| Platform service               | `src/platform/`           | Modules, workflows, `app`                           | DB pool, config, errors, logging, rate limiting, cache, HTTP mapping, media storage | Domain rules, module imports                                 |
| Repository                     | `modules/*/repository.ts` | The owning module's services, queries, read models  | Drizzle reads/writes for the module's own tables                       | Cross-module writes, business rules, authorization decisions |

There is no general-purpose "shared domain service" bucket. Cross-module reuse happens through a module's public API or a workflow. Shared code is limited to `platform` (server infrastructure) and `lib` (isomorphic helpers and contracts). This prevents a second, unowned domain layer from forming.

---

## 6. Module Catalog

The eleven modules below are the complete initial module set. Adding a twelfth requires a recorded decision (§18).

### 6.1 `auth` — Authentication and identity

- **Purpose:** Better Auth integration, Google OAuth, session resolution, first-sign-in user creation, approved Google profile synchronization, account status, session revocation.
- **Owns:** Better Auth tables (`user`, `account`, `session`, `verification`), canonical user identity, `account_status` (`active` / `deactivated`), Google name and image reference, session metadata.
- **Public API:** `getSession`, `requireUser`, `resolveActorIdentity`, `syncGoogleProfile`, `setAccountStatus`, `revokeSession`, `revokeAllSessions`, `isDeactivated`, `listUserAccounts`.
- **Depends on:** platform.
- **Not responsible for:** roles, permissions, admin authorization, profile page composition, bookmarks, notification preferences.
- **Boundary notes:** deactivated accounts are rejected during session resolution, before any feature service runs. `auth` never queries role tables. `listUserAccounts` is the paged identity read over this module's own `users` table and is the documented exception to §5.4: `auth` may not import `authorization` (§7.2, D-008), so it cannot name `ActorContext`. The protected entry point is `users.listUsersForAdmin`, which takes the actor and enforces `user.read` before the query runs (D-026).

### 6.2 `authorization` — RBAC and guards

- **Purpose:** centralized permission catalog, roles, role-permission mappings, admin role assignment, effective permission resolution, access-control guards, last-Super-Admin invariant.
- **Owns:** `roles`, `permissions` (action/resource → granted, composing the canonical `resource.action` key), `user_roles` (administrator role assignments), and the code-level permission catalog.
- **Public API:** `PERMISSIONS`, `ALL_PERMISSION_KEYS`, `SUPER_ADMIN_PERMISSION_KEYS`, `PermissionKey`, `PermissionDefinition`, `isPermissionKey`, `toPermissionKey`, `PERMISSION_RESOURCES`, `PERMISSION_ACTIONS`, `ActorContext`, `anonymousActor`, `userActor`, `resolveActor`, `resolveEffectivePermissionsForUser`, `resolveEffectivePermissions`, `hasPermission`, `requirePermission`, `requireAnyPermission`, `requireUser`, `requireAdmin`, `assertResourceAccess`.
- **Depends on:** `auth`, platform.
- **Not responsible for:** sign-in, sessions, admin account lifecycle records, content rules, UI navigation filtering (navigation may read permissions but is not the boundary).
- **Boundary notes:** effective permissions are the union of all granted permissions across all assigned roles; Super Admin resolves to the full catalog centrally. The last-Super-Admin check is enforced inside this module, not in the UI.

### 6.3 `content` — Content management

- **Purpose:** dramas, seasons, episodes, standalone movies, hierarchy, taxonomies, similar dramas, publication state, Trash/restore, structure conversion, drama→movie conversion, episode ordering/moving, information pages, SEO overrides, slug history/redirects, sitemap eligibility, image asset metadata, direct MP4 source URL storage and syntax validation.
- **Owns:** `dramas`, `seasons`, `episodes`, `movies`, `categories`, `platforms`, `drama_categories`, `drama_platforms`, `movie_categories`, `movie_platforms`, `similar_dramas`, `information_pages`, `content_slug_history`, `content_seo`, `content_assets`, `sitemap_exclusions`, `structure_conversion_snapshots`, `movies.converted_from_drama_id`; the `video_source_url` columns on episodes and movies.
- **Public API:** public detail/card/list queries with visibility enforcement, admin list queries, create/update/delete/restore/purge services, publish/unpublish, bulk publication, reorder/move, conversion, similar-drama management, slug resolution and redirect lookup, availability assertions, playback-source lookup with availability enforcement, taxonomy CRUD.
- **Depends on:** `authorization`, `auth`, platform.
- **Not responsible for:** playback progress, watch history, ratings/reviews, view counts, notifications, moderation records, image file I/O (files live on disk; this module stores metadata and paths).
- **Boundary notes:** publication workflows are invoked through `workflows/publish-content`, not by other modules. Public queries never return unpublished or trashed content. Watch queries obtain the source URL through `playback`, not from a general details query. Drama structure conversion (season-based ↔ flat) is sequenced by `workflows/admin/conversion`, which owns the transaction, the `FOR UPDATE` lock, the preview fingerprint check, and the snapshot lifecycle; the `content` module supplies the pure ordering, plan, fingerprint, and snapshot-payload rules. Drama→movie conversion is sequenced by `workflows/admin/movie-conversion`; `content` supplies the plan, publication mapping, and fingerprint, while the `reviews`, `users`, `notifications`, and `analytics` modules move their own rows through transaction-scoped ownership services.
- **Public discovery reads (Prompts 121–138):** `content/public-discovery.ts` owns the content-only public reads — the browse listings, the category and platform pages, the search suggestions, the hero candidates, and the public availability predicates `publicDramaAvailability` / `publicMovieAvailability`, which mirror `evaluatePublicAvailability` in SQL. `content/public-discovery.shared.ts` holds the pure parsers and DTO mappers that a client island may import directly (D-049). The *unified* ranked grid — which joins the rating rows and the daily aggregates — is owned by `analytics/read-models/discovery.ts` (§6.9); `content` does not import `reviews` or `analytics` to build it.
- **Availability is the single authority:** a published item with no playable source is not publicly listed. The rule applies to the listings, the detail pages, the watch routes, the search results, and the bookmarks, so a viewer never reaches a page that leads nowhere.
- **Publication references are a public API (S6, D-076):** `content/publication-references.ts` exposes `listPublishedDramaReferences`, `listPublishedSeasonReferences`, and `listPublishedEpisodeReferences`, which return the title and deep-link data of the named rows and never name a trashed row. The publication workflow calls them and hands the result to `notifications` as a payload snapshot, so a workflow never queries the content tables itself.

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
- **Boundary notes:** progress updates are debounced by the client and bounded server-side. Older updates never overwrite newer ones: the write locks the two target rows with `FOR UPDATE` and both upserts carry `last_watched_at <= excluded.last_watched_at`, so the rule holds even when two reports overlap. Every path that touches the progress row and the watched-state row locks and writes them in the same order — progress row first, watched-state row second — so two overlapping writes cannot deadlock. `playback` does not call `analytics`; progress/playback events are emitted by `workflows/save-playback-progress`.
- **Service shape (Prompts 080–090 review fixes):** every administrative service takes the trusted actor as its **first** argument and re-checks `episode.manage` itself — the client is never the authority. The module is layered `repository.ts` (row-level writes) → `queries.ts` (row-level reads) → `service.ts` (actor-first services) → `index.ts` (the only public surface). A workflow that needs an atomic multi-write operation passes its transaction handle to the service as an executor; the workflow owns the transaction boundary, the module owns the rows.
- **Current implementation note (Prompts 080–090):** the `playback` module currently owns `subtitle_tracks` and `playback_failure_reports`. `playback_progress`, `watched_state`, and `watch_history` are still defined in `src/modules/users/schema.ts`, so the progress write service (`users.savePlaybackProgress`) and the source-replacement reset (`users.resetEpisodeWatchState`) live in the `users` module. The episode → drama mapping is resolved through `content.getEpisodeContentReference`. Moving the three tables into `playback` is a recorded ownership refactor — see D-040 — and is not part of the initial release. The module `playback` may not import `users`, so the direction of the dependency must not be inverted in the meantime.
- **Two reference levels (Prompts 091–103, D-043):** `content` exposes the episode → drama mapping at two levels. `getEpisodeContentReference` answers "does the episode exist and is it still in the catalogue?" and serves the administrative path (subtitle management on a draft episode). `getPublicEpisodeContentReference` answers "may the public watch this episode right now?" — the published hierarchy and a stored source — and serves the viewer's progress and watched-state writes. A guessed id of an unpublished, trashed, source-less, or unpublished-parent episode is refused by the public level only.
- **Slug redirects (Prompts 091–103, D-046):** `content.resolvePublicContentSlug(type, contentId, requestedSlug)` reads `content_slug_history` and returns the current slug when the requested one is a slug the item really used. The four public routes redirect an old URL to the current canonical URL; a guessed slug is still a 404, and the lookup applies the same availability rule as the page it redirects to, so it never reveals the current slug of a draft, trashed, or source-less item.

### 6.6 `reviews` — Ratings, reviews, reactions, review reports

- **Purpose:** content-level ratings and reviews for dramas and movies, Enjoying reactions, review sorting and aggregates, review reporting, review removal.
- **Owns:** `ratings`, `reviews`, `review_reactions`, `review_reports`.
- **Public API:** `submitRating`, `getRatingSummary`, `submitReview`, `editReview`, `listReviews`, `addReaction`, `removeReaction`, `reportReview`, `listReportedReviews`, `removeReview` (requires `review.manage`).
- **Depends on:** `content`, `authorization`, `auth`, platform.
- **Not responsible for:** episode ratings/reviews (excluded), content reports, moderation audit, reporter notifications.
- **Boundary notes:** one active rating and one active review per user per content item. Public averages use each user's latest active rating. Removal is permanent and only through an authorized service.
- **Partial-index upserts (D-048):** every upsert against a partial unique index repeats the *whole* index predicate in `targetWhere`. PostgreSQL infers a partial index only when the statement's predicate implies the index predicate, so a shorter predicate made the second rating for the same viewer fail instead of updating the existing row.
- **Report history (Prompts 115–120):** `review_reports.review_id` is nullable with `ON DELETE SET NULL`, and the immutable `review_id_snapshot` keeps the id of the removed review. A permanently removed review therefore never deletes the moderation history that refers to it, and the CHECK `ck_review_reports_review_reference` keeps a report from losing its subject altogether. The review reasons are a pure catalog in `reviews/report-reasons.ts`, which a client island imports directly (D-049).
- **The one allowed same-layer import:** `reviews` may read `content` for the public availability check. The direction is never inverted — `content` does not import `reviews` (D-044).

### 6.7 `moderation` — Content reports and moderation records

- **Purpose:** user-facing content reports, moderation queues, moderation outcomes, moderation audit records.
- **Owns:** `content_reports`, `moderation_actions`.
- **Public API:** `submitContentReport`, `listContentReports`, `resolveContentReport`, `getModerationQueue`, `recordModerationAction`.
- **Depends on:** `content`, `users`, `reviews`, `authorization`, `auth`, platform.
- **Not responsible for:** review storage or review removal (delegated to `reviews`), user deactivation (delegated to `users`), reporter notifications (workflow).
- **Boundary notes:** reported reviews remain visible while pending. `getModerationQueue` is an approved read model combining content reports and review reports; it is read-only.
- **Audit rows (Prompts 115–120):** `moderation_actions.target_id` is an immutable snapshot of the target — a report id or a review id — and not a live foreign key, because the target may be permanently removed afterwards. `actor_user_id` is nullable with `ON DELETE SET NULL`: an audit row outlives the administrator who wrote it. `recordModerationAction` re-checks `review.manage` on the server, so the audit trail cannot be written by an actor who may only read the queue.

### 6.8 `notifications` — User and admin notifications

- **Purpose:** notification preferences, in-app notifications, browser push subscriptions and delivery, announcements, admin notification center, unread counts, delivery records.
- **Owns:** `notification_preferences`, `notifications`, `push_subscriptions`, `notification_deliveries`, `announcements`, `admin_notifications`, `admin_notification_reads`.
- **Public API:** `createContentPublishedNotifications`, `createSeasonNotifications`, `createAnnouncementNotifications`, `notifyAccountSecurity`, `notifyReporter`, `listNotifications`, `markRead`, `markUnread`, `getUnreadNotificationCount`, `upsertPushSubscription`, `removePushSubscription`, `publishAnnouncement`, `listAdminNotifications`.
- **Depends on:** `users` (the bookmark audience), `auth` (the active-account audience), platform.
- **Not responsible for:** deciding when content is published, content metadata ownership, admin authorization, analytics.
- **Boundary notes:** callers pass validated payload snapshots (content id, type, title, deep link). `notifications` does not import `content`. Push providers sit behind an internal provider interface so the provider can change without touching notification rules.
- **The audiences are read through the other modules' public APIs (D-070):** the bookmark audience comes from `users.listBookmarkOwnerIds` and the broadcast audience from `auth.listActiveAccountIds`. The notification module imports no other module's `schema.ts`, and the content resolution of a publication lives in the publication workflow, which hands the title and the deep link over as a payload snapshot. The administrator alert viewer is a server-side adapter of the workflow layer (`workflows/admin/admin-notification-viewer.ts`), not a `lib` helper: `lib` holds isomorphic code only.
- **Two independent decisions (Prompts 139–154, D-061):** the event preference decides whether the row is written at all; `global_in_app` gates the notification centre and `global_push` gates browser push. The two channels are separate because a viewer may mute the centre and still want push. Account/security notifications and moderation outcomes are mandatory: no switch withholds them, and they are always visible in the centre. `delivery-rules.ts` is the pure source of truth for that rule, so the writer, the centre read, and the tests cannot disagree.
- **Publication and security events are workflow-owned (D-062, D-064):** `workflows/admin/publication.ts` announces a newly published drama, season, or episode after the publication transaction has committed, and `workflows/admin/users.ts` announces an account deactivation, reactivation, role change, or session termination. The `authorization` module does not import `notifications`, so the workflow is the only place that may coordinate the two. A failed notification write is logged and swallowed: the content or the account really was changed, and reporting the administrator's action as failed would be a lie.
- **Push sits behind a provider interface that reports honest failures (D-063, D-066):** a native Web Push provider and an FCM adapter implement one interface. `resolvePushProvider` selects native Web Push, because the stored subscription is the browser's own `endpoint` + `p256dh` + `auth` triple and the FCM web SDK yields a registration token instead. The VAPID keys come from the environment; a deployment without them reports an explicit failure and never claims a delivery it did not perform. A `404`/`410` from the push service retires the subscription. The attempt count is capped at ten, and the browser permission is requested inside the click handler of the opt-in island, never on the first page load.
- **The administrator alert centre is audience-filtered on the server (D-067):** alerts require `admin.manage`, announcements require `settings.manage`, and the page opens with either. Every alert read — the list, the unread count, the detail, the read-state write — applies the alert's audience (`all`, `super_admin`, or named roles), and an alert outside the audience answers 404. Read state is per administrator (`admin_notification_reads`), and the audience rule is a pure function in `admin-notification-rules.ts` that the SQL form must agree with. The producers are workflows: a content report writes a `content` alert to the moderators, and a failed publication announcement writes a `high` `system` alert to the Super Admin.
- **A notification is written once, and delivery maintenance is bounded (D-069):** the database decides whether a notification is new — a partial unique index on `(user_id, event_type, content_id)` plus `ON CONFLICT DO NOTHING` — so two concurrent publication retries cannot both write it, and the writer reports `created`, `duplicate`, and `not_wanted` separately. A notification without a content id is never collapsed. A short-lived maintenance command retries a notification from the last seven days that has no successful push and fewer than three recorded attempts, and it never re-sends a notification that reached a browser once. Every cleanup removes at most one bounded batch, and the bound is inside the delete statement, so the reported number is the number actually removed.
- **The server decides what a push endpoint may claim (D-070):** the endpoint of a subscription is an address the *server* contacts, so it is validated before it is stored and again before it is contacted. The rules live in one shared module (`modules/notifications/push-transport.ts`): HTTPS only, no credentials and no fragment, no local or private host name, no private or reserved IP literal (IPv4 and IPv6, including the IPv4-mapped, NAT64, and 6to4 forms), an optional `PUSH_ALLOWED_HOSTS` allowlist, and a DNS check at send time whose answer is pinned for the connection itself. The outbound request has a timeout. The push configuration — the VAPID key pair, the contact address, the message lifetime, the host allowlist — is part of `ServerConfig`, so a half-configured deployment fails at startup rather than at the first delivery. The maintenance command imports the same transport, so "may this endpoint be contacted?" has exactly one answer.
- **The delivery maintenance command exists as a command (D-070):** `scripts/notification-maintenance.mjs`, run by `npm run db:notifications:maintenance`, mirrors the application-side delivery rule, reports a structured result, and exits non-zero on failure.
- **One delivery primitive serves every audience (S2, D-070):** `notifications/audience.ts` is the only implementation of "write the notification, then deliver the push" for the episode, drama, season, and announcement rounds. It reads the whole audience in three queries, one after another, because a helper that receives a transaction handle must not run concurrent queries on one connection. `MAX_AUDIENCE_SIZE` lives there and nowhere else, so a new broadcast cannot grow an unbounded audience.
- **The delivery limits live in one pure file (S3, D-078):** `notifications/delivery-limits.ts` holds `MAX_DELIVERY_ATTEMPTS`, `MAX_PUSH_RETRY_ATTEMPTS`, `PUSH_RETRY_WINDOW_DAYS`, `DELIVERY_RETENTION_DAYS`, and `DELIVERY_LEASE_SECONDS`; the application imports and re-exports them, and the maintenance command imports them directly. The command's direct SQL is the documented exception in §16.2.
- **A delivery candidate is claimed before it is sent (D-092):** the maintenance command may run twice at the same time — the systemd timer fires while an operator starts it by hand. The candidates are therefore selected with `FOR UPDATE SKIP LOCKED` inside a short transaction, and the selected rows carry a lease: an expiry and a token naming the owner. The lease is released only by its owner, a crashed run loses nothing because the lease expires, and the successful-delivery check and the attempt cap are read again immediately before the push. The lease is an exclusive claim; it does not replace the delivery rules.
- **The client-safe DTOs live in shared files (D-085):** the administrator alert DTOs are in `admin-notifications.shared.ts` and the announcement DTO in `announcements.shared.ts`, beside the preference, notification-centre, and subscription contracts. A client island imports one of those files, never the module index: the index is `server-only` and pulls in the database client. The notification preference form and its Server Action share the schema of `lib/contracts/notification-preferences.ts`.

### 6.9 `analytics` — Product analytics and reporting

- **Purpose:** privacy-conscious guest sessions, content view counting with the six-hour rule, playback analytics ingestion, aggregation, admin analytics dashboards, and the designated cross-module reporting read models.
- **Owns:** `guest_sessions`, `content_view_events`, `playback_analytics_events`, `playback_viewing_sessions`, `analytics_daily_aggregates`, `search_events` (if required by later prompts).
- **Public API:** `recordContentView`, `recordPlaybackEvent`, `getContentViewCount`, `getAnalyticsOverview`, `getContentPerformance`, `getViewerActivity`, `getEngagementTrends`, `purgeExpiredGuestData`.
- **Depends on:** `content`, `users`, `playback`, `reviews` (reporting reads only), `authorization`, `auth`, platform.
- **Not responsible for:** personal watch history or progress (owned by `playback`), operational system metrics and errors (owned by `maintenance`), notifications.
- **Boundary notes:** this is the reporting module. Cross-module joins are allowed only in `analytics/read-models/` and only for read-only reporting. It is **not** a mandatory intermediary for the watch page or admin operational summaries. The unified public discovery grid — Trending, Popular, Highest Rated, Most viewed, and the search results — lives in `analytics/read-models/discovery.ts`: it is the only place where the `content`, `reviews`, and `analytics` domains are read together. The administrator's Trending pins are *not* read there; the app layer reads them from `administration` and hands them to the read model as `pinnedIds`, so `analytics` never imports `administration`. The four raw-SQL rules that the grid obeys are recorded in D-050.
- **The visitor is a guest-session row (Prompts 139–154, D-057, D-083, D-094):** the event tables carry `guest_sessions.id` and nothing else that identifies a person. The row is found by `user_id` for a signed-in viewer and by the anonymous `session_id` cookie for a guest, and the same row gains the `user_id` when the account signs in, so the views recorded before sign-in keep the same visitor key. When the account already has a canonical row, the active anonymous browser row is reconciled into it in one transaction — its view events, playback events, search events and viewing-session baselines move, a colliding row is soft-deleted in favour of the canonical one, and the anonymous row is retired — so the events recorded before the sign-in are not counted for nobody. The reconciliation is fire-and-forget: a failure is logged as a warning and the canonical visitor is returned. The cookie is written by the analytics route handlers — the view beacon and the playback beacon — because Next.js forbids `cookies().set()` in a Server Component. The module resolves the identifier and never writes the cookie.
- **The six-hour window is checked atomically (D-058, D-089):** before a view is written, the workflow looks for a view by the same visitor for the same content inside the previous six hours. The check and the insert run in **one transaction**, behind a transaction-scoped advisory lock keyed by visitor and title, so two requests that arrive at the same time queue instead of interleaving. The per-hour-bucket unique index is the database-level guard against a concurrent double submit. The public view count reads `content_view_events` directly; the dashboard reads the stored daily aggregates.
- **Writes are bounded (D-060):** a playback event is one row per (visitor, content, event type, hour bucket). `watch_duration_seconds` is the part of the cumulative claim the server has not accounted for yet (D-090). The browser only clears its accumulator when the server confirms the row was written, so an event the bounded write dropped does not lose the watch time it carried. The reports are serialized through a promise chain, so two reports for one viewer cannot race into the same bucket.
- **A calendar day is a Dhaka day, and the aggregates are written on demand (D-059):** the aggregate row's `date` is `to_char(timestamp at time zone 'UTC' + interval '6 hours','YYYY-MM-DD')`. The aggregation is a bounded, on-demand command — one pass per scope inside a transaction — so re-running it for the same day produces the same result. There is no worker, no queue, and no recurring job; the dashboard shows when the numbers were last written.
- **The dashboard's ratios have matching denominators, and today is refreshed while the tab is open (D-068):** the player reports a `play` event once per viewing session, the daily aggregate stores `playback_starts` and `playback_viewers`, the completion rate is `completions / playback_starts`, and the average watch time is `watch seconds / playback_viewers`. A pause or a seek no longer lowers the rate, and a visitor who never played no longer dilutes the average. `OperationalRefresh` re-aggregates the current Dhaka day every 60 seconds while the dashboard tab is visible, through a bounded server action authorised by `analytics.read`; a hidden tab does not write, and rewriting a historical range still requires `analytics.manage`.
- **The retention policy is 400 days, and it is applied by a bounded command (D-065):** the raw events are kept for 400 days, which is longer than the 366-day range the dashboard may query, so every number the dashboard can show can still be rebuilt. A guest-session row is kept for the same window as the events it identifies, because the unique-visitor counts are made of the visitor keys; a session row linked to an account is never removed, because it is that account's stable visitor key. `analytics.purgeExpiredGuestData` is the application-side implementation, and `scripts/analytics-retention.mjs` (`npm run db:analytics:retention`) is the short-lived maintenance command that mirrors it. One run removes at most one batch of rows per table, so the command is bounded and has to be run again to clear a large backlog.
- **The server bounds what a public beacon may claim (D-070, D-073, D-090):** a playback beacon is public, so the server decides what it may claim. The browser reports the **cumulative** watch time of its viewing session and the key of that session; the server keeps the cumulative watch time it has already accounted for in a `playback_viewing_sessions` row. The watch duration of an event is the part of the claim the server has not accounted for yet, clamped by the time that really passed since the last stored event of the session, plus thirty seconds of tolerance, and by an absolute maximum. The first beacon of a session is measured against the moment the server stamped, so it cannot claim a watch time it did not earn; a repeated claim is a delta of zero, so a lost acknowledgement cannot double-count a delta; two tabs are two sessions, so one tab cannot reset the baseline of the other. An impossible media position is dropped. The completion flag is honoured on a `completion` event only and forced to `false` on every other event. A `completion` additionally counts only when the visitor already has a stored `play` event for the same content and the cumulative server-verified watch time reaches sixty seconds; an unsupported completion is stored with `completion_threshold_met = false`, so it is visible for investigation but not counted. The numbers are therefore lower bounds, which is what an untrusted signal can honestly support.
- **An event carries the viewer classification of its own moment (D-074):** `content_view_events` and `playback_analytics_events` carry `viewer_type` (`authenticated` / `guest`), written at request time from the resolved visitor. The dashboard counts a visitor as signed in when at least one of their events in the range (or the day) is authenticated, and the two buckets add up to the viewer count. Joining the events to `guest_sessions.user_id` instead would have reclassified the events a viewer produced before signing in, because that column is set when the account is linked.
- **The daily aggregate has a database-level key (D-070):** a refresh takes a transaction-scoped advisory lock and inserts with `ON CONFLICT DO NOTHING`, and two partial unique indexes (`uq_analytics_daily_aggregates_site_date` and `uq_analytics_daily_aggregates_content_date`) state the two logical keys of the table. Two overlapping refreshes therefore produce one row, whatever the interleaving.
- **The range-level playback viewers are counted over the raw events (D-070):** the daily aggregate keeps a viewer count per day, but the range counts the distinct visitors of the raw playback events, so a viewer who played on three days is one viewer of the range and not three. The average watch time of a range is divided by that number.
- **The typed target wins, and the cookie is issued at the edge (D-082, D-083):** an event row carries both a legacy `content_type`/`content_id` pair and a typed `drama_id`/`movie_id` pair, and the typed pair is authoritative — the grouping and the filter of a query use the same expressions, from `analytics/typed-targets.ts`, so a row whose pairs disagree is counted under the target it is filtered by. The module resolves the anonymous session identifier but never writes the cookie: the analytics route handler is the only issuer, and the workflow that receives the identifier is not a Server Action, because a Server Action argument arrives from the request body.
- **The event catalogue has one owner (D-085):** the playback event list lives in `analytics/playback-events.shared.ts`, and the player and the server read it from there. A catalogue with two copies drifts: the player would report an event the server does not know.

### 6.10 `administration` — Admin operations and system configuration

- **Purpose:** administrator account lifecycle records, admin session policy and termination records, login-attempt monitoring, system configuration and version history, maintenance-mode configuration, admin dashboard layouts, admin audit, operational dashboard summaries.
- **Owns:** `admin_accounts`, `admin_login_attempts`, `admin_session_events`, `system_settings`, `system_setting_versions`, `admin_dashboard_layouts`, `admin_audit_log`.
- **Public API:** `authorizeAdminRecord`, `deactivateAdminRecord`, `listAdminSessions`, `recordSessionTermination`, `recordLoginAttempt`, `getSetting`, `listSettings`, `updateSetting`, `getSettingHistory`, `restoreSettingVersion`, `getOperationalSummary`, `getDashboardLayout`, `saveDashboardLayout`.
- **Depends on:** all modules (read-only for summaries), `authorization`, `auth`, platform.
- **Not responsible for:** role definitions (owned by `authorization`), session storage (owned by `auth`), admin notifications (owned by `notifications`), backups and health (owned by `maintenance`).
- **Boundary notes:** multi-module state changes (authorizing an admin, changing roles, terminating sessions) run through workflows. `getOperationalSummary` is an approved read-only cross-module query in `administration/read-models/`.
- **System settings (Prompts 121–138):** `administration/settings.ts` owns `system_settings` and the typed helpers `getFeaturedContentSetting`, `getHeroRotationSetting`, `getTrendingPinsSetting`, and `parseSettingContentRefs`. The setting keys are `featured_content_id`, `featured_content_type`, `hero_rotation_enabled`, `hero_rotation_item_ids` (JSON), and `trending_pinned_item_ids` (JSON). The pure parsers live in `administration/settings.shared.ts` so a client island may import them directly (D-049). `administration` does not import `analytics`: the Trending pins are read here and handed to the read model by the app layer.
- **Audit events without an entity (D-056):** `admin_audit_log.entity_id` is nullable. An action on a content item names that item; an action on a global homepage setting names the setting instead (`entity_type = 'homepage_setting'`, no entity id), because a setting is not a content row and has no identifier to point at.

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
| **notifications**  | ✓           | ✓    | ✗     | ✗       | ✓     | ✗        | ✗       | ✗          | —             | ✗         | ✗              | ✗           | ✗         |
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

**Recorded exception — admin content workflows write content tables directly
(D-029).** The admin content workflows
(`src/workflows/admin/{dramas,seasons,episodes,movies,conversion,movie-conversion,publication,trash,restore,permanent-delete,similar-dramas}.ts`) write
the `content` module's tables inside their own transaction instead of calling a
content-module service for every statement. A structure conversion renumbers
episodes, trashes seasons, and writes a snapshot atomically; a drama→movie
conversion creates the movie, moves relationships, and soft-deletes the drama,
its seasons, and its episodes atomically; a Trash cascade, its inverse
restoration, a bulk publication, and a permanent deletion each change several
content tables atomically as well. Splitting that across module APIs
would break the single transaction. The domain rules stay in
`modules/content` (`src/modules/content/conversion.ts` and
`movie-conversion.ts`), the other modules expose transaction-scoped ownership
services for their own rows, and the workflow owns only the sequencing, the
authorization check, and the transaction boundary. Any new workflow outside the
admin content area must keep calling each module's public API.

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

**Recorded exception (D-029).** The admin content workflows
(`src/workflows/admin/{dramas,seasons,episodes,movies,conversion,movie-conversion,publication,trash,restore,permanent-delete,similar-dramas}.ts`) write
the `content` module's tables directly inside their own transaction, because
one mutation must change several content tables atomically (see §7.2). The
drama→movie workflow calls the `reviews`, `users`, `notifications`, and
`analytics` ownership services with that same transaction instead of writing
their tables.

### 8.3 Workflow catalog (initial)

| Workflow                     | Modules coordinated                                        | Why it cannot live in one module                                   |
| ---------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `publish-content`            | content, notifications (+ cache invalidation via platform) | Publishing writes content and creates notifications                |
| `convert-drama-to-movie`     | content, reviews, users, notifications, analytics          | Creates a movie, reassigns every relationship, and trashes the drama atomically |
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
| `admin/users`                | authorization, auth, notifications                         | Assigns roles, changes the account status, and terminates the sessions of an account; every change emits its own mandatory security notification |
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
| **Server Action** (`workflows/**`, `'use server'`) | Parse `FormData`, validate with Zod, resolve actor, call one workflow or one module **service**, map errors, revalidate cache tags | Contain domain rules, access the DB, duplicate REST logic                              |
| **REST route handler** (`app/api/**/route.ts`)    | Parse request (params/query/body), resolve actor, call one workflow or one module service, map result/errors to HTTP, set headers  | Contain domain rules, access the DB, implement logic not present in the shared service |

Every entrypoint performs authentication/authorization checks. Every protected service re-checks independently.

A Server Action lives in `src/workflows/**`, beside the workflow it belongs to, and is marked with the `'use server'` directive. `src/app` holds routing and entrypoint adaptation only; `src/app/actions/**` is reserved for app-level actions that have no workflow of their own (D-086). A workflow that receives a value the browser could forge — the anonymous session identifier, for instance — is not a Server Action: a Server Action argument arrives from the request body (D-083).

### 9.2 REST allowlist

REST exists only for these categories. Anything else is a Server Action or a Server Component read.

1. Client-driven reads and polling (search autocomplete, admin operational metrics refresh).
2. Analytics beacons (content view, playback heartbeat) sent with `sendBeacon`/`fetch(..., { keepalive: true })`.
3. Exports and downloads (CSV datasets, authorized backup download).
4. Better Auth integration (`/api/auth/[...all]`).
5. Health checks (public minimal; authenticated detailed).
6. OpenAPI document.
7. Explicitly approved external integrations (webhooks) — none in the initial release.
8. Administration mutations driven by the admin client islands (`/admin/api/**`): the island owns the interaction, the route re-checks the actor and calls one workflow (D-086).

Push subscription management is a client-driven mutation and uses a Server Action, not REST.

The notification unread count is **not** a REST endpoint: the public layout resolves it on the server and hands it to the bell as a prop (D-088).

### 9.3 Examples

| Operation                   | Entrypoint                                 | Service/workflow                                                                        |
| --------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| Public drama/movie details  | Server Component                           | `content.getDramaDetails` / `content.getMovieDetails` + `analytics.getContentViewCount` |
| Record a details-page view  | REST `POST /api/analytics/view`            | `workflows/record-content-view`                                                         |
| Record a playback event    | REST `POST /api/analytics/playback`        | `analytics.recordPlaybackEvent`                                                         |
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
| Notification unread count   | Server Component (`components/public/Layout.tsx`) | `notifications.getUnreadNotificationCount`                                             |
| Push subscribe/unsubscribe  | Server Action                              | `notifications.upsertPushSubscription` / `removePushSubscription`                       |
| Terminate the sessions of an account | REST `POST /admin/api/users/[id]/sessions` | `workflows/admin/users.terminateUserSessionsForAdmin`                       |
| Health                      | REST `GET /api/health`                     | `maintenance.getHealth`                                                                 |
| OpenAPI                     | REST `GET /api/openapi`                    | Static/generated document                                                               |

### 9.4 HTTP concerns stay at the edge

Request parsing, status-code mapping, headers, cookies, and response envelopes live in `app` and `platform/http`. Domain services return typed results or throw typed errors. No module imports HTTP types.

The cookie jar is an HTTP concern: only a route handler writes a cookie. The analytics module resolves the anonymous session identifier, and the analytics route handler issues the cookie (D-083).

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
- Moderators act only through `review.read` (read the queue) and `review.manage` (resolve a report, remove a review). Review removal is permanent and cannot be undone.
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
- A pure helper that belongs to a module may live in a `*.shared.ts` file beside it, and a client island imports that file directly rather than the module index (D-049, §5.1). The `*.shared.ts` file carries no `server-only` marker, no database import, and no `@/` module import; the notification islands use `notifications/{preferences,notification-center,subscriptions,admin-notifications,announcements}.shared.ts` this way, and the player uses `analytics/playback-events.shared.ts` (S7, D-078, D-085).
- A client island never imports a module index, not even for a type. The DTOs a client island renders live in a `*.shared.ts` file, and a unit test enforces the boundary (D-085).
- A form and the action it calls share one schema from `lib/contracts`: the form validates with React Hook Form and `zodResolver`, the action re-validates with the same schema (CONVENTIONS §6.3/§6.4, D-085).
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

### 16.1 Implemented exception: the Trash expiry command (Prompts 072–074)

The dispatcher, the `maintenance.runTask` helper, the `SystemActor`, and the
`maintenance_task_runs` history table described above are **not implemented
yet**; they remain a future item.

The Trash expiry command is `scripts/trash-cleanup.mjs`: a standalone Node
script that talks to PostgreSQL directly with the `pg` driver. It is the one
documented exception to the "database access only in repositories and read
models" rule in §17, for two reasons:

- It runs outside the application process, so it cannot reach the application
  modules or the Drizzle schema registry.
- It has to remove content that the application may still be restoring, so it
  takes its own row locks (`FOR UPDATE`) and re-checks `deleted_at` under
  them.

The command is bounded, short-lived, and single-purpose: it removes one
candidate per transaction, skips a candidate whose drama is the source of an
existing movie, and writes one JSON object per line for `journald`. It is
covered by `tests/unit/scripts/trash-cleanup.test.ts` and
`tests/integration/content/trash-expiry.integration.test.ts` instead of by a
module-level test. It introduces no worker, no queue, and no scheduler inside
the application; the systemd timer owns the schedule.

### 16.2 Implemented exception: the notification maintenance command (Prompt 154, D-078)

`scripts/notification-maintenance.mjs` is the second standalone command. It
retries undelivered browser pushes, and it removes old, orphaned, and
structurally invalid notification records, in bounded batches. It runs outside
the application process on bare Node, without a build step, so it cannot import
the notification module index: that index is `server-only` and pulls in the
database client and the `@/` path aliases.

The command therefore mirrors the statements of
`src/modules/notifications/delivery.ts` with direct SQL, which is the accepted
exception to §17's "database access only in repositories and read models" rule
for the same reason as the Trash expiry command. The exception is kept as small
as the runtime allows:

- The delivery rule (`isDeliveryAllowed`), the five delivery limits
  (`MAX_DELIVERY_ATTEMPTS`, `MAX_PUSH_RETRY_ATTEMPTS`,
  `PUSH_RETRY_WINDOW_DAYS`, `DELIVERY_RETENTION_DAYS`, `DELIVERY_LEASE_SECONDS`),
  and the push transport
  are imported from pure, alias-free TypeScript files under
  `src/modules/notifications/`. Node runs those sources directly.
- `src/modules/notifications/delivery-limits.ts` is the single home of the five
  numbers; `delivery.ts` imports and re-exports them.
- The exclusive claim of a delivery candidate is part of the mirrored
  statements: the command selects the candidates with `FOR UPDATE SKIP LOCKED`
  inside a transaction, writes the lease, repeats the successful-delivery and
  attempt-cap checks before the send, and releases only its own lease (D-092).
- `tests/unit/scripts/notification-maintenance.test.ts` and
  `tests/unit/modules/notifications/delivery-limits.test.ts` pin the
  synchronisation, so a limit that drifts between the two sides fails the unit
  suite.

The command is bounded, short-lived, and single-purpose: one batch per table
per run, a hard `MAX_LIMIT`, a structured JSON result, and a non-zero exit on
failure. It introduces no worker, no queue, and no scheduler inside the
application; the operator or a systemd timer owns the schedule.

---

## 17. Enforcement

Architecture rules are enforced by tooling, not only by documentation.

| Rule                                       | Enforcement                                                                                                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layer/module dependency direction          | `eslint-plugin-boundaries` (or equivalent zone rules) in Prompt 013                                                                                                                                      |
| No circular dependencies                   | `import/no-cycle` across `src`                                                                                                                                                                           |
| Public API only (`modules/x/index.ts`)     | `no-restricted-imports` pattern `@/modules/*/**` excluding `index.ts`; a client island reads a `*.shared.ts` file instead (D-085)                                                                           |
| Server-only modules                        | `server-only` imports + lint rule forbidding `@/modules/*` and `@/platform/*` in `components` and `"use client"` files                                                                                   |
| DB access stays inside the owning module   | A module reaches the database through its own files and never writes another module's tables; the integration suite asserts the ownership of every table (D-086)                                             |
| Permission catalog single source           | Typed `PermissionKey` union; lint forbids permission-looking string literals in guard calls                                                                                                              |
| Type safety                                | TypeScript strict mode; no unrestricted `any`; no ignored type errors                                                                                                                                    |
| Data ownership                             | Repository boundaries + code review + read-model allowlist review                                                                                                                                        |
| New module/dependency/exception            | Requires a `DECISIONS.md` entry and an update to this document before implementation                                                                                                                     |

CI runs install, type check, lint (including architecture rules), unit tests, integration tests, and production build. A pull request that violates a boundary fails before review.

**Documented deviation (D-086).** Two rules of this table describe a layer the project does not have and are therefore restated as they are implemented:

- There is no `repository.ts` / `read-models.ts` split. About 48 files inside `src/modules/**` reach `@/db/client` directly, which is the repository-wide pattern. The rule that holds — and that the integration suite enforces — is that a module never writes another module's tables. A repository split would be an architectural change with its own decision, not a cleanup.
- The `no-restricted-imports` rules for the module boundary and for the database client are not configured in `eslint.config.js` yet. The boundaries are enforced by the unit-test guards (`tests/unit/architecture/`, `tests/unit/modules/notifications/client-boundary.test.ts`) and by the code review checklist in §17.1, not by a lint rule. Adding the lint rules is a mechanical follow-up, tracked in `docs/PROJECT_STATUS.md`.

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
