# PRODUCT REQUIREMENTS DOCUMENT

**Product:** DramaScan — International Drama & Movie Streaming Platform
**Document:** Initial Production Scope
**Version:** 1.0
**Date:** 2026-11-07
**Status:** Approved baseline for initial implementation; product decisions resolved 2026-11-08 and recorded in §17 and `DECISIONS.md`.

---

## 1. Purpose and Authority

### 1.1 Purpose

This document defines the complete initial product scope for the initial production release and records the approved product decisions in §17. It is the reference for architecture, data modeling, implementation, testing, and final acceptance.

### 1.2 Source precedence

1. `AGENTS.md` / the Detailed Micro-Prompt Development Pack (`D:\Source code\Opencode\DramaScan\Detailed MICRO-PROMPT DEVELOPMENT PACK.txt`) is the **authoritative specification**.
2. The older `MASTER DEVELOPMENT PROMPT.txt` is historical reference only. It is **not authoritative** where it conflicts with the Detailed Pack. In particular, its Odysee/LBRY and video-upload architecture is obsolete and must not be implemented.
3. Where the Detailed Pack contains an internal inconsistency, this document records the approved resolution in §17 and `DECISIONS.md` rather than silently choosing an interpretation.
4. Every explicit exclusion in the Detailed Pack is a hard restriction. It is not a deferred requirement and must not be implemented without a new, explicit user decision.

### 1.3 Scope rule

A capability is in scope only if this document or the Detailed Pack explicitly requires it. Features common to other streaming platforms are not implied. Future upgrades are listed separately in §16.2 and are not part of the initial release.

---

## 2. Product Overview

DramaScan is an international drama and movie streaming platform with:

- A cinematic, dark, responsive public website for discovering and watching content.
- Google-only authentication and personalized viewing features.
- A protected administration area for content, users, moderation, analytics, notifications, and operations.
- A lightweight Next.js full-stack modular monolith backed by PostgreSQL.
- Manual content publishing and a direct external HTTPS MP4 playback model.

### 2.1 Initial technology constraints

The implementation uses the finalized stack in the Detailed Pack: Next.js App Router, TypeScript, React Server Components by default, Tailwind CSS, shadcn/ui, PostgreSQL, Drizzle ORM, Better Auth, Vidstack, React Hook Form, Zod, TanStack Query where needed, Vitest, Playwright, Pino, PostgreSQL full-text/trigram search, hybrid Server Actions and REST, OpenAPI/Swagger, Nginx, systemd, Ubuntu 24.04 LTS, and GitHub Actions.

The initial architecture must remain a **low-RAM modular monolith**. The future upgrades in §16.2 and the hard exclusions in §16.3 must not be introduced in the initial release.

### 2.2 Core product principles

- Public pages prioritize discovery and viewing, not administration.
- Publishing is manual. There is no scheduling engine.
- Video is never uploaded, stored, transcoded, proxied, or rehosted by the platform.
- Server-side authorization is the security authority; hiding UI is never sufficient.
- Data is preserved across ordinary edits, reordering, conversion, and source replacement unless this document explicitly requires a reset.
- No mock data, fake ratings, fake view counts, or fabricated metadata may appear in production.
- No feature is complete merely because its interface renders.

---

## 3. Actors and Roles

### 3.1 Actors

| Actor              | Description                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guest              | Unauthenticated visitor. Can browse published content, search, view details and playback, and share content. Cannot submit content reports; content reports require authentication. Has no personalized data. |
| Authenticated user | Google-authenticated account. Has a private profile, bookmarks, playback progress, Continue Watching, watch history, ratings/reviews/reactions, reports, and notification preferences.                        |
| Content Manager    | Administrator responsible for content creation, editing, hierarchy, images, video sources, publication, and content organization.                                                                             |
| Moderator          | Administrator responsible for user moderation, content reports, review reports, and review removal.                                                                                                           |
| Analyst            | Read-only administrator with dashboard and analytics access.                                                                                                                                                  |
| Super Admin        | Full administrator. Controls administrators, roles, permissions, system configuration, permanent deletion, CSV export, backups, maintenance, and all operational controls.                                    |
| Custom role        | A role created by Super Admin with an explicit set of action/resource permissions.                                                                                                                            |

### 3.2 Role rules

- Initial roles are Super Admin, Content Manager, Moderator, and Analyst.
- Permissions are defined at action/resource level, not only by hard-coded role names.
- An administrator may hold multiple roles simultaneously; effective permissions are the union of all assigned roles.
- Super Admin has complete access.
- Content Manager handles content operations.
- Moderator handles user moderation, content reports, and review moderation.
- Analyst has read-only dashboard and analytics access.
- Super Admin may create and edit custom roles and assign permissions.
- The system must prevent accidental removal of the last effective Super Admin access.
- Public users cannot register as administrators. Only Super Admin may authorize an existing Google-authenticated account as an administrator.
- Navigation visibility follows permissions but is not the security boundary. Every protected page, Server Action, REST endpoint, and domain service must enforce server-side authorization and return appropriate unauthorized/forbidden responses.

---

## 4. Content Model

### 4.1 Content types

| Content type       | Structure                                | Required characteristics                                                                                                                                     |
| ------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Season-based drama | Drama → Seasons → Episodes               | Multiple seasons; each season has a title/label and deterministic order; episodes belong to a season.                                                        |
| Flat drama         | Drama → Episodes                         | Episodes belong directly to the drama; no artificial season records.                                                                                         |
| Standalone movie   | Movie → single video                     | Independent content type; no seasons or episodes; own canonical URL and playback source.                                                                     |
| Season             | Child of one drama                       | Title/season label, ordering position, publication state, episodes.                                                                                          |
| Episode            | Child of a drama, optionally of a season | Title, description, episode number, ordering position, thumbnail, publication state, direct video source, subtitle tracks.                                   |
| Category           | Reusable taxonomy                        | Unique name and slug, ordering, visibility; many-to-many with dramas and movies.                                                                             |
| Platform           | Reusable taxonomy                        | Unique name and slug, ordering; many-to-many with dramas and movies.                                                                                         |
| Subtitle track     | Playback metadata                        | Language label, source URL, default-track flag; attached to an episode or standalone movie.                                                                  |
| Information page   | Public page                              | Terms, Privacy, Community Guidelines, Copyright/DMCA, About, Contact; title, slug, content, SEO fields, publication state, preview, footer visibility/order. |
| Announcement       | Operational content                      | Manually published website announcement with notification behavior; no scheduling.                                                                           |
| Similar-drama link | Recommendation relationship              | Drama-to-drama recommendation with manual ordering; no self-reference or duplicates.                                                                         |

### 4.2 Hierarchy rules

- A season-based drama contains seasons and their episodes.
- A flat drama contains episodes directly and must never be forced to create a season.
- A standalone movie is its own content type and must not be modeled as a drama with a hidden season.
- An episode belongs to exactly one drama and may belong to one season of that drama.
- Episodes may be moved between seasons only within the same drama.
- Deleting a season moves the season and its episodes together to Trash; it does not permanently delete them.
- Content IDs are stable and are used in canonical URLs even when slugs change.
- Reordering, moving, conversion, and publication must preserve episode IDs, viewing records, ratings, reviews, bookmarks, and relationships unless an explicit rule in this document requires a reset.

### 4.3 Content metadata

**Drama and movie metadata:** title, slug, description, poster, banner, multiple categories, multiple platforms, Ongoing/Completed status, publication state, rating aggregate where applicable, view count where applicable, timestamps, and Trash state.

**Episode metadata:** parent drama, optional season, title, description, episode number, ordering position, thumbnail, publication state, direct video source URL, and subtitle tracks.

**Metadata rules:**

- Administrators enter all metadata manually.
- The system must not extract metadata from the MP4 URL or automatically generate thumbnails, banners, descriptions, or titles from the video.
- Release-year metadata must not be added.
- Cast, duration, release year, and other attributes must not be fabricated in structured data or public pages.
- Slugs must be unique and validated; duplicate or conflicting slugs are rejected.
- A slug change must preserve the old URL through a redirect to the new canonical URL.
- Poster and banner are separate assets with their intended portrait and landscape presentation; portrait artwork must not be stretched into a banner.

### 4.4 Categories and platforms

- A drama or movie may belong to multiple categories and multiple platforms.
- Relationships use many-to-many tables; comma-separated values are not permitted.
- Categories and platforms have unique names and slugs, ordering, and (for categories) visibility where applicable.
- Categories have no images or icons.
- Platforms have no logos or icons.
- Deletion is prevented while the entity is referenced by content unless the administrator explicitly resolves those relationships.

### 4.5 Similar dramas

- Similar-drama recommendations are generated from shared categories, platforms, and relevant metadata.
- Content Managers may manually add, remove, and reorder recommendations.
- Recommendations must not include duplicates or the drama itself.
- Similar-drama recommendations are a drama feature; movie recommendations are not specified.

### 4.6 Content structure conversion

- **Season-based → flat:** combine episodes in their existing sequence, renumber according to the approved conversion rules, and preserve episode IDs and viewing records.
- **Flat → season-based:** create Season 1 by default, allow the administrator to create additional seasons and distribute episodes, preview the result, and confirm before applying.
- **Drama → standalone movie:** allowed only when the drama contains exactly one episode. Show a confirmation preview, preserve the content identity and relevant relationships where the data model permits, and reject conversion when more than one episode exists.
- Conversions use a transaction and must be predictable and data-safe.

