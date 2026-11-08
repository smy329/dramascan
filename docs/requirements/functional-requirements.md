# Functional Requirements

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Version:** 1.0  
**Date:** 2026-11-08  

This document captures the functional requirements from REQUIREMENTS.md §3–§15, organized by domain. It is the authoritative reference for what the initial release must do.

---

## 1. Content Model

### 1.1 Content Types

- **Three content structures:** season-based drama, flat drama, standalone movie.
- **Dramas, seasons, episodes, and standalone movies** with stable UUIDv7 IDs.
- **Canonical URLs:**
  - `/drama/{stableId}/{slug}`
  - `/movie/{stableId}/{slug}`
  - `/drama/{dramaId}/{slug}/episode/{episodeId}`
- **Episode numbering, ordering, moving between seasons,** and conversion between season-based and flat structures.

### 1.2 Publication State

- Publication states: **draft**, **published**, **unpublished**.
- **Trash** is derived from `deleted_at IS NOT NULL`, not a publication status value.
- Soft-deleted rows do not block reuse of slugs or names (partial unique indexes `WHERE deleted_at IS NULL`).
- `published_at` records the actual publication time used by "Recently Added". It is not an editable fake date.

### 1.3 Content Metadata

- Categories, platforms, similar dramas, information pages, SEO overrides, slug history/redirects, sitemap eligibility.
- Image asset metadata (stored as paths; files live on disk).
- Content-level ratings and reviews for **dramas and standalone movies only**; episodes excluded.

### 1.4 Content Operations

- CRUD, seasons, episodes, numbering, reordering, moving, conversion between structures.
- Publication/unpublish, bulk publication.
- Trash, restore, and permanent deletion.
- Similar-drama management.

---

## 2. Video Source and Playback

### 2.1 Mandatory Source Architecture

- Administrator-supplied **public direct HTTPS MP4 URLs**; syntax and scheme validation.
- **No video upload, staging, transcoding, processing, proxying, relaying, or rehosting** by the platform.
- Browser-based playback preview and actual-playback verification before publication (not assumed from `.mp4` extension).
- **Vidstack** playback directly from the external host; no backend video proxy.

### 2.2 Playback Features

- CSP media permissions scoped to approved sources only.
- Manual source replacement after successful preview and explicit confirmation; progress reset for the affected episode, with watch-history records and their historical dates preserved.
- Broken-source handling.
- Subtitles for episodes and standalone movies.

---

## 3. Public Website

### 3.1 Discovery

- Homepage and discovery: trending, popular, recently added, highest rated, categories, and platforms.
- Search with autocomplete and poster thumbnails; full-text and trigram search.

### 3.2 Details and Watch Pages

- Drama, movie, and episode details/watch pages.
- Canonical URLs, slug redirects, SEO metadata, Open Graph metadata, and sitemaps.
- Legal and information pages, and content sharing.

---

## 4. User Features

### 4.1 Authentication

- **Google-only** authentication through Better Auth; private profile.
- No password login, email/password registration, additional OAuth providers, custom profile names, custom avatars, public user profiles, account switching, or self-service deletion.

### 4.2 Bookmarks and My List

- Bookmarks and My List functionality.

### 4.3 Playback Progress

- Playback progress, watched state, Continue Watching, and cross-device synchronization.

### 4.4 Watch History

- Watch history for dramas, episodes, and standalone movies (content-level movie entries).

### 4.5 Ratings, Reviews, and Reactions

- Content-level ratings and reviews for **dramas and standalone movies only**; episodes excluded.
- Enjoying reactions; review sorting, reporting, and moderation.
- One active rating and one active review per user per content item.

### 4.6 Content Reports

- Authenticated content reports.

---

## 5. Administration and Moderation

### 5.1 Admin Dashboard

- Admin shell, dashboard, role-aware navigation, and RBAC with Super Admin, Content Manager, Moderator, Analyst, and custom roles.

### 5.2 Content Administration

- CRUD, seasons, episodes, numbering, reordering, moving, conversion, publication, bulk operations, similar dramas, Trash, images, and source replacement.

### 5.3 User, Report, and CSV Administration

- User, content, report, category, platform, legal-page, SEO, sitemap, and **CSV** administration.
- CSV export/import with dry-run preview and confirmed apply.

### 5.4 Moderation

- Content reports, review reports, review removal, and authorized user deactivation.

### 5.4 Admin Notifications

- Account/security notifications for user deactivation/reactivation, administrator authorization/deactivation, administrator role changes, and administrator session termination.
- Admin notifications are **in-app only** in the initial version.

---

## 6. Analytics

### 6.1 View Counting

- Privacy-conscious guest sessions and content-level view counting with the **six-hour deduplication window**.
- Episode playback analytics **without per-second writes**.

### 6.2 Aggregation

- Bounded aggregation, admin analytics dashboard, date filters, operational metrics, anomaly detection, and resource monitoring.
- Analytics covers dramas and standalone movies.

---

## 7. Notifications

### 7.1 Event Preferences

- Five event preferences.

### 7.2 Notification Delivery

- In-app notification center, browser push, announcements, and delivery safety/cleanup.

### 7.3 Mandatory Account/Security Notifications

- User deactivation/reactivation.
- Administrator authorization/deactivation.
- Administrator role changes.
- Administrator session termination.
- These **cannot** be disabled through ordinary event preferences.

---

## 8. Security

### 8.1 Authorization

- Server-side authorization for every protected page, Server Action, REST endpoint, and domain service.
- **Deny by default.** Missing permission, missing session, unknown resource state, and ambiguous ownership all fail closed.

### 8.2 Authentication

- Google OAuth, secure sessions and cookies, admin session timeouts, forced reauthentication, and last-Super-Admin protection.

### 8.3 Input and Output Safety

- PostgreSQL-backed rate limiting.
- Input validation with Zod.
- Output safety; CSP and security headers.
- OpenAPI/Swagger documentation; database hardening; backup and recovery security.

### 8.3 Database Security

- PostgreSQL accessible only through the application server's local or private connection.
- Role separation: migration role has DDL rights; application role has DML rights only.
- The application does not auto-run migrations at startup in production.

---

## 9. Maintenance and Operations

### 9.1 Maintenance Commands

- Short-lived systemd maintenance command framework with structured logs, task monitoring/history, dependencies, controls, and exit codes.
- Backup, validation, retention cleanup, and restore with integrity checks and explicit confirmation.

### 9.2 Health Checks

- Health checks, maintenance mode, alerts/incidents, and disk/capacity monitoring.

### 9.3 Production and Delivery

- Nginx, systemd, PostgreSQL production configuration, caching/compression, and GitHub Actions CI/CD.
- Manual approval, versioned releases, rollback, and expand-contract migrations.

---

## 10. Non-Functional Requirements

- Strict TypeScript; modular monolith boundaries; server-side pagination; bounded queries and indexes.
- Reliability, data integrity, dark-only responsive accessible UI, UTC timestamps, Vitest/Playwright testing, Pino logging, API conventions, and progress documentation.

---

**Cross-reference:** This document consolidates REQUIREMENTS.md §3–§15. The authoritative source remains REQUIREMENTS.md. For scope boundaries, see §16 (initial scope / future upgrade backlog / hard exclusions).