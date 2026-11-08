# DramaScan — Initial Scope and Future Upgrade Backlog

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Document:** Initial scope and future upgrade backlog  
**Version:** 1.0  
**Date:** 2026-11-08  
**Status:** Established by Prompt 004 (REQUIREMENTS.md §16); updated 2026-11-08 for consistency  

---

## 1. Initial Implementation (Mandatory Scope)

The initial release is a **single-deployable, low-RAM modular monolith**. One Next.js application, one PostgreSQL database, no Redis, no separate workers, no Docker, no external object storage, no CDN, no video processing, no external monitoring. All features below are mandatory unless explicitly excluded in §16.3.

### 1.1 Architecture baseline

- One Next.js App Router application (TypeScript) serving public pages, admin pages, Server Actions, and the approved REST endpoints.
- One PostgreSQL database accessed through Drizzle ORM with a conservative connection pool.
- React Server Components for page reads; Server Actions for mutations; REST only for the documented allowlist.
- PostgreSQL full-text and trigram search; PostgreSQL-backed rate limiting and caching.
- Nginx reverse proxy, systemd process management, and short-lived systemd-triggered maintenance commands.
- **Excluded:** No Redis, no separate worker service, no job queue, no Docker, no external object storage, no CDN, no video upload/transcoding/proxying, no external monitoring service.

### 1.2 Content model and catalog

- Three content structures: **season-based drama**, **flat drama**, **standalone movie**.
- Dramas, seasons, episodes, and standalone movies with stable UUIDv7 IDs and canonical URLs:
  - `/drama/{stableId}/{slug}`
  - `/movie/{stableId}/{slug}`
  - `/drama/{dramaId}/{slug}/episode/{episodeId}`
- Episode numbering, ordering, moving between seasons, and conversion between season-based and flat structures.
- Content metadata, categories, platforms, similar dramas, publication states (draft/published/unpublished), **Trash**, restore, and permanent deletion.
- Content-level ratings and reviews for **dramas and standalone movies only**; episodes excluded.
- Enjoying reactions for dramas and movies; review sorting, reporting, and moderation.

### 1.3 Video source and playback

- Administrator-supplied **public direct HTTPS MP4 URLs**; syntax and scheme validation.
- Browser-based playback preview and actual-playback verification before publication (not assumed from `.mp4` extension).
- **Vidstack** playback directly from the external host; **no backend video proxy**.
- CSP media permissions scoped to approved sources only.
- Manual source replacement after successful preview and explicit confirmation; progress reset for the affected episode, with watch-history records and their historical dates preserved.
- Broken-source handling and subtitles for episodes and standalone movies.
- **Excluded:** No video upload, staging, transcoding, processing, proxying, relaying, or rehosting.

### 1.4 Public website

- Homepage and discovery: trending, popular, recently added, highest rated, categories, and platforms.
- Search with autocomplete and poster thumbnails; full-text and trigram search.
- Drama, movie, and episode details/watch pages.
- Canonical URLs, slug redirects, SEO metadata, Open Graph metadata, and sitemaps.
- Legal and information pages, and content sharing.

### 1.5 User features

- **Google-only** authentication through Better Auth; private profile.
- Bookmarks and My List.
- Playback progress, watched state, Continue Watching, and cross-device synchronization.
- **Watch history** for dramas, episodes, and standalone movies (content-level movie entries).
- Content-level ratings, reviews, and Enjoying reactions for dramas and movies; review sorting, reporting, and moderation.
- **Authenticated** content reports.

### 1.6 Administration and moderation

- Admin shell, dashboard, role-aware navigation, and RBAC with Super Admin, Content Manager, Moderator, Analyst, and custom roles.
- Content administration: CRUD, seasons, episodes, numbering, reordering, moving, conversion, publication, bulk operations, similar dramas, Trash, images, and source replacement.
- User, content, report, category, platform, legal-page, SEO, sitemap, and **CSV** administration.
- Image management; system configuration and version history; maintenance mode.
- Admin accounts, sessions, login monitoring, and account/security notifications.
- Moderation: content reports, review reports, review removal, and authorized user deactivation.
- CSV export/import with dry-run preview and confirmed apply.

### 1.7 Analytics

- Privacy-conscious guest sessions and content-level view counting with the **six-hour deduplication window**.
- Episode playback analytics **without per-second writes**.
- Bounded aggregation, admin analytics dashboard, date filters, operational metrics, anomaly detection, and resource monitoring.
- Analytics covers dramas and standalone movies.

### 1.8 Notifications

- Five event preferences, in-app notification center, browser push, announcements, and delivery safety/cleanup.
- **Mandatory** account/security notifications for user deactivation/reactivation, administrator authorization/deactivation, administrator role changes, and administrator session termination.
- Admin notifications are **in-app only** in the initial version.

### 1.9 Security

- Server-side authorization for every protected page, Server Action, REST endpoint, and domain service.
- Google OAuth, secure sessions and cookies, admin session timeouts, forced reauthentication, and last-Super-Admin protection.
- PostgreSQL-backed rate limiting; input validation with Zod; output safety; CSP and security headers.
- OpenAPI/Swagger documentation; database hardening; backup and recovery security.