### 4.7 Publication and availability

- Publishing and unpublishing are manual operations for dramas, seasons, episodes, and standalone movies as appropriate.
- An episode must have a valid playback source and satisfy publication requirements before it can be published.
- Publishing a parent must not accidentally publish invalid or unpublished child content.
- Bulk publish/unpublish must skip invalid or unverified items and report which items were skipped and why.
- Public availability checks are centralized. Unpublished, trashed, or otherwise unavailable content must not be accessible through guessed URLs or direct API calls.
- The global empty-drama visibility setting supports:
  - **Show Coming Soon (default):** display poster, title, and description, but no Play button or episode list until a playable episode exists.
  - **Hide Until Episodes Available:** hide the drama from public discovery until a playable episode exists.
- Admin preview access is separate from public availability.

### 4.8 Trash, restoration, and permanent deletion

- Dramas, seasons, episodes, and movies use soft deletion through Trash.
- Authorized non-Super-Admin roles may move content to Trash.
- Restoration is available to authorized administrators.
- Only Super Admin may permanently delete content, including bulk permanent deletion.
- The default Trash retention period is 30 days and is configurable.
- Trash expiry uses a short-lived systemd-triggered maintenance command. It must protect active and recently restored content and log outcomes and failures. No persistent worker or queue may be introduced for Trash management.
- Before permanent deletion, the system checks dependencies and applies cleanup rules:
  - Remove bookmarks, playback progress, and watch history for the deleted content.
  - Retain anonymized ratings/reviews for aggregate analytics while unlinking user identity as specified.
- Destructive operations must show affected child records and consequences before confirmation.

---

## 5. Video Source and Playback

### 5.1 Mandatory source architecture

- Administrators enter a public, direct HTTPS MP4 streaming URL for each episode or standalone movie.
- The URL is stored in PostgreSQL as the playback source and is kept separate from poster, banner, and thumbnail image paths.
- The browser requests the media directly from the external host. The application must not download, proxy, relay, rehost, stage, transcode, or process the video.
- The external host must support appropriate CORS and byte-range requests for browser playback and seeking.
- The platform must make no claim that the source URL is hidden or protected from viewers.

### 5.2 Server-side validation

- Validate administrator-supplied URLs with Zod on the server.
- Require HTTPS, a valid URL format, and an allowed direct-source format consistent with the MP4 requirement.
- Reject unsafe schemes, malformed URLs, credentials embedded in URLs where inappropriate, and suspicious input.
- Do not perform unrestricted server-side HTTP requests to arbitrary administrator-supplied URLs; prevent SSRF.
- Clearly document that URL syntax validation does not prove that a video is playable.

### 5.3 Administrator input

- The episode/movie form must have a clearly labeled direct MP4 URL field with an explanation that the administrator must provide a public, browser-playable HTTPS MP4 URL.
- The form must not show a file picker, upload button, drag-and-drop video area, upload percentage, resumable upload controls, or video staging interface.
- Validation errors appear next to the source field.

### 5.4 Browser playback preview

- Provide an admin preview that tests the entered URL through actual browser playback.
- Where possible, verify seeking and playback behavior.
- Explain failures caused by inaccessible URLs, unsupported media, CORS restrictions, or lack of byte-range support.
- A successful URL save or an `.mp4` suffix is not proof of playback.

### 5.5 Public playback

- Use Vidstack to play the stored direct MP4 URL in the viewer's browser.
- Support standard playback controls, seeking, volume, fullscreen, playback speed, and responsive behavior.
- The player must remain usable on desktop and mobile without surrounding navigation or overlays obstructing essential controls.
- Player accessibility must include clear labels, adequate touch targets, keyboard-accessible controls where supported, and readable error messages. A separate site-wide keyboard-navigation feature is not required.

### 5.6 Content Security Policy

- Configure CSP to permit only the required media sources and approved external resources.
- Do not use unrestricted wildcard media permissions.
- Keep image, script, style, and media source policies appropriately separated.
- Document how an authorized administrator or developer adds a new trusted media host.
- Security headers must remain compatible with Google OAuth, Vidstack, approved external MP4 hosts, and browser push. Do not weaken headers globally to solve one integration problem.

### 5.7 Source replacement

- An administrator may replace an episode's source only after the new URL passes the browser playback preview and the administrator explicitly confirms the replacement.
- Preserve the episode ID, title, description, thumbnail, hierarchy, reviews, ratings, and other relationships.
- Reset playback progress for the affected episode to zero for all users and mark it unwatched.
- Preserve watch-history records and their historical dates.
- Do not affect other episodes.
- Perform database changes in a transaction and record the replacement event in the appropriate operational records.

### 5.8 Broken-source handling

- When an external source becomes unavailable or playback fails, show a clear viewer-facing error with a manual Retry option.
- Do not automatically search for replacement URLs, repair sources, switch providers, or repeatedly retry in the background.
- Keep the stored source unchanged until an administrator manually replaces it.
- Provide appropriate admin visibility into reported or detected playback failures without claiming that every failure can be detected server-side.

### 5.9 Subtitles

- Use Vidstack-supported subtitle tracks and formats.
- Administrators manage subtitle track metadata and source URLs for an episode or standalone movie.
- Support language labels and default-track selection where appropriate.
- Validate subtitle URLs and avoid unrestricted server-side fetching.
- Do not introduce a subtitle transcoding service.

### 5.10 Prohibited video capabilities

There must be no Odysee/LBRY integration, no video-file upload or staging, no automatic upload retry, no video processing/transcoding, no backend video proxy/relay/rehost, and no video storage capacity planning. Obsolete upload infrastructure must be removed.

---

## 6. Public Website

### 6.1 Layout and navigation

- The public site uses a cinematic, modern, dark, responsive design focused on discovery and viewing.
- Public and admin layouts are separate and must not share inappropriate navigation.
- Desktop navigation includes Home, Trending, Bookmark, Category, and Login/Profile. Secondary destinations belong in a hamburger/overflow menu.
- Bookmark remains visible as a destination; guests attempting personalized functionality are asked to sign in.
- Mobile bottom navigation includes Home, Trending, Bookmark, and Profile. Category, Platform, and other secondary destinations belong in the hamburger menu.
- Navigation must not overlap the player, dialogs, or mobile browser safe areas.
- The footer displays configurable links to Terms, Privacy, Community Guidelines, Copyright/DMCA, About, and Contact, with admin-controlled visibility and ordering. Legal-page URLs must not be hard-coded in multiple components.
- Reusable drama and movie cards support poster, title, content type, rating where available, and appropriate status indicators. Cards work in carousels and discovery grids, preserve image proportions, and never display a fake rating when no ratings exist.
- Reusable skeletons, loading indicators, empty states, and retry states are used across public and admin interfaces. Each state communicates what is happening and provides a sensible next action where possible; operations that fail must not remain indefinitely loading.

### 6.2 Homepage

- **Hero:** administrator-selected featured drama or movie with artwork, title, description, and Play/Details actions. Super Admin or authorized Content Managers may select and update the featured item. If no featured item is selected, use an automatically selected suitable published item. If the selected item becomes unpublished, trashed, or unavailable, use the fallback. Unpublished content must never be exposed.
- **Hero rotation:** optional admin setting. When enabled, rotate only among eligible featured items; when disabled, keep the selected hero stable. No complex scheduling engine.
- **Trending:** recent-activity weighted ranking using unique viewers, watch time, and recency. Repeated refreshes must not inflate ranking. Support administrator feature/pin controls.
- **Popular:** a distinct ranking using historical popularity metrics, deterministic and explainable. It must not simply duplicate Trending.
- **Recently Added:** based on actual content publication/availability time. Include published dramas and movies; exclude drafts and unpublished content; do not use an editable fake publication date.
- **Continue Watching:** authenticated user's unfinished items only. Show episode title and progress with a resume action; hide the section when no eligible item exists. Guests must not receive another user's personalized content.
- **Category sections:** published content carousels by category, with administrator control over visibility and ordering where applicable. Do not create a separate landing page for every category.

### 6.3 Discovery pages

- **Discovery grid:** eligible published dramas and movies with efficient pagination or incremental loading, unified content-type filter, and approved sorting/filtering. Do not load the entire catalog.
- **Trending page:** dedicated page using the same ranking service as the homepage Trending section; support content-type filtering; refreshing must not inflate metrics.
- **Popular page:** dedicated page with its own popularity ranking and content-type filtering; stable pagination/sorting; not identical to Trending.
- **Recently Added page:** published dramas and movies sorted by actual publication/availability time; content-type filter and pagination; no drafts or unpublished items.
- **Highest Rated page:** genuine active rating averages only; exclude unrated content; no arbitrary minimum rating-count threshold; no Lowest Rated page; content-type filter for dramas and standalone movies.
- **Category browse:** combined browsing experience with content cards, filters, multiple category selection where supported, and pagination. No separate custom landing page per category.
- **Platform browse:** published dramas and movies associated with a platform, with content-type filter, sorting, pagination, and a structure consistent with category browsing.

### 6.4 Search

