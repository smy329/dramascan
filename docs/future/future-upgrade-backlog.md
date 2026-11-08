# Future Upgrade Backlog

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Version:** 1.0  
**Date:** 2026-11-08

This document contains the future upgrade backlog as established by `REQUIREMENTS.md` §16.2 and Prompt 005. These items are explicitly future work and must not be treated as unfinished initial requirements. The initial release is complete without them.

---

## 1. Infrastructure and Scalability

### 1.1 Separate Services and Orchestration

- **Separate frontend and backend services** (e.g., Next.js frontend plus NestJS backend).
- **Dedicated persistent background workers** and a separate worker service.
- **Job queues and queue-based orchestration** (e.g., pg-boss or a broker).

### 1.2 Caching and Connection Pooling

- **Redis** for distributed caching, rate limiting, sessions, or pub/sub.
- **PgBouncer** or another external connection pooler.

### 1.3 External Storage and CDN

- **External object storage** and **CDN integration** for assets and media.
- **Horizontal scaling**, multi-instance deployment, **containerization**, **container orchestration**, and **multi-region architecture**.

### 1.4 Advanced Monitoring and Observability

- **Advanced monitoring** with Prometheus and Grafana.
- **Sentry** or equivalent external error monitoring.
- **External log aggregation**, distributed tracing, and advanced alerting.

### 1.5 Disaster Recovery and Backup

- **Advanced disaster recovery**, off-server backup replication, WAL archiving, point-in-time recovery, and isolated periodic restore testing.
- **Managed search services** or a dedicated search cluster.
- **External secret manager**.

### 1.6 Real-Time Communication

- **WebSockets**, SSE, real-time event streaming, or a message broker.

---

## 2. Video Infrastructure

### 2.1 Provider Integrations

- **Multiple external video-hosting provider integrations**.
- **HLS/DASH streaming** and adaptive bitrate.

### 2.2 Signed and Private Media

- **Signed or private media URLs** and advanced access control or DRM.

### 2.3 Video Processing

- **Video processing**, transcoding, packaging, and thumbnails.
- **Video migration**, upload, staging, and retry tools.
- **Video proxying**, relaying, or rehosting.
- **Advanced media delivery** and access-control systems.

### 2.4 Image Optimization

- **Server-side image optimization**, including Sharp or Next.js image optimization.

---

## 3. Product Features

### 3.1 User Identity and Management

- **Public user profiles**.
- **Custom profile editing** and custom profile pictures.
- **Account switching**.
- **Two-factor authentication** and additional identity providers.
- **Email notifications** and email infrastructure.
- **Self-service account deletion** and advanced account management.

### 3.2 Advanced User Features

- **Custom user lists** and episode-specific bookmarks or sharing.
- **Advanced watch-history management** (individual deletion, clear-all, advanced filters).
- **Advanced moderation workflows**, private moderator discussions, temporary review hide/unhide, and user-facing ticket tracking.
- **More elaborate incident postmortem governance**.
- **Advanced analytics**, reporting, exports, and data-warehouse integration.
- **Development and staging environments**.
- **Additional content migration tools**.
- **A/B testing**, feature flags, and experimentation.
- **General UI localization** and multi-language interface support.

### 3.3 Operational Enhancements

- **Scheduled content publishing**, recurring episode-release schedules, and scheduled announcements.
- **Complex job orchestration** and workflow engines.
- **Advanced hero scheduling**.
- **Additional SEO and discovery features** beyond the initial specification.

---

## 4. Hard Exclusions (Permanent)

The initial release **must not** implement any item in the sections above. The items below are permanent product or technical exclusions, not future backlog candidates. Overturning one requires a new recorded decision.

- Odysee or LBRY APIs, SDKs, authentication, claim IDs, or upload workflows.
- Custom password authentication.
- Fabricated cast, duration, release year, or other unsupplied metadata.
- Lowest Rated page.
- Arbitrary minimum rating-count threshold.
- Category images/icons or platform logos/icons.
- Release-year metadata.
- Complex hero scheduling engine.

---

## 5. Scope Enforcement Rules

- The initial implementation scope is §1 (in `INITIAL_SCOPE_AND_FUTURE_BACKLOG.md`). A feature is in the initial release only if `REQUIREMENTS.md` §3–§15 requires it or §1 lists it.
- The sections above (§2–§4) are the future upgrade backlog. Future upgrades must be separately designed and explicitly approved before implementation.
- Do not implement a future upgrade merely because it is common or convenient.
- Do not treat a future upgrade as an incomplete initial requirement. The initial release is complete without these items.
- Do not introduce any backlog item into the initial release, even as a temporary or optional dependency.
- §5 items are permanent exclusions. If a requested change requires one, stop and explain the conflict before proceeding.
- Any approved scope change updates `REQUIREMENTS.md` §16, `DECISIONS.md`, `PROJECT_STATUS.md`, and `CHANGELOG.md` in the same change.

---