### 1.10 Maintenance and operations

- Short-lived systemd maintenance command framework with structured logs, task monitoring/history, dependencies, controls, and exit codes.
- Backup, validation, retention cleanup, and restore with integrity checks and explicit confirmation.
- Health checks, maintenance mode, alerts/incidents, and disk/capacity monitoring.
- **Excluded:** No persistent workers, no queue, no scheduler, no worker dashboards.

### 1.11 Production and delivery

- Nginx, systemd, PostgreSQL production configuration, caching/compression, and GitHub Actions CI/CD.
- Manual approval, versioned releases, rollback, and expand-contract migrations.
- Final audit and implementation report.

### 1.12 Non-functional requirements

- Strict TypeScript; modular monolith boundaries; server-side pagination; bounded queries and indexes.
- Reliability, data integrity, dark-only responsive accessible UI, UTC timestamps, Vitest/Playwright testing, Pino logging, API conventions, and progress documentation.

---

## 2. Future Upgrade Backlog (Not Initial)

The following are **explicitly future work**. They are not unfinished initial requirements and must not be implemented without separate design and explicit approval. The initial release is complete without them.

### 2.1 Infrastructure and scalability

- Separate frontend and backend services (e.g., Next.js frontend plus NestJS backend).
- Dedicated persistent background workers and a separate worker service.
- Job queues and queue-based orchestration (e.g., pg-boss or a broker).
- **Redis** for distributed caching, rate limiting, sessions, or pub/sub.
- PgBouncer or another external connection pooler.
- External object storage and CDN integration for assets and media.
- Horizontal scaling, multi-instance deployment, containerization, container orchestration, and multi-region architecture.
- Advanced monitoring with Prometheus and Grafana; Sentry or equivalent external error monitoring.
- External log aggregation, distributed tracing, and advanced alerting.
- Advanced disaster recovery, off-server backup replication, WAL archiving, point-in-time recovery, and isolated periodic restore testing.
- Managed search services or a dedicated search cluster.
- External secret manager.
- WebSockets, SSE, real-time event streaming, or a message broker.

### 2.2 Video infrastructure

- Multiple external video-hosting provider integrations.
- HLS/DASH streaming and adaptive bitrate.
- Signed or private media URLs and advanced access control or DRM.
- Video processing, transcoding, packaging, and thumbnails.
- Video migration, upload, staging, and retry tools.
- Video proxying, relaying, or rehosting.
- Advanced media delivery and access-control systems.
- Server-side image optimization, including Sharp or Next.js image optimization.

### 2.3 Product features

- Public user profiles.
- Custom profile editing and custom profile pictures.
- Account switching.
- Two-factor authentication and additional identity providers.
- Email notifications and email infrastructure.
- Self-service account deletion and advanced account management.
- Custom user lists and episode-specific bookmarks or sharing.
- Advanced watch-history management (individual deletion, clear-all, advanced filters).
- Advanced moderation workflows, private moderator discussions, temporary review hide/unhide, and user-facing ticket tracking.
- More elaborate incident postmortem governance.
- Advanced analytics, reporting, exports, and data-warehouse integration.
- Development and staging environments.
- Additional content migration tools.
- A/B testing, feature flags, and experimentation.
- General UI localization and multi-language interface support.

### 2.4 Operational and product enhancements

- Scheduled content publishing, recurring episode-release schedules, and scheduled announcements.
- Complex job orchestration and workflow engines.
- Advanced hero scheduling.
- Additional SEO and discovery features beyond the initial specification.

---

## 3. Hard Exclusions (Must Not Be Implemented)

The initial release **must not** implement any item in §2 (future upgrade backlog). The items below are permanent product or technical exclusions, not future backlog candidates. Overturning one requires a new recorded decision.

- Odysee or LBRY APIs, SDKs, authentication, claim IDs, or upload workflows.
- Custom password authentication.
- Fabricated cast, duration, release year, or other unsupplied metadata.
- Lowest Rated page.
- Arbitrary minimum rating-count threshold.
- Category images/icons or platform logos/icons.
- Release-year metadata.
- Complex hero scheduling engine.

---

## 4. Scope Enforcement

- The initial implementation scope is §1. A feature is in the initial release only if REQUIREMENTS.md §3–§15 requires it or §1 lists it.
- §2 is the future upgrade backlog. Future upgrades must be separately designed and explicitly approved before implementation.
- Do not implement a future upgrade merely because it is common or convenient.
- Do not treat a future upgrade as an incomplete initial requirement. The initial release is complete without §2 items.
- Do not introduce any §2 item into the initial release, even as a temporary or optional dependency.
- §3 items are permanent exclusions. If a requested change requires one, stop and explain the conflict before proceeding.
- Any approved scope change updates §16, `DECISIONS.md`, `PROJECT_STATUS.md`, and `CHANGELOG.md` in the same change.

---

**Cross-reference:** This document consolidates and clarifies REQUIREMENTS.md §16 for the Prompt 005 deliverable. The authoritative source remains REQUIREMENTS.md §16; this file is a reader-friendly rendering.