- Search across content titles, categories, and platforms using PostgreSQL full-text search and trigram matching.
- Provide live autocomplete with poster thumbnails, recent searches, and popular suggestions, plus a dedicated results page.
- Support Ongoing/Completed filters and approved sorting: newest, trending, popular, highest rated, and most viewed.
- Use pagination and avoid expensive full-catalog queries.
- Search results and suggestions must be secure and must not expose unpublished content.

### 6.5 Details and watch pages

- **Drama details:** poster/banner, title, description, categories, platforms, Ongoing/Completed status, rating, view count, bookmark action, Play/Continue action, episode count, seasons, and similar dramas. Respect publication state and empty-drama visibility. Do not expose unpublished episodes.
- **Movie details:** poster/banner, title, description, categories, platforms, rating, view count, bookmark action, and Play/Continue action, without season or episode navigation.
- **Episode navigation:** season selector for season-based dramas; direct episode list for flat dramas; clearly indicate the current episode; distinguish available, unpublished, and unavailable content according to public visibility rules; avoid exposing private source URLs unnecessarily in server-rendered page data.
- **Watch page:** Vidstack player, episode information, navigation, subtitles, and relevant drama details; responsive for desktop and mobile; essential controls must remain unobstructed.

### 6.6 Canonical URLs

- Drama URL format: `/drama/{stableId}/{slug}`.
- Movie URL format: `/movie/{stableId}/{slug}`.
- Episode URL format: `/drama/{dramaId}/{slug}/episode/{episodeId}`.
- Resolve episodes through their stable ID and validate the relationship with the parent drama.
- Do not create independently indexed episode pages.
- When a slug changes, redirect the old URL to the canonical URL.
- Public metadata must use the canonical URL.

### 6.7 SEO and sharing metadata

- Generate SEO titles and descriptions automatically from content metadata when no manual override exists.
- Authorized administrators may enter manual SEO overrides. Automatic generation must never overwrite manual values.
- Apply metadata to public drama, movie, category, platform, and information pages.
- Generate default Open Graph and X metadata from title, description, and poster, with approved manual overrides.
- Use safe fallback images, validate metadata lengths, and ensure metadata reflects canonical URLs and published content.
- Generate XML sitemaps for published dramas, standalone movies, and eligible public information pages.
- Exclude drafts, unpublished content, trashed items, and pages explicitly excluded by administrators from sitemaps.
- Update sitemap eligibility when content is published, unpublished, or permanently deleted.
- Sitemap exclusion is not access control; excluded but publicly accessible pages remain distinct from unpublished or private content.
- Implement Schema.org structured data for Website, Organization, Drama/TV Series, Season, Episode, AggregateRating, BreadcrumbList, and video metadata where supported.
- Publish only genuine rating aggregates. Do not invent cast, release year, duration, or other attributes the administrator has not supplied.

### 6.8 Legal and information pages

- Public routes render published legal and information pages.
- Unpublished pages are not publicly accessible.
- Provide appropriate not-found behavior, metadata, canonical URLs, and footer links.
- Page content is managed in the admin interface, not hard-coded into application components.

### 6.9 Sharing

- Support Copy URL, native mobile sharing where supported, Facebook, WhatsApp, Telegram, and X.
- Share the drama or standalone movie details URL only.
- Do not implement episode-specific sharing.
- Shared links must show appropriate Open Graph/X title, description, and artwork and must not expose unpublished content.

---

## 7. User Features

### 7.1 Authentication and account

- Google OAuth is the only login provider, integrated through Better Auth with PostgreSQL and secure session management.
- Implement sign-in, callback handling, account linking, and safe authentication errors.
- On first sign-in, create the application user record and associate it with the Google identity.
- On later sign-ins, synchronize only approved profile information (Google name and profile image).
- Do not implement password login, email/password registration, other OAuth providers, custom profile names, custom profile pictures, public user profiles, account switching, or self-service account deletion.
- The user profile page is private and shows the approved Google name and image, account information, and access to personalized features.
- Administrators may deactivate and reactivate users. Deactivated users cannot access authenticated features, but their reviews, ratings, analytics, viewing records, and other historical data are retained.
- Deactivation must not remove historical data.

### 7.2 Bookmarks and My List

- Bookmarks are content-level only (dramas and standalone movies), never episode-level. Users maintain one personal My List. Movie bookmarking is required by the standalone movie details page; "drama-level" in the Detailed Pack means content-level, not episode-level.
- Users can add and remove dramas or movies; the list synchronizes across authenticated devices.
- Authentication is required for bookmark actions.
- The Bookmark/My List page shows bookmarked drama and movie cards, empty states, and remove actions.
- Respect publication visibility. If bookmarked content becomes unavailable or is deleted, handle the record consistently with Trash and permanent-deletion rules.
- Do not add episode-level bookmarks or custom user-created lists.

### 7.3 Playback progress and Continue Watching

- Track playback progress for authenticated users at a reasonable periodic or debounced interval; do not write to PostgreSQL every second.
- Store the latest position and duration. Server-side data is the source of truth.
- Handle page navigation, completion, interruptions, and network failures without corrupting progress.
- Implement per-episode watched/unwatched state using the configured completion threshold.
- Allow manual watched/unwatched marking where the approved interface supports it.
- Keep progress and watched state consistent across devices.
- Provide one configurable completion threshold used consistently by the player and Continue Watching; do not hard-code divergent rules.
- When a user returns to an episode or movie, offer resume from the saved position or restart where appropriate; respect source-replacement progress resets.
- Provide next-episode navigation using actual content order, respecting season boundaries and flat structures. Skip unpublished/unavailable episodes. If no next playable episode exists, show an end-of-content state.
- Automatic next-episode playback starts the next playable episode immediately when the current episode completes, without an additional delay or countdown timer, respecting the completion threshold and availability rules.
- Handle simultaneous playback on multiple devices/tabs with timestamps and a deterministic update strategy so older progress updates do not overwrite newer progress. Do not introduce real-time synchronization or WebSockets.
- The Continue Watching page shows the relevant content (drama or standalone movie), the episode where applicable, the progress indicator, and a resume action; removes completed items per the threshold; and allows manual removal from Continue Watching without deleting watch history. Standalone movies use equivalent completion logic.

### 7.4 Watch history

- Provide a dedicated Watch History page showing recently watched dramas, standalone movies, and episodes with the last-watched date.
- Keep Watch History separate from Continue Watching.
- Preserve historical viewing records even when playback progress is reset or an episode source is replaced.
- Synchronize watch history across authenticated devices using server-side records.
- Avoid duplicate records for every progress update; preserve meaningful timestamps and ordering.
- Keep guest analytics separate from the authenticated user's personal watch history.
- Do not implement individual history deletion, clear-all history, or advanced history filters.

### 7.5 Ratings, reviews, and reactions

- Authenticated users may submit a 1–5 star rating for a drama or standalone movie, update it, and maintain one active rating per content item (drama or movie).
- Validate the rating range and prevent duplicate active ratings.
- Do not create ratings for episodes.
- Public average rating for a drama or movie uses each user's latest active rating; rating count represents unique users, not rating changes.
- Hide rating information when no ratings exist. Never generate fake ratings or placeholder averages. Display compact counts where appropriate, such as `⭐ 4.5 (1.2K)`.
- Authenticated users may submit one active written review per drama or standalone movie and edit their own review. Reviews for episodes are not supported.
- Preserve review creation time and update the last-edited timestamp when content changes.
- Users cannot permanently delete their own reviews.
- Add an Enjoying reaction to each review. Authenticated users may add or remove one reaction per review; display the enjoyment count and prevent duplicates.
- Allow review sorting by Most Enjoying, Newest, and Highest Rated.
- Review report reasons: spam/advertising, harassment/bullying, inappropriate language, misleading/false information, and other, with an optional description.
- Allow one active report per user per review. A user may report again after the earlier report is resolved. Multiple users may report the same review.
- Reported reviews remain visible while pending moderation.
- Only Moderators or other explicitly authorized roles may permanently remove reviews. Removed reviews cannot be restored.
- Notify the reporter of the resolution outcome.
- Do not implement temporary hide/unhide or private moderator discussions.

### 7.6 Content reports

- Provide a user-facing content report form with reasons: video not playing, wrong/missing episode, incorrect information, copyright complaint, inappropriate content, and other.
- Allow an optional description.
- Validate submissions and prevent spam through rate limiting.
- Authentication is required to submit a content report.
- Authorized moderators/administrators can inspect reports, resolve them, and record the outcome.
- Do not build a user-facing ticket-tracking system.

---

## 8. Administrator Features

### 8.1 Admin shell

- Separate admin layout with sidebar navigation, header, account menu, dashboard entry, and responsive behavior.
- Role-aware sidebar groups for dashboard, content, moderation, users, analytics, notifications, and system configuration.
- Breadcrumbs on nested admin pages.
- Do not show inaccessible menu items or dead links. Super Admin-only settings remain hidden from other roles and protected at the API level.
- Reusable admin tables with server-side pagination, sorting, search, filters, empty states, and loading states. Do not load entire collections into browser memory.
- Reusable create/edit forms using React Hook Form and Zod, with validation messages, dirty-state warnings, saving indicators, and server error display. Server-side validation remains authoritative.
- Reusable confirmation dialogs for destructive actions, publishing, restoring, permanent deletion, source replacement, and other consequential operations. Show affected content and consequences; do not confirm every minor interaction.

### 8.2 Admin dashboard

- Role-aware widgets for content, users, moderation, analytics, and system health.
- Display only data the current administrator is permitted to view, with useful summary metrics and links.
- Analyst remains read-only; Content Manager and Moderator see their respective operational areas; Super Admin sees all permitted information.
- Do not rely on hiding widgets as a substitute for server authorization.
- Super Admin defines the global default dashboard layout.
- Individual administrators may rearrange or hide widgets they are permitted to access and restore the global default.
- New widgets are added to the global default without overwriting existing personal layouts.

### 8.3 Content management

- **Drama creation:** title, slug, description, poster, banner, categories, platforms, Ongoing/Completed status; support both season-based and flat structures; validate required fields; reject duplicate/conflicting slugs; do not add release-year metadata.
- **Drama editing:** edit metadata, images, categories, platforms, status, and slug; preserve identity and all season/episode/bookmark/review/rating/viewing relationships; slug changes redirect old URLs.
- **Drama listing:** search, filters, pagination, content status, episode counts, and relevant actions; support draft, published, unpublished, and trashed views according to permissions; efficient queries.
- **Season creation:** title or season label, ordering position, parent drama; prevent invalid relationships; deterministic order.
- **Season editing/deletion:** edit metadata and ordering; deletion moves the season and its episodes together to Trash; show affected episode count; prevent deletion when it would violate an active critical workflow.
- **Episode creation:** title, description, episode number, ordering position, thumbnail, publication state, direct video-source URL, and subtitle tracks; support episodes in a season or directly in a flat drama; use the direct MP4 URL workflow, not file upload.
- **Episode editing:** edit metadata, ordering, thumbnail, publication state, video source, and subtitle tracks; preserve episode ID and relationships; source replacement follows §5.7.
- **Episode listing:** grouped by drama and season where applicable; show episode number, title, publication state, source status, and actions; support search/filters; display flat and season-based structures correctly.
- **Automatic episode numbering:** assign the next appropriate number on creation; support manual editing and explicit renumbering; do not automatically renumber every episode after deletion or reorder; avoid unexpected changes to published episode numbers.
- **Episode reordering:** drag-and-drop or equivalent; support inserting between episodes; update ordering positions safely; preserve episode IDs, progress, history, ratings, and relationships; do not silently change episode numbers unless requested.
- **Moving episodes:** individual or bulk moves between seasons of the same drama; prevent cross-drama moves; update parent and ordering transactionally; preserve IDs, source URLs, progress, and history.
- **Flat drama management:** never force a season; show the correct hierarchy; provide the same episode capabilities as season-based dramas.
- **Standalone movies:** create/edit title, description, poster, banner, categories, platforms, publication state, direct video source, and subtitle tracks; treat movies as independent content; reuse appropriate metadata and playback services while preserving content type.
- **Structure conversion:** implement §4.6 with preview and transaction.
- **Drama-to-movie conversion:** implement §4.6 one-episode restriction.
- **Publication controls:** manual publish/unpublish for dramas, seasons, episodes, and movies; require a valid source for episode publication; parent publication must not publish invalid children.
- **Bulk publication:** select multiple eligible items; skip invalid/unverified episodes and report skipped items and reasons; use safe transactions or bounded batches.
- **Empty-drama visibility:** implement the global setting in §4.7.
- **Similar dramas:** implement §4.5.
- **Trash:** implement §4.8, including restoration and permanent deletion restrictions.

### 8.4 Image management

- Store poster and banner originals on persistent application-server disk.
- Do not perform server-side image processing, conversion, resizing, or optimization.
- Use safe, unique filenames and a predictable storage directory separate from application source code and deployment artifacts.
- Validate allowed image formats, file size, file signatures, and safe filenames.
- Preserve originals and intended proportions; do not stretch portrait artwork into a banner; keep poster and banner assets separate.
- Serve stored originals directly through the application/Nginx static delivery configuration with appropriate content types, cache headers, and safe access rules.
- Do not route images through Next.js Image Optimization or Sharp.
- Prevent directory traversal and unauthorized filesystem access.

### 8.5 Users, reports, and content overview

- Protected user-management page with search, pagination, account status, approved Google profile information, and approved administrative actions.
- Authorized administrators may inspect and deactivate/reactivate users according to permissions.
- Protect personal viewing data and prevent unauthorized access to private profiles.
- Unified admin content overview for dramas, seasons, episodes, and standalone movies, with content type, publication state, category, platform, and other relevant filters; role-based access and server-side pagination.
- Report-management view for authorized moderators/administrators to inspect reports, resolve them, and record outcomes.
- Keep internal report management separate from the public viewing experience.

### 8.6 Categories and platforms

- Admin CRUD for categories: name, slug, ordering, and visibility as appropriate.
- Admin CRUD for platforms: name, slug, and ordering.
- Prevent deletion while referenced by content unless relationships are explicitly resolved.
- No category images/icons and no platform logos/icons.

### 8.7 Legal pages, SEO, and sitemap administration

- Manage Terms, Privacy, Community Guidelines, Copyright/DMCA, About, and Contact pages.
- Support title, slug, page content, SEO title, SEO description, publication status, preview, and footer visibility/order.
- Do not hard-code full page content into components.
- Manage SEO overrides and Open Graph/X metadata overrides.
- Manage sitemap exclusions without changing publication permissions.

### 8.8 CSV export and import

**Export (Super Admin only):**

- Approved datasets: users, dramas, standalone movies, episodes, categories, platforms, reviews, ratings, reports, and analytics.
- Support relevant filters and UTF-8 output.
- Do not implement Excel export.
- Protect sensitive fields and enforce authorization rules.

**Import:**

- Import metadata and relationships only. Video binaries and video-file uploads are not part of import; episode video sources remain direct external URLs.
- Validate columns, types, required fields, relationships, duplicates, and stable identifiers.
- Display a preview of records that would be created, updated, skipped, or rejected.
- Require a dry run for every import.
- Support create/update behavior and optional skipping of existing records.
- Never delete existing records through CSV import.
- Allow partial success and generate a failed-row CSV with useful error messages.

### 8.9 System configuration and maintenance mode

- System Configuration is accessible only to Super Admin, enforced in the UI, Server Actions, and REST API.
- Settings are database-backed and grouped by domain, with names, typed values, descriptions, update timestamps, and the responsible administrator.
- Validate settings with Zod; keep secrets out of ordinary configuration exports.
- Classify settings as immediately applicable or restart-required. Runtime-safe settings take effect without restart; restart-required settings show the requirement clearly, validate the proposed value, and prevent an inconsistent state. Do not pretend a restart happened.
- Record configuration version history with before/after values where safe, administrator identity, timestamps, and version information.
- Allow Super Admin to inspect previous versions and restore one; a rollback creates a new version rather than deleting intervening history.
- For consequential settings, show current value, proposed value, and impact; validate before saving; require explicit confirmation; do not partially apply a multi-setting change.
- Allow Super Admin to export approved non-secret configuration as JSON and import validated configuration with a preview and confirmation.
- Maintenance mode is manual and Super Admin-controlled: configurable public page/message, optional estimated return time, and retained admin access. No maintenance scheduling or recurring publication.

### 8.10 Admin notifications, sessions, and accounts

- Admin notification center with unread count, history, categories, filters, mark-read/unread, details, and deep links.
- Admin notifications use in-app delivery only in the initial version. Do not implement admin email or browser push unless a separate approved decision changes scope.
- Sensitive notifications are visible only to authorized roles; critical system alerts are visible to Super Admin.
- Admin sessions have configurable inactivity timeout and maximum lifetime, enforced server-side.
- Super Admin can inspect administrator sessions, terminate an individual or selected sessions, or force reauthentication; show relevant device, browser, IP, and last-activity metadata where available.
- Record successful and failed administrator login attempts, repeated failures, and suspicious patterns with IP, browser, device, and timestamps; never store credentials.
- Implement configurable temporary restrictions for repeated failures and dashboard alerts for Super Admin.
- Revoke sessions after Google security changes only when the change can be reliably detected; do not promise real-time Google security notifications.
- Super Admin can authorize an existing Google-authenticated account as an administrator, activate/deactivate it, and inspect assigned roles.
- The first Super Admin is bootstrapped through an environment-configured authorized Google email after successful Google authentication. No public setup wizard or arbitrary elevation endpoint.
- RBAC follows §3.2, including multiple roles, custom roles, permission checks, and last-Super-Admin protection.

---

## 9. Moderation

- Content reports are reviewed and resolved through the admin interface with recorded outcomes.
- Review reports are reviewed by Moderators or explicitly authorized roles.
- Reported reviews remain visible while pending moderation.
- Moderators or explicitly authorized roles may permanently remove reviews; removed reviews cannot be restored.
- Notify reporters of review-report resolution outcomes.
- Do not implement temporary hide/unhide, private moderator discussions, or a user-facing ticket-tracking system.
- Review and content report submissions are rate-limited to prevent spam.
- Provide a Community Guidelines page.
- Moderators handle user moderation according to their permissions, including user deactivation where authorized.
- All moderation actions are server-authorized and auditable where the specification requires operational records.

---

## 10. Analytics

### 10.1 Privacy and guest sessions

- Use privacy-conscious anonymous guest session identification for analytics.
- Avoid unnecessary personal data and invasive fingerprinting.
- Keep guest analytics distinct from authenticated user activity.
- Define a limited retention policy; session identifiers must not function as public personal profiles.
- Keep personal identifiers separate from anonymous analytics where possible.
- Do not store excessive event detail or unnecessary personal information.

### 10.2 View counting

- Count a view when a visitor views a drama or standalone movie details page, not merely when playback begins.
- Count at most one qualifying view per visitor per content item during a rolling six-hour window. A new qualifying view after the window may count again.
- Apply the rule to authenticated account IDs and privacy-conscious guest session IDs.
- Repeated refreshes must not inflate view counts.
- Display compact, human-readable view counts where appropriate. Never fabricate counts.

### 10.3 Episode playback analytics

- Record relevant episode playback activity: unique viewers, watch duration, completion, and authenticated-versus-guest classification.
- Use bounded database writes; do not write an event on every playback second.
- Keep analytics collection separate from user-facing playback progress.
- Distinguish playback starts, actual watch duration, and completed viewing.
- Handle interrupted sessions, repeated views, and incomplete progress carefully.
- Do not assume that opening a player means an entire episode was watched.
- Avoid counting invalid or implausible playback data as genuine engagement.

### 10.4 Aggregation

- Use direct PostgreSQL writes and short-lived maintenance commands or on-demand calculations for aggregation.
- Do not introduce persistent analytics workers, Redis, pg-boss, or a queue.
- Use indexes and bounded queries to avoid affecting normal viewing performance.

### 10.5 Admin analytics dashboard

- Available to Analyst and higher roles.
- Show overview metrics, content performance, viewer activity, and engagement trends.
- Use Asia/Dhaka for display and date-range interpretation; store timestamps consistently in UTC.
- Restrict sensitive user information according to permissions.
- Date filters: Today, Yesterday, Last 7 Days, Last 30 Days, Last 90 Days, This Month, Last Month, and custom ranges.
- Validate date ranges and prevent expensive unrestricted analytics queries.
- Separate operational metrics from historical analytics. Operational metrics refresh automatically at a sensible interval; historical analytics may require manual refresh.
- Avoid excessive polling or long-running connections. Clearly indicate when displayed data was last updated.

### 10.6 Operational analytics and monitoring

- Collect basic execution duration, success/failure, and relevant system resource metrics for approved maintenance operations.
- Do not collect queue wait times or persistent-worker utilization; the initial architecture has neither.
- Detect meaningful operational anomalies: maintenance failures, unusual duration increases, repeated errors, disk pressure, and resource pressure.
- Use simple configurable thresholds and provide a useful explanation; do not build predictive systems.
- Display essential CPU, memory, disk usage, database health, and application health metrics where available.
- Use lightweight system-native collection; do not install Prometheus, Grafana, or other dedicated monitoring infrastructure.
- Built-in error monitoring captures frontend/backend exceptions and failed API requests with severity, timestamp, relevant stack information, request context, and safe metadata.
- Redact credentials and personal data. Retain error records for 30 days by default.
- Provide search and filtering by severity, time, module, route, and error category, with pagination and detail views.
- Do not expose sensitive request bodies or authentication secrets. Restrict access by administrator permissions.
- Do not introduce Sentry in the initial implementation.

---

## 11. Notifications

### 11.1 Event preferences

Five event preferences:

1. New episodes from bookmarked dramas.
2. Newly published dramas.
3. New seasons.
4. Website announcements.
5. Account/security notifications.

Global In-app On/Off and Browser Push On/Off controls also exist. Delivery requires both the global delivery setting and the relevant event preference. Essential account/security notifications remain mandatory and cannot be disabled through ordinary event preferences.

### 11.2 Browser push

- Implement browser push using an approved provider abstraction.
- Prefer Firebase Cloud Messaging if it is available at no cost and meets requirements; otherwise use native Web Push.
- Do not assume a paid provider is acceptable.
- Keep provider-specific code isolated so the provider can change without rewriting notification business logic.
- Do not introduce email infrastructure.
- Request browser permission at an appropriate time, not immediately on first page load.
- Store and manage browser push subscriptions securely.
- Handle permission denial, expired subscriptions, and unsubscribe behavior.

### 11.3 In-app notifications

- Notification center with bell icon, unread count, notification history, and mark-read behavior.
- Support the approved event categories and deep links.
- Keep notifications private to their intended user.

### 11.4 Notification events

- **New episode:** when a new eligible episode is manually published, identify users who bookmarked the parent drama and have the relevant preference enabled; create in-app notifications and send browser push where permitted. Do not implement recurring schedules or scheduled publishing.
- **New drama/season:** notify according to preferences when a drama or season is manually published. Avoid duplicate notifications caused by repeated publication requests or retries. Do not add email delivery or scheduled announcements.
- **Website announcements:** authorized administrators create and publish announcements manually. No scheduled or recurring announcements. Respect announcement notification preferences.
- **Account/security:** mandatory notifications for these reliably detectable events: user account deactivation and reactivation; administrator account authorization and deactivation; administrator role changes; and administrator session termination. Do not promise Google-side security notifications the platform cannot reliably detect.

### 11.5 Delivery safety and cleanup

- Handle push delivery failures, expired subscriptions, duplicate event triggers, and invalid notification records.
- Use bounded operations and short-lived maintenance only where required.
- Keep delivery status and error details useful.
- Do not introduce a persistent queue, uncontrolled retries, duplicate user notifications, or automatic email fallback.

### 11.6 Admin notifications

- Use in-app delivery as the default and only initial admin notification channel.
- Do not implement admin email or browser-push delivery in the initial version unless a separate approved decision changes scope.
- Ensure sensitive notifications are visible only to authorized roles.
- Critical system alerts must be visible to Super Admin.
- Admin notification center supports unread count, history, categories, filters, mark-read/unread, details, and deep links.

---

## 12. Security

### 12.1 Authorization

- Server-side authorization is the security authority for every protected page, Server Action, REST endpoint, and domain service.
- Check effective permissions on every protected operation. Hiding a button or menu item is not sufficient.
- Return appropriate unauthorized or forbidden responses.
- REST authorization must match Server Action authorization.
- Public content availability must be enforced server-side, including against guessed URLs and direct API calls.

### 12.2 Authentication and accounts

- Better Auth with PostgreSQL and secure session management.
- Google OAuth is the only provider. No custom password authentication, email/password registration, or additional OAuth providers.
- Use secure cookie settings in production, appropriate trusted origins, and safe session handling.
- The first Super Admin bootstrap uses an environment-configured authorized Google email. No public setup wizard or arbitrary elevation endpoint.
- Deactivated users cannot access authenticated features; their historical data is retained.
- Do not implement self-service account deletion.

### 12.3 Administrator security

- Configurable administrator inactivity timeout and maximum session lifetime, enforced server-side.
- Super Admin can inspect and terminate administrator sessions and force reauthentication.
- Record successful and failed administrator logins, repeated failures, and suspicious patterns without storing credentials.
- Configurable temporary restrictions for repeated failures.
- Dashboard alerts for Super Admin.
- Revoke sessions after Google security changes only when reliably detectable; do not promise real-time Google security notifications.
- Public users cannot register as administrators.
- Protect against removal of the last effective Super Admin.

### 12.4 Rate limiting

- Implement PostgreSQL-backed rate limiting for authentication-related endpoints, report submission, reviews, sensitive admin operations, and other abuse-prone endpoints.
- Use appropriate limits by identity and request context.
- Do not use Redis.
- Rate-limit failures must not accidentally allow unrestricted requests.

### 12.5 Input validation and output safety

- Validate all untrusted input on the server with Zod and domain validation, even when client-side validation exists.
- Prevent XSS, SQL injection, unsafe redirects, path traversal, and mass-assignment vulnerabilities.
- Use Drizzle parameterization and safe React rendering patterns.
- Validate image uploads, subtitle URLs, video URLs, attachments, and CSV imports.
- Enforce safe file access and filename handling.

### 12.6 HTTP security

- Configure secure HTTP headers, including an appropriate Content Security Policy, frame protections, content-type protections, and referrer policy.
- Policies must remain compatible with Google OAuth, Vidstack, approved external MP4 hosts, and browser push.
- Do not weaken security headers globally to solve one external integration problem.
- CSP media permissions must be limited to required sources; no unrestricted wildcards.

### 12.7 API and secrets

- Document REST endpoints with OpenAPI/Swagger, including authentication requirements, permissions, validation schemas, response structures, and error cases.
- Ensure REST and Server Action authorization rules match.
- Keep secrets in server environment configuration. Never expose server-only secrets through public environment variables.
- Redact passwords, OAuth tokens, cookies, session secrets, sensitive query parameters, and credentials from logs.
- Configuration JSON export must exclude secrets, OAuth credentials, session secrets, and other sensitive values.

### 12.8 Database security

- PostgreSQL is accessible only through the application server's local or private connection; never expose it directly to the public internet.
- In production, configure local-only access, separate database users where appropriate, conservative connection limits, and safe authentication.
- Use a dedicated persistent SSD data directory.
- Configure systemd restart limits, connection timeouts, and appropriate logging.
- Use a conservative connection pool with explicit limits, timeouts, and safe reconnection behavior.

### 12.9 Backup and recovery security

- Backups must have a manifest with timestamps, database information, file size, and checksum.
- Validate backup integrity automatically after creation; record results and alert Super Admin on failure.
- Protect the newest valid backup and the last known-good backup.
- Validate a selected backup before restore; require explicit confirmation for destructive restoration; verify the restored database afterward.
- Document the accepted risk that same-server backups may be destroyed with the server.
- Do not implement external backup copies, WAL archiving, point-in-time recovery, or incremental backups in the initial version.

---

## 13. Maintenance and Operations

### 13.1 Maintenance command framework

- Provide a common framework for short-lived systemd-triggered maintenance commands: structured logs, safe configuration loading, execution results, error handling, and exit codes.
- Support backup, validation, retention cleanup, and approved low-frequency aggregation tasks.
- Do not create persistent workers, a job queue, a general-purpose task scheduler, or a separate worker service.

### 13.2 Task monitoring and history

- Record task name, start/end time, duration, success/failure, and safe error information for short-lived scheduled maintenance commands.
- Do not implement worker heartbeats, queue monitoring, queue wait times, or persistent worker dashboards.
- Maintain execution history for failed, retried, recovered, and critical maintenance operations.
- Keep successful routine records lightweight.
- Use configurable retention and redact secrets; prevent unbounded growth.

### 13.3 Task dependencies and controls

- Approved dependencies:
  - Backup before backup validation.
  - Backup validation before retention cleanup.
  - Image upload before validating image metadata and activating the asset.
  - Direct MP4 URL entry before browser preview, administrator confirmation, and manual publication.
- Do not create a scheduled content-release pipeline.
- Ensure dependent operations do not run against invalid or incomplete data.
- Provide Super Admin controls appropriate to short-lived maintenance execution, including emergency pause/resume where meaningful.
- Do not introduce queue priorities, worker concurrency management, queue dashboards, or advanced worker scaling. Concurrency controls may only address actual short-lived maintenance execution and prevent conflicting operations.

### 13.4 Maintenance mode

- Manual, Super Admin-controlled maintenance mode.
- Configurable public maintenance page and message, with an optional estimated return time.
- Authorized administrators retain access to the admin interface.
- Do not implement maintenance scheduling or recurring maintenance publication.

### 13.5 Health checks

- Layered health checks for application availability, PostgreSQL connectivity, disk availability, and other essential runtime dependencies.
- Keep public health responses minimal and avoid exposing internal infrastructure details.
- Provide more detailed diagnostics to authorized administrators.

### 13.6 Alerts and incidents

- Alert severities: Critical, High, Medium, Low.
- Sensible default thresholds configurable by Super Admin.
- Support severity escalation/de-escalation, duplicate suppression, and role-aware visibility.
- Avoid repeated identical alerts for one continuing incident.
- Automatic escalation based on severity, duration, and impact; allow authorized manual override.
- De-escalate only after verified recovery or explicitly authorized correction. Do not escalate solely because a user has not opened the dashboard.
- Allow authorized administrators to acknowledge alerts, assign an administrator, add internal notes, and inspect acknowledgement timestamps and deadlines.
- Support escalation when an important alert remains unacknowledged beyond its configured deadline. Preserve complete alert history.
- Basic incident records for important issues involving video-source playback failures, database backup/recovery, system health, and performance.
- Incidents support severity, status, ownership for High/Critical incidents, affected component, timeline, and corrective-action tracking. Do not build a complex IT service management platform.
- Support structured notes for all incidents and internal discussion for High/Critical incidents. Keep notes private to authorized administrators, with author and timestamp. Do not expose internal discussions to ordinary users.
- Allow attachments only for High/Critical incidents. Validate file types, sizes, permissions, and malware-safety requirements. Reject executables and arbitrary dangerous content. Restrict access to authorized administrators.
- Provide a unified timeline for High/Critical incidents showing alert creation, escalation, acknowledgement, assignment, notes, status changes, and verified recovery. Lower-severity incidents may use separate histories. Keep timelines accurate and append-only where appropriate.
- Allow incidents to be resolved automatically only when recovery is verified through the relevant health check or operational result. Otherwise require an authorized administrator to confirm resolution. Preserve history and corrective-action notes after resolution.

### 13.7 Backups and disaster recovery

- Weekly full PostgreSQL backup stored on the same server, using standard compression and timestamped filenames.
- Do not implement WAL archiving, point-in-time recovery, incremental backups, or automatic external backup copies. Document the accepted risk of complete server/storage failure.
- Create a metadata manifest for each backup with relevant timestamps, database information, file size, and checksum.
- Validate backup integrity automatically after creation; record validation results and alert Super Admin on failure.
- Four-week backup retention. Cleanup must protect the newest valid backup and must not delete the last known-good backup when a newer backup fails validation.
- Use a short-lived maintenance command for retention cleanup; log deleted files and failures.
- Provide Super Admin with the ability to download an authorized backup and initiate or perform a controlled restore through the approved admin/terminal workflow.
- Document and support manual backup, download, and restore of the persistent image asset directory. Ensure database records and stored image paths remain consistent after restoration. Do not introduce external object storage or automatic external backup copies.
- Document the essential recovery sequence for PostgreSQL, image assets, application deployment, and direct video-source records.
- Include the limitations of same-server backups and the need to restore image files separately.
- Do not implement elaborate disaster-recovery orchestration, automated cross-region replication, or mandatory restore rehearsals in the initial version.

### 13.8 Disk and capacity monitoring

- Monitor PostgreSQL storage, image storage, backup storage, logs, and overall disk usage.
- Provide configurable warning and critical thresholds.
- Do not include video staging or video-storage capacity; the platform does not store video binaries.
- Provide capacity recommendations but do not automatically resize the server or disk.

---

## 14. Production and Deployment

### 14.1 Environment

- Production target: Ubuntu 24.04 LTS.
- Application server: Next.js application, Nginx reverse proxy, systemd process management, and PostgreSQL on the same server.
- Keep secrets in server environment configuration.
- Disable unnecessary services.
- The database must not be publicly exposed.

### 14.2 Nginx

- Configure Nginx as the reverse proxy for the Next.js application.
- Set appropriate proxy headers, body limits for image uploads, timeouts, compression, and static asset handling.
- Use hosting-provider-managed SSL as the initial approach.
- Do not proxy external video media through Nginx or the application server.

### 14.3 systemd

- Create systemd service configuration for the Next.js application.
- Define the application user, working directory, environment configuration, restart behavior, startup dependencies, and safe service limits.
- Use systemd for the application and approved short-lived maintenance commands only.
- Do not create persistent worker services.

### 14.4 PostgreSQL production

- Local-only access, separate database users where appropriate, conservative connection limits, and safe authentication.
- Dedicated persistent SSD data directory.
- Configure systemd restart limits, connection timeouts, and appropriate logging.
- Enable `pg_stat_statements`, appropriate autovacuum settings, and safe database maintenance checks.
- Monitor slow queries, connection use, table growth, and index health.
- Use index recommendations for review and approval rather than automatic schema changes.

### 14.5 Caching and compression

- Implement hybrid HTTP compression using Brotli and Gzip where supported.
- Configure Next.js built-in caching and PostgreSQL-backed data access without Redis.
- Use tag-based cache invalidation for content changes.
- Do not cache private user data or unpublished content in a way that could leak between users.

### 14.6 CI/CD and release safety

- GitHub Actions runs installation, type checking, linting, unit tests, relevant integration tests, and production build validation.
- Use deterministic dependency installation and lockfile validation.
- Build production artifacts in CI rather than consuming production VPS memory for builds.
- Production deployment requires manual approval; do not implement blind automatic deployment.
- Use versioned releases and a controlled in-place deployment process with rollback capability.
- Implement versioned release rollback for application code.
- Define how migrations remain compatible with the previous application release.
- Use expand-contract migration practices and prevent rollback from silently destroying newer database data.
- Document which migrations are reversible and which require a forward fix.
- Never rely on automatic schema synchronization in production.

### 14.7 Final audit

- Audit the complete platform against this specification: authentication, RBAC, content hierarchy, publication rules, source URL validation, browser playback, source replacement, progress reset, watch history, ratings, moderation, notifications, analytics, CSV operations, backups, and production behavior.
- Check memory usage, database connections, slow queries, image delivery, and application startup.
- Verify that no excluded infrastructure or obsolete Odysee/LBRY/video-upload code remains.
- Fix issues found and document remaining limitations honestly.
- Perform a final review of the repository and all project documentation. Confirm that every implemented feature matches its approved behavior and that every deferred feature remains outside the initial implementation.
- Verify the production deployment procedure, environment variables, database migrations, backups, restore instructions, Nginx, systemd, monitoring, security controls, and rollback process.
- Produce a final implementation report containing: completed features, partially completed features, known limitations, security considerations, production deployment instructions, backup and recovery instructions, future upgrade backlog, and any unresolved issues requiring the user's decision.
- Do not claim production readiness if critical tests, security controls, or recovery procedures are incomplete.

---

## 15. Non-Functional Requirements

### 15.1 Architecture and code quality

- Strict TypeScript; no unrestricted `any`, unsafe type assertions, or ignored type errors.
- Keep domain logic separate from UI components.
- Server-side authorization is the security authority.
- Validate all untrusted input on the server.
- Use database transactions for critical multi-record operations.
- Use explicit error handling.
- Avoid duplicated business logic.
- Avoid oversized components and unnecessarily complex abstractions.
- Use indexes appropriate to real query patterns.
- Preserve existing data and relationships during migrations.
- Never silently discard user data.
- Do not use mock data in production functionality.
- Do not mark a feature complete merely because its UI renders.
- Maintain a lightweight modular monolith; no excluded infrastructure.
- Use a modular directory structure separating App Router routes, public pages, admin pages, UI components, domain modules, database access, shared utilities, validation, API handlers, and tests. Avoid placing business logic inside route components or Server Actions.
- Establish explicit server-only/client boundaries. Prevent database clients, secrets, privileged services, and authorization logic from entering browser bundles; use server-only markers where appropriate, and pass Client Components only the data they require.
- Configure ESLint and Prettier for TypeScript, React, Next.js, and project conventions, with lint/format scripts and rules against unused imports, unsafe patterns, inconsistent formatting, and common React mistakes.

### 15.2 Performance and resource use

- Keep the production architecture resource-efficient and suitable for a low-RAM server.
- Use server-side pagination for large datasets; never load entire user, review, or content collections into browser memory.
- Use bounded queries, appropriate indexes, and efficient list queries.
- Avoid expensive full-catalog queries.
- Avoid writing to PostgreSQL on every playback second.
- Avoid excessive polling and long-running connections.
- Use conservative database connection limits, timeouts, and safe reconnection.
- Use caching and compression without leaking private or unpublished data.
- Keep maintenance and analytics work bounded and non-blocking to normal viewing.

### 15.3 Reliability and data integrity

- Use transactions for critical multi-record changes, including conversions, moves, source replacement, publication, and deletion cleanup.
- Handle failures explicitly and return safe user-facing errors.
- Preserve stable IDs and relationships across edits, reordering, moves, and conversions.
- Preserve watch history dates across progress resets and source replacement.
- Protect the last known-good backup.
- Provide health checks, maintenance mode, and operational alerting as specified.

### 15.4 UI, responsiveness, and accessibility

- Dark-only interface; do not implement a light-theme switching system.
- Cinematic, modern public design; separate admin workspace.
- Consistent global visual foundation: container widths, page spacing, typography hierarchy, surface colors, focus states, and responsive behavior.
- Reusable, accessible UI components with consistent variants for buttons, inputs, dialogs, dropdowns, tabs, tables, cards, tooltips, and notifications. Install only the shadcn/ui components needed by the initial application.
- Responsive desktop and mobile layouts.
- Navigation must not overlap the player, dialogs, or mobile safe areas.
- Player controls must have clear labels, adequate touch targets, keyboard accessibility where supported, and readable error messages.
- Do not introduce a separate site-wide keyboard-navigation feature; implement only the accessibility necessary for the player and controls.

### 15.5 Time and locale

- Store timestamps consistently in UTC.
- Use Asia/Dhaka for analytics display and date-range interpretation.
- Content may be international; no general UI localization or multi-language interface requirement is specified in the initial pack.

### 15.6 Testing and CI

- Vitest for unit and integration tests; Playwright for browser-based end-to-end tests.
- Establish test fixtures, test database setup, cleanup, mocks, and environment isolation.
- Tests must not accidentally modify production data.
- CI runs installation, type checking, linting, unit tests, relevant integration tests, and production build validation.
- Production deployment requires manual approval.

### 15.7 Logging and error handling

- Pino structured JSON logs with timestamps, severity, request/correlation identifiers, module context, and safe error information.
- Redact passwords, OAuth tokens, cookies, session secrets, sensitive query parameters, and credentials.
- Logs are suitable for journald collection in production.
- Use typed application errors for validation, authentication, authorization, missing resources, conflicts, rate limits, and unexpected server failures.
- Return safe user-facing messages without exposing SQL, credentials, internal stack traces, or sensitive implementation details.

### 15.8 Documentation and progress tracking

Maintain:

- `PROJECT_STATUS.md` — overall progress.
- `ARCHITECTURE.md` — implemented architecture and important design decisions.
- `DATABASE.md` — schema and relationships.
- `API.md` — REST API documentation and conventions.
- `SECURITY.md` — security decisions and known limitations.
- `CHANGELOG.md` — significant implementation changes.
- `DECISIONS.md` — finalized decisions and approved changes.

Progress tracking records prompt number, implementation status, changed files, tests, and unresolved issues. Documentation must prevent future developers or agents from repeating or contradicting completed work.

### 15.9 API conventions

- Hybrid Server Actions and REST.
- Document REST endpoints with OpenAPI/Swagger, including authentication requirements, permissions, validation schemas, response structures, and error cases.
- REST authorization must match Server Action authorization.
- Use consistent response and error conventions established during the architecture/documentation phases.

---

## 16. Initial Scope, Future Upgrades, and Hard Exclusions

### 16.1 Mandatory initial scope

All requirements in §3–§15 are mandatory initial scope unless explicitly marked as a future upgrade. §3–§15 define the required behavior; this section defines the scope boundary.

**Architecture baseline.** The initial release is a single-deployable, low-RAM modular monolith:

- One Next.js App Router application (TypeScript) serving public pages, admin pages, Server Actions, and the approved REST endpoints.
- One PostgreSQL database accessed through Drizzle ORM with a conservative connection pool.
- React Server Components for page reads; Server Actions for mutations; REST only for the documented allowlist.
- PostgreSQL full-text and trigram search; PostgreSQL-backed rate limiting and caching.
- Nginx reverse proxy, systemd process management, and short-lived systemd-triggered maintenance commands.
- No Redis, separate worker service, job queue, Docker, external object storage, CDN, video upload/transcoding/proxying, server-side image optimization, email infrastructure, SSE/WebSockets, external monitoring service, or scheduled publishing.

**Approved product features.** The following are mandatory initial scope:

**Content model and catalog**

- Three content structures: season-based drama, flat drama, standalone movie.
- Dramas, seasons, episodes, and standalone movies with stable IDs and canonical URLs (`/drama/{stableId}/{slug}`, `/movie/{stableId}/{slug}`, `/drama/{dramaId}/{slug}/episode/{episodeId}`).
- Episode numbering, ordering, moving between seasons, and conversion between season-based and flat structures.
- Content metadata, categories, platforms, similar dramas, publication states (draft/published/unpublished), Trash, restore, and permanent deletion.
- Content-level ratings and reviews for dramas and standalone movies; episodes excluded.

**Video source and playback**

- Administrator-supplied public direct HTTPS MP4 URLs; syntax and scheme validation.
- Browser-based playback preview and actual-playback verification before publication.
- Vidstack playback directly from the external host; no backend proxy.
- CSP media permissions scoped to approved sources.
- Manual source replacement after successful preview and explicit confirmation; progress reset for the affected episode with watch-history records and dates preserved.
- Broken-source handling and subtitles for episodes and standalone movies.
- No video upload, staging, transcoding, processing, proxying, relaying, or rehosting.

**Public website**

- Homepage and discovery: trending, popular, recently added, highest rated, categories, and platforms.
- Search with autocomplete and poster thumbnails; full-text and trigram search.
- Drama, movie, and episode details/watch pages.
- Canonical URLs, slug redirects, SEO metadata, Open Graph metadata, and sitemaps.
- Legal and information pages, and sharing.

**User features**

- Google-only authentication through Better Auth; private profile.
- Bookmarks and My List.
- Playback progress, watched state, Continue Watching, and cross-device synchronization.
- Watch history for dramas, episodes, and standalone movies (content-level movie entries).
- Content-level ratings, reviews, and Enjoying reactions for dramas and movies; review sorting, reporting, and moderation.
- Authenticated content reports.

**Administration and moderation**

- Admin shell, dashboard, role-aware navigation, and RBAC with Super Admin, Content Manager, Moderator, Analyst, and custom roles.
- Content administration: CRUD, seasons, episodes, numbering, reordering, moving, conversion, publication, bulk operations, similar dramas, Trash, images, and source replacement.
- User, content, report, category, platform, legal-page, SEO, sitemap, and CSV administration.
- Image management; system configuration and version history; maintenance mode.
- Admin accounts, sessions, login monitoring, and account/security notifications.
- Moderation: content reports, review reports, review removal, and authorized user deactivation.
- CSV export/import with dry-run preview and confirmed apply.

**Analytics**

- Privacy-conscious guest sessions and content-level view counting with the six-hour deduplication window.
- Episode playback analytics without per-second writes.
- Bounded aggregation, admin analytics dashboard, date filters, operational metrics, anomaly detection, and resource monitoring.
- Analytics covers dramas and standalone movies.

**Notifications**

- Five event preferences, in-app notification center, browser push, announcements, and delivery safety/cleanup.
- Mandatory account/security notifications for user deactivation/reactivation, administrator authorization/deactivation, administrator role changes, and administrator session termination.
- Admin notifications are in-app only in the initial version.

**Security**

- Server-side authorization for every protected page, Server Action, REST endpoint, and domain service.
- Google OAuth, secure sessions and cookies, admin session timeouts, forced reauthentication, and last-Super-Admin protection.
- PostgreSQL-backed rate limiting; input validation with Zod; output safety; CSP and security headers.
- OpenAPI/Swagger documentation; database hardening; backup and recovery security.

**Maintenance and operations**

- Short-lived systemd maintenance command framework with structured logs, task monitoring/history, dependencies, controls, and exit codes.
- Backup, validation, retention cleanup, and restore with integrity checks and explicit confirmation.
- Health checks, maintenance mode, alerts/incidents, and disk/capacity monitoring.
- No persistent workers, queue, scheduler, or worker dashboards.

**Production and delivery**

- Nginx, systemd, PostgreSQL production configuration, caching/compression, and GitHub Actions CI/CD.
- Manual approval, versioned releases, rollback, and expand-contract migrations.
- Final audit and implementation report.

**Non-functional requirements**

- Strict TypeScript; modular monolith boundaries; server-side pagination; bounded queries and indexes.
- Reliability, data integrity, dark-only responsive accessible UI, UTC timestamps, Vitest/Playwright testing, Pino logging, API conventions, and progress documentation.

### 16.2 Future upgrade backlog (not initial)

The following are explicitly future work. They are not unfinished initial requirements and must not be implemented without separate design and explicit approval. The initial release is complete without them.

**Infrastructure and scalability**

- Separate frontend and backend services (for example, Next.js frontend plus NestJS backend).
- Dedicated persistent background workers and a separate worker service.
- Job queues and queue-based orchestration (for example, pg-boss or a broker).
- Redis for distributed caching, rate limiting, sessions, or pub/sub.
- PgBouncer or another external connection pooler.
- External object storage and CDN integration for assets and media.
- Horizontal scaling, multi-instance deployment, Docker or Docker Compose, containerization, container orchestration, and multi-region architecture.
- Advanced monitoring with Prometheus and Grafana; Sentry or equivalent external error monitoring.
- External log aggregation, distributed tracing, and advanced alerting.
- Advanced disaster recovery, off-server backup replication, WAL archiving, point-in-time recovery, and isolated periodic restore testing.
- Managed search services or a dedicated search cluster.
- External secret manager.
- WebSockets, SSE, real-time event streaming, or a message broker.

**Video infrastructure**

- Multiple external video-hosting provider integrations.
- HLS/DASH streaming and adaptive bitrate.
- Signed or private media URLs and advanced access control or DRM.
- Video processing, transcoding, packaging, and thumbnails.
- Video migration, upload, staging, and retry tools.
- Video proxying, relaying, or rehosting.
- Advanced media delivery and access-control systems.
- Server-side image optimization, including Sharp or Next.js image optimization.

**Product features**

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

**Operational and product enhancements**

- Scheduled content publishing, recurring episode-release schedules, and scheduled announcements.
- Complex job orchestration and workflow engines.
- Advanced hero scheduling.
- Additional SEO and discovery features beyond the initial specification.

### 16.3 Hard exclusions (must not be implemented)

The initial release must not implement any item in §16.2. The items below are permanent product or technical exclusions, not future backlog candidates. Overturning one requires a new recorded decision.

- Odysee or LBRY APIs, SDKs, authentication, claim IDs, or upload workflows.
- Custom password authentication.
- Fabricated cast, duration, release year, or other unsupplied metadata.
- Lowest Rated page.
- Arbitrary minimum rating-count threshold.
- Category images/icons or platform logos/icons.
- Release-year metadata.
- Complex hero scheduling engine.

### 16.4 Scope enforcement

- The initial implementation scope is §16.1. A feature is in the initial release only if §3–§15 requires it or §16.1 lists it.
- §16.2 is the future upgrade backlog. Future upgrades must be separately designed and explicitly approved before implementation.
- Do not implement a future upgrade merely because it is common or convenient.
- Do not treat a future upgrade as an incomplete initial requirement. The initial release is complete without §16.2 items.
- Do not introduce any §16.2 item into the initial release, even as a temporary or optional dependency.
- §16.3 items are permanent exclusions. If a requested change requires one, stop and explain the conflict before proceeding.
- Any approved scope change updates §16, `DECISIONS.md`, `PROJECT_STATUS.md`, and `CHANGELOG.md` in the same change.

---

## 17. Resolved Product Decisions

The following decisions were approved by the user on 2026-11-08. They resolve the internal inconsistencies in the Detailed Pack and are recorded in `DECISIONS.md`.

| ID    | Issue                                  | Approved resolution                                                                                                                                                                                                             | Impact                                                                                                                      |
| ----- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| OD-01 | Movie ratings and reviews              | Content-level ratings and reviews apply to dramas and standalone movies; episodes are excluded. Movie details pages expose rating and review features.                                                                          | Ratings/reviews link to a content item (drama or movie). Highest Rated includes both. CSV export and moderation cover both. |
| OD-02 | Movie view counting                    | Content-level view counting applies to dramas and standalone movies using the same one-view-per-visitor-per-content-item-per-rolling-six-hour rule.                                                                             | Analytics records the content item type; movie details pages display view counts.                                           |
| OD-03 | Content report authentication          | Content reports require authentication.                                                                                                                                                                                         | The report form is available to authenticated users; rate limiting still applies.                                           |
| OD-04 | Movie subtitles                        | Subtitle tracks are supported for episodes and standalone movies.                                                                                                                                                               | Subtitle metadata attaches to playable content (episode or movie); the admin movie form supports tracks.                    |
| OD-05 | Account/security notification triggers | Initial mandatory triggers: user account deactivation/reactivation; administrator account authorization/deactivation; administrator role changes; administrator session termination. No promise of Google-side security events. | The notification event model includes these mandatory triggers; they cannot be disabled through ordinary preferences.       |
| OD-06 | Movie watch history                    | Standalone movies are included in Watch History as content-level entries.                                                                                                                                                       | Watch-history records support dramas, movies, and episodes; last-watched date and cross-device sync apply.                  |
| OD-07 | Movie canonical URL                    | `/movie/{stableId}/{slug}` using the stable movie ID and current slug; slug changes redirect to the canonical URL.                                                                                                              | Routing, metadata, sitemap, and redirects use the movie pattern.                                                            |

### 17.1 Configuration values not fixed by the pack

These are implementation settings, not unresolved product features. They must be documented with safe defaults and validated through System Configuration:

- Playback completion threshold.
- Trash retention (default 30 days).
- Administrator inactivity timeout and maximum session lifetime.
- Rate-limit thresholds for authentication, reports, reviews, and sensitive admin operations.
- Analytics/guest-session retention period (must be limited).
- Alert severity thresholds and acknowledgement deadlines.
- Backup retention is fixed at four weeks by the Detailed Pack.
- Operational dashboard refresh interval (must be sensible and non-aggressive).
- Hero rotation interval, if rotation is enabled.

---

## 18. Traceability to the Detailed Pack

| Phase / prompts    | Primary requirement sections |
| ------------------ | ---------------------------- |
| Phase 0 (001–005)  | §1, §2, §16, §17             |
| Phase 1 (006–018)  | §2, §15                      |
| Phase 2 (019–029)  | §4, §7, §10, §11             |
| Phase 3 (030–041)  | §3, §12                      |
| Phase 4 (042–052)  | §6, §8                       |
| Phase 5 (053–074)  | §4, §8                       |
| Phase 6 (075–090)  | §5, §8                       |
| Phase 7 (091–103)  | §5, §6, §7                   |
| Phase 8 (104–114)  | §7                           |
| Phase 9 (115–120)  | §7, §9                       |
| Phase 10 (121–138) | §6                           |
| Phase 11 (139–154) | §10, §11                     |
| Phase 12 (155–174) | §6, §8, §9                   |
| Phase 13 (175–218) | §10, §12, §13, §14           |
| Prompts 219–220    | §14, §15, §18                |

---

## 19. Acceptance Criteria for This Document

This requirements document is accepted when:

1. It accurately represents the approved initial product scope.
2. It does not contradict the finalized decisions in the Detailed Pack.
3. Every hard exclusion is clearly marked and not presented as a requirement.
4. Future upgrades are separated from initial scope.
5. Product decisions in §17 are approved and recorded in `DECISIONS.md`.
6. Architecture, database, API, and UI work can proceed without guessing about product behavior.

---

## 20. Glossary

| Term                  | Meaning                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Content item          | A drama or standalone movie.                                                                                      |
| Season-based drama    | A drama whose episodes are grouped into seasons.                                                                  |
| Flat drama            | A drama whose episodes belong directly to the drama without seasons.                                              |
| Standalone movie      | An independent single-video content type with no seasons or episodes.                                             |
| Episode               | A playable unit within a drama, optionally within a season.                                                       |
| Publication state     | Whether content is draft, published, unpublished, or trashed.                                                     |
| Trash                 | Soft-deleted content retained for restoration until permanent deletion or retention expiry.                       |
| Source replacement    | An explicit, preview-verified replacement of an episode's direct video URL that resets progress for that episode. |
| Completion threshold  | The configurable percentage/point at which an episode is considered watched.                                      |
| Continue Watching     | A personalized list of unfinished content with resume actions.                                                    |
| Watch history         | A historical record of recently watched dramas and episodes, separate from Continue Watching.                     |
| Effective permissions | The union of permissions from all roles assigned to an administrator.                                             |
| Maintenance command   | A short-lived systemd-triggered operational task, not a persistent worker or queue job.                           |
| Hard exclusion        | A capability that must not be implemented in the initial release.                                                 |
| Future upgrade        | A capability deferred beyond the initial release and requiring separate approval.                                 |
