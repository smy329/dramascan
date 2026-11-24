# API

**Project:** DramaScan — International Drama & Movie Streaming Platform
**Document:** REST and Server Action contracts
**Version:** 1.0
**Date:** 2026-11-08
**Status:** Conventions established by Prompt 004. No endpoints are implemented yet.

**Authority chain:** `AGENTS.md` → `REQUIREMENTS.md` → `DECISIONS.md` → `ARCHITECTURE.md` → `CONVENTIONS.md` → this document.

`CONVENTIONS.md` §6–§8 defines the response, error, and logging conventions. This document is the human-readable contract for endpoints and application operations. The OpenAPI document is the machine-readable contract.

---

## 1. Status

| Item             | Status                       |
| ---------------- | ---------------------------- |
| REST endpoints   | Implemented (see §3)         |
| Server Actions   | Implemented (workflow-backed)|
| OpenAPI document | Not generated                |
| Swagger UI       | Not configured               |
| Authentication   | Integrated (Better Auth)     |

Do not describe planned endpoints as available.

---

## 2. General Conventions

### 2.1 Base path and format

- Internal REST endpoints live under `/api`.
- JSON only: `Content-Type: application/json; charset=utf-8`.
- JSON fields are camelCase; database columns are snake_case and mapped in DTOs.
- IDs are strings (UUIDv7 for application entities).
- Timestamps are ISO 8601 UTC strings with milliseconds.
- Enum values are lowercase snake_case strings.
- Use `null` for explicit absence.
- Initial endpoints are not versioned. A future external API is introduced under `/api/v1` with a recorded decision.

### 2.2 Success responses

Single resource:

```json
{ "data": { "id": "0198f3a2-...", "title": "Example" } }
```

Collection:

```json
{
  "data": [ ... ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 123,
    "totalPages": 7,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

- `201 Created` returns the created resource in `data`.
- `204 No Content` returns an empty body.
- No `success` field.

### 2.3 Errors

```json
{
  "error": {
    "code": "validation_error",
    "message": "The request contains invalid fields.",
    "fieldErrors": { "title": ["Title is required."] },
    "requestId": "01J..."
  }
}
```

Stable codes: `validation_error`, `authentication_required`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `internal_error`, plus documented domain codes.

HTTP status: `200`, `201`, `204`, `400`, `401`, `403`, `404`, `409`, `429`, `500`.

- Public unavailable content returns `404`, not `403`.
- Ownership violations on private resources return `404` where `403` would leak existence.
- Permission failures on known admin resources return `403`.
- Never expose SQL, stack traces, internal paths, credentials, or raw provider errors.

### 2.4 Pagination, sorting, and filtering

- `page` (1-based, default 1), `pageSize` (default 20, maximum 100).
- `sort` is a comma-separated allowlist of API fields; `-` means descending: `?sort=-publishedAt,title`.
- Multi-value filters use repeated parameters: `?category=action&category=romance`.
- Free text uses `q`.
- Date ranges use `from`/`to`; analytics interprets them in Asia/Dhaka.
- All parameters are validated with Zod. No arbitrary column names or SQL fragments.

### 2.5 Authentication and authorization

- REST uses the same session cookie as the application.
- Every protected endpoint documents its required permission key.
- REST authorization matches the equivalent Server Action and service authorization.
- Deactivated accounts are rejected before the operation runs.
- Public content visibility is enforced server-side, including for guessed URLs and direct API calls.

### 2.6 CSRF, caching, and rate limiting

- Cookies are `HttpOnly`, `Secure` in production, `SameSite=Lax`.
- Server Actions use Next.js origin protections; REST mutations additionally validate same-origin `Origin`/`Sec-Fetch-Site`.
- Public GETs may use short shared cache lifetimes with tag invalidation. Private/admin responses use `no-store`.
- Rate-limited endpoints return `429` with `Retry-After`. Rate limiting is PostgreSQL-backed, not Redis.

### 2.7 Server Action results

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        fieldErrors?: Record<string, string[]>;
        requestId?: string;
      };
    };
```

Server Actions never throw raw errors across the boundary. They use the same error codes and safe messages as REST.

---

## 3. REST Endpoint Catalog

Status values: **Planned**, **Implemented**, **Deprecated**.

### 3.1 Authentication

| Method     | Path                 | Auth   | Permission | Purpose                                                   | Status  |
| ---------- | -------------------- | ------ | ---------- | --------------------------------------------------------- | ------- |
| `GET/POST` | `/api/auth/[...all]` | Public | —          | Better Auth handler: sign-in, callback, session, sign-out | Planned |

### 3.2 Public reads

| Method | Path                      | Auth   | Permission | Purpose                                                              | Status  |
| ------ | ------------------------- | ------ | ---------- | -------------------------------------------------------------------- | ------- |
| `GET`  | `/api/search/suggestions` | Public | —          | Live autocomplete with poster thumbnails, recent/popular suggestions | Implemented |

The suggestion endpoint answers the search box only; the results page is a
Server Component route. It matches content titles, category names, and
platform names with PostgreSQL full-text search and trigram similarity, and it
never returns an item that the public may not open. The endpoint is a `GET`,
so it needs no same-origin check and no CSRF token.

Public page data is rendered by Server Components through module query services, not REST. Do not add REST endpoints for ordinary page reads.

The public detail and watch pages are Server Component routes, not REST
endpoints:

| Route                                                       | Availability rule                                                          | Notes                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `/drama/{dramaId}/{slug}`                                   | The drama is discoverable and the slug is current                          | An old slug redirects to the canonical URL (D-046)                |
| `/drama/{dramaId}/{slug}/episode/{episodeId}`               | The episode is publicly playable and belongs to the drama                   | An old slug redirects to the canonical episode URL                |
| `/movie/{id}/{slug}`                                        | The movie is published, not in the Trash, and has a source                  | An old slug redirects to the canonical URL (D-046)                |
| `/movie/{id}/{slug}/watch`                                  | The same rule as the movie details page                                     | An old slug redirects to the canonical watch URL                  |

A guessed slug is a 404, and a slug change never reveals the current slug of
an item that is not publicly available.

### 3.3 Analytics beacons

| Method | Path                      | Auth                           | Permission | Purpose                                                                | Status  |
| ------ | ------------------------- | ------------------------------ | ---------- | ---------------------------------------------------------------------- | ------- |
| `POST` | `/api/analytics/view`     | Public (guest session or user) | —          | Record a deduplicated content view for a drama or movie                | Implemented |
| `POST` | `/api/analytics/playback` | Public (guest session or user) | —          | Record bounded playback events (play/pause, seek, completion, exit)    | Implemented |

Beacons are small, idempotent/deduplicated, and bounded. They never write on every playback second.

`POST /api/analytics/view` carries `{ type, contentId }`, where `type` is
`drama` or `movie`. The title is checked against the public availability rules
before the view is counted, so a caller cannot inflate the count of a draft by
posting its id. The response is `{ data: { counted, alreadyCounted } }`. A
view is counted once per visitor per content item in a rolling six-hour window
(D-002, D-058).

`POST /api/analytics/playback` carries exactly one target — `episodeId`
together with `dramaId`, or `movieId` — plus `eventType` (`play_pause`,
`seek`, `completion`, or `exit`), `positionSeconds`, `watchDurationSeconds`,
and `completionThresholdMet`. At most one event of each type is stored per
visitor, per content item, per hour, so the table never becomes a per-second
log (D-060).

Both endpoints are **route handlers** rather than Server Actions for the same
reason the playback progress endpoint is: the browser sends them with
`fetch(..., { keepalive: true })`, and only a route handler may write the
anonymous session cookie (D-057). Both check for a same-origin `Origin` header
before they parse the body, so a cross-site request cannot count views or
playback events for another site.

### 3.4 Playback

| Method | Path                     | Auth          | Permission                              | Purpose                                               | Status  |
| ------ | ------------------------ | ------------- | --------------------------------------- | ----------------------------------------------------- | ------- |
| `POST` | `/api/playback/progress` | Authenticated | Own progress | Persist debounced playback progress and watched state | Implemented |

The endpoint is a **beacon**: the player sends it with
`fetch(..., { keepalive: true })`, so the report survives the page being
closed. It is a REST endpoint rather than a Server Action for that reason
alone — a Server Action cannot promise that its request outlives the document.

The body carries exactly one target — `episodeId` **or** `movieId` — together
with `positionSeconds`, `durationSeconds`, and `watchedAt` (the moment the
browser observed the position). A body that names both targets or neither is
rejected.

For an episode, `sourceVersion` is **required**: it is the
`episodes.video_source_version` counter the episode carried when the player
loaded it. A write whose version is no longer the episode's current version is
ignored and reported as not applied, so a heartbeat that was in flight when an
administrator replaced the source cannot restore the progress the replacement
reset (D-041). The comparison is on a counter, not on a timestamp, so it does
not depend on the server clock or the client clock. A movie report carries no
source version: a standalone movie has no replaceable episode source.

The request is checked for a same-origin `Origin` header before it is parsed.
Progress updates also carry a client timestamp; the server rejects older
updates that would overwrite newer progress.

The rejection is enforced by the database, not by the read that precedes the
write: the write locks the two target rows with `FOR UPDATE` and both upserts
carry the condition `last_watched_at <= excluded.last_watched_at`. An older
observation therefore cannot roll the position, the watched minutes, or the
completion backwards — not even when two reports overlap (D-040).

The target has to be publicly playable: a report that names a draft,
unpublished, source-less, or trashed item is refused, because the viewer could
not have watched it (D-043).

### 3.5 Notifications

| Method | Path                              | Auth          | Permission        | Purpose                                         | Status  |
| ------ | --------------------------------- | ------------- | ----------------- | ----------------------------------------------- | ------- |
| —      | —                                 | Authenticated | Own notifications | The unread count for the notification bell       | Resolved server-side |

The unread count is **not** polled over REST. The public layout resolves the
signed-in viewer on the server and reads the count there, so the bell shows the
right number on the first render and no polling request is made. A REST
unread-count route remains available in the catalog for a future client that
needs it without a page render.

Push subscription management is a Server Action, not REST. The push opt-in is a
client island that requests the browser permission inside its click handler, so
the permission is never asked for on the first page load (D-063).

### 3.6 Administration

| Method | Path                           | Auth        | Permission        | Purpose                          | Status  |
| ------ | ------------------------------ | ----------- | ----------------- | -------------------------------- | ------- |
| `GET`  | `/api/admin/exports/[dataset]` | Super Admin | `admin.manage` | Download an approved CSV dataset | Planned |
| `GET`  | `/api/admin/backups/[id]`      | Super Admin | `admin.manage` | Download an authorized backup    | Planned |

Admin page reads use Server Components. Admin mutations use Server Actions.

### 3.7 Operations

| Method | Path                  | Auth             | Permission    | Purpose                           | Status  |
| ------ | --------------------- | ---------------- | ------------- | --------------------------------- | ------- |
| `GET`  | `/api/health`         | Public (minimal) | —             | Application and dependency health | Planned |
| `GET`  | `/api/health/details` | Admin            | `admin.manage` | Detailed diagnostics              | Planned |
| `GET`  | `/api/openapi`        | Public           | —             | OpenAPI JSON document             | Planned |
| `GET`  | `/api/docs`           | Public           | —             | Swagger UI                        | Planned |

Public health responses expose only minimal status. Detailed diagnostics are admin-only.

### 3.8 Information-page administration (implemented, Prompt 045)

These endpoints are implemented under `/admin/api/...` and back the configurable
public footer. Every endpoint requires `settings.manage`; authorization is
enforced at the route entrypoint and re-checked inside the content service.
Mutations additionally reject cross-origin requests.

| Method | Path                                  | Auth                   | Permission        | Purpose                                                       | Status     |
| ------ | ------------------------------------- | ---------------------- | ----------------- | ------------------------------------------------------------- | ---------- |
| `GET`  | `/admin/api/information-pages`        | Authenticated admin    | `settings.manage` | Paginated list of non-deleted pages, including drafts          | Implemented |
| `PATCH`| `/admin/api/information-pages/[id]`   | Authenticated admin    | `settings.manage` | Update title, content, publication status, visibility, position | Implemented |
| `PUT`  | `/admin/api/information-pages/reorder`| Authenticated admin    | `settings.manage` | Set display order from an ordered, unique UUID array           | Implemented |

- `GET` accepts `page` (1-based) and `pageSize` (1–100) and returns
  `{ data, meta }` using the standard collection envelope.
- `PATCH` accepts at least one of `title`, `content`, `publicationStatus`
  (`draft` | `published` | `unpublished`), `footerVisible`, or `position`.
  Unknown fields are rejected.
- `PUT` accepts `{ "ids": ["<uuid>", ...] }`. Reordering runs in one transaction;
  if any id is missing or deleted, nothing changes.
- Errors use the standard `{ error: { code, message, fieldErrors?, requestId } }`
  envelope. Unauthenticated requests return `401`; insufficient permissions
  return `403`.
- No admin UI is implemented in Prompt 045. These endpoints are the control
  surface for a future settings screen.

### 3.9 Standalone movie administration (implemented, Prompt 065)

Movies are an independent content type. These endpoints create and edit a
movie's metadata, associations, publication state, and direct HTTPS video
source. Every endpoint requires `movie.manage`; authorization is enforced at the
route entrypoint and re-checked inside the workflow. Mutations reject
cross-origin requests.

| Method | Path                 | Auth                | Permission     | Purpose                                                              | Status      |
| ------ | -------------------- | ------------------- | -------------- | -------------------------------------------------------------------- | ----------- |
| `POST` | `/admin/api/movies`  | Authenticated admin | `movie.manage` | Create a standalone movie with metadata and associations             | Implemented |
| `PUT`  | `/admin/api/movies`  | Authenticated admin | `movie.manage` | Replace a movie's full payload (`{ movieId, ...fields }`)             | Implemented |

- `POST` accepts `title` (required), `slug` (required, lowercase
  alphanumeric/hyphens, unique among non-deleted movies), `description`,
  `poster`, `banner`, `publication_status` (`draft` default | `published` |
  `unpublished`), `video_source` (nullable absolute HTTPS URL), `categories`
  (UUID array), and `platforms` (UUID array). Unknown fields are rejected.
- `PUT` is a full-payload replace. The same fields are required as on create
  (except `movieId`, which identifies the row); omitted images/video become
  `null` and associations are replaced. Changing the slug records the previous
  value in `content_slug_history`.
- Success returns `{ "data": { ...movie } }` with camelCase fields:
  `id`, `title`, `slug`, `description`, `poster`, `banner`,
  `publicationStatus`, `videoSource`, `createdAt`, `updatedAt`.
- A duplicate active slug returns `409 conflict`. Unknown category/platform ids
  return `400 validation_error` with field errors. A missing or soft-deleted
  movie returns `404`.
- The video source is stored and played by the browser. The server never
  fetches, proxies, transcodes, or rehosts it, so the URL is not hidden from
  viewers and must be a direct HTTPS media URL that supports CORS and byte
  ranges.
- No admin UI is implemented in Prompt 065. These endpoints are the control
  surface for a future movie management screen.

### 3.10 Drama structure conversion (implemented, Prompt 066)

These endpoints move a drama between the season-based and flat episode
structures. Every endpoint requires `drama.manage`; authorization is enforced
at the route entrypoint and re-checked inside the workflow. Mutations reject
cross-origin requests.

| Method | Path                          | Auth                | Permission     | Purpose                                                             | Status      |
| ------ | ----------------------------- | ------------------- | -------------- | ------------------------------------------------------------------- | ----------- |
| `POST` | `/admin/api/dramas/convert`   | Authenticated admin | `drama.manage` | Preview a conversion, or apply a previously previewed one            | Implemented |

The body always carries `mode` (`preview` or `apply`), the target
`targetStructureType` (`flat` or `season_based`), and the optional `strategy`
(`convert` or `restore_snapshot`) and `distribution`.

- `mode: "preview"` returns the planned seasons and episodes, the affected
  counts, any warnings, and a `fingerprint` — a SHA-256 hash of the planned
  structure. It changes nothing.
- `mode: "apply"` requires the `fingerprint` returned by the preview. The
  fingerprint must still match the current structure; a mismatch returns `409
  conflict` and nothing changes. The apply runs in a serializable transaction
  with the drama row locked.
- The apply response is the preview plan shape plus `applied: true`,
  `newFingerprint`, `snapshotId`, and `snapshotStatus`
  (`available` | `restored` | `superseded` | `null`):
  `{ "data": { ...plan, "applied": true, "newFingerprint": "…",
  "snapshotId": "uuid|null", "snapshotStatus": "available|null" } }`.
- Season→flat merges the seasons into one ordered episode sequence and
  renumbers it sequentially. It stores an exact snapshot of the previous
  season structure first, so the conversion can be reversed.
- Flat→season requires the full distribution map: `seasons` (each with a
  `key`, a `title`, and an optional `position`) and `assignments` (each with an
  `episodeId` and a `seasonKey`). Every active episode must be assigned
  exactly once; unknown, duplicate, trashed, and foreign assignments return
  `400 validation_error`. Omitting the distribution synthesizes a single
  Season 1 holding every active episode.
- When an available snapshot exists, the request must state `strategy`:
  `restore_snapshot` restores the previous structure exactly and rejects any
  distribution, `convert` supersedes the snapshot and applies a new
  distribution. Omitting the strategy returns `400`.
- A snapshot can only be restored while the current flat structure still
  matches the fingerprint recorded at conversion time. Any change to the
  active structure — an episode added, trashed, restored, reordered, renumbered,
  or reassigned — returns `409`; the snapshot is kept and the drama is
  unchanged. The rule is fingerprint equality, so a change that returns the
  structure to the recorded fingerprint leaves the snapshot restorable. A
  corrupted stored snapshot payload is a server error (`500`), not a conflict.
- Episode ids, titles, descriptions, publication status, and video sources are
  never rewritten, so per-user viewing records keep pointing at the same
  episodes. Trashed seasons and episodes are ignored and left untouched. An
  episode attached to a non-active season is treated as seasonless: it stays
  in the flat sequence instead of being dropped.
- The drama's `structure_type` is not part of the ordinary drama update. A
  drama update may repeat the stored value; a different value returns `409`
  and points at this endpoint. A missing drama returns `404`.
- Errors use the standard `{ error: { code, message, fieldErrors?, requestId } }`
  envelope. Unauthenticated requests return `401`, insufficient permissions
  return `403`, an invalid request — including a malformed JSON body — returns
  `400`, and a stale fingerprint, an unrestorable snapshot, or a serialization
  conflict returns `409`.
- The admin pages `/admin/dramas` and `/admin/dramas/[id]/convert` use the
  same workflow through Server Actions; they are not separate REST endpoints.

### 3.11 Drama → standalone movie conversion (implemented, Prompt 067)

Converts a drama with exactly one active episode into a standalone movie. The
endpoint requires `drama.manage`; authorization is enforced at the route
entrypoint and re-checked inside the workflow. Mutations reject cross-origin
requests.

| Method | Path                                        | Auth                | Permission     | Purpose                                                       | Status      |
| ------ | ------------------------------------------- | ------------------- | -------------- | ------------------------------------------------------------- | ----------- |
| `POST` | `/admin/api/dramas/convert-to-movie`        | Authenticated admin | `drama.manage` | Preview the resulting movie, or apply a previously previewed one | Implemented |

Body:

```json
{ "dramaId": "uuid", "mode": "preview | apply", "fingerprint": "sha256 hex (apply only)" }
```

The schema is strict; unknown fields are rejected. `mode` is required.

- `mode: "preview"` returns the resulting movie, the source episode, the
  relationship counts, warnings, and a `fingerprint`. It changes nothing.
- `mode: "apply"` requires the preview's `fingerprint`. The apply re-runs every
  eligibility check inside a serializable transaction after locking the drama
  and its active episodes `FOR UPDATE`; a fingerprint mismatch, `23505`, or
  `40001` is a `409 conflict` and nothing changes.
- Eligibility is exactly one active episode. Zero or more than one is a `409`
  naming the actual count. An already converted drama is a `409`; trashed
  episodes and seasons are excluded.
- A slug collision with another active movie is a `409` naming the slug and
  the movie title. The slug is never auto-suffixed, and no writes occur.
- The movie is a new row with a new UUID; `converted_from_drama_id` records
  permanent provenance. The drama, its seasons, and its episodes are
  soft-deleted in the same transaction, so the source stays in Trash for audit.
- Ratings, reviews, bookmarks, playback progress, watched state, watch history,
  notifications, and analytics move to the movie. Progress and watched-state
  `episode_id` become `NULL`; `watch_history.episode_id` is preserved.
  Categories and platforms move to the movie; `similar_dramas` and structure
  snapshots are untouched.
- Preview response:
  `{ "data": { dramaId, fingerprint, source, movie, relationships, warnings } }`
  where `source` carries `dramaId`, `episodeId`, `episodeTitle`,
  `episodeNumber`, and `seasonId`, and `movie` carries `title`, `slug`,
  `description`, `poster`, `banner`, `publicationStatus`, `videoSource`,
  `convertedFromDramaId`, `categories`, and `platforms`.
- Apply response: the preview shape plus `applied: true` and `movieId`.
- Errors use the standard `{ error: { code, message, fieldErrors?, requestId } }`
  envelope: `401` unauthenticated, `403` insufficient permission, `404` missing
  drama, `400` invalid request (including a malformed JSON body), `409`
  ineligibility/slug conflict/stale fingerprint/concurrent change, `500`
  unexpected failure.
- The page `/admin/dramas/[id]/convert-to-movie` uses the same workflow through
  Server Actions; it is not a separate REST endpoint.

---

### 3.12 Role, permission, and account administration (implemented, Phase 3)

These endpoints replace the former `?action=` dispatchers on `/admin/api/roles`
and `/admin/api/users`. Every mutation uses the HTTP method that matches the
operation, and no state-changing `GET` remains. Authorization is enforced at
the route entrypoint and re-checked inside the workflow and the module service.

| Method   | Path                                  | Auth          | Permission                    | Purpose                                              | Status      |
| -------- | ------------------------------------- | ------------- | ----------------------------- | ---------------------------------------------------- | ----------- |
| `GET`    | `/admin/api/roles`                    | Super Admin   | —                             | List every role with its stored permission grants    | Implemented |
| `POST`   | `/admin/api/roles`                    | Super Admin   | —                             | Create a role with no permissions                    | Implemented |
| `PATCH`  | `/admin/api/roles/[id]`               | Super Admin   | —                             | Rename a role or change its description              | Implemented |
| `DELETE` | `/admin/api/roles/[id]`               | Super Admin   | —                             | Delete a role that is not assigned to any user       | Implemented |
| `PUT`    | `/admin/api/roles/[id]/permissions`   | Super Admin   | —                             | Replace the whole granted permission set of a role   | Implemented |
| `GET`    | `/admin/api/users/[id]/roles`         | Admin         | `admin.manage`               | List the roles assigned to one account               | Implemented |
| `POST`   | `/admin/api/users/[id]/roles`         | Super Admin   | —                             | Assign a role to an account                          | Implemented |
| `DELETE` | `/admin/api/users/[id]/roles/[roleId]`| Super Admin   | —                             | Revoke one role from an account                      | Implemented |
| `POST`   | `/admin/api/users/[id]/status`        | Admin         | `admin.manage`               | Activate or deactivate one account                   | Implemented |

Bodies are strict; unknown fields are rejected.

- `POST /admin/api/roles` — `{ "name": "content_editor", "description": "…" }`.
  The name is lowercase snake_case (`[a-z][a-z0-9_]*`, 2–64 characters) and
  `super_admin` is reserved: Super Admin is the authoritative `is_super_admin`
  flag, not a role grant. A duplicate name is a `409`.
- `PATCH /admin/api/roles/[id]` — `{ "name"?: …, "description"?: … }`; at least
  one field is required. `description: null` clears the description.
- `PUT /admin/api/roles/[id]/permissions` — `{ "permissionKeys": ["drama.read"] }`.
  The replacement is atomic: a permission that leaves the set keeps its row
  with `granted = false`, and an unknown key is a `400`.
- `POST /admin/api/users/[id]/roles` — `{ "roleId": "uuid" }`. Assigning the
  same role twice is idempotent.
- `POST /admin/api/users/[id]/status` — `{ "isActive": true | false }`. The last
  active Super Admin cannot be deactivated: the invariant is enforced inside
  the auth module under a `FOR UPDATE` lock, so it holds under concurrency. A
  Super Admin account can only be changed by a Super Admin.

Responses use the standard envelopes: `{ data, meta }` for a read, `{ data }`
for a write, and `{ error: { code, message, fieldErrors?, requestId } }` for a
failure. A `DELETE` answers `204` with no body. Every response carries the
`X-Request-Id` header. Mutations reject cross-origin requests.

The pages `/admin/roles` and `/admin/users` use these endpoints from their
client islands; the pages themselves are Server Components.

### 3.13 Content publication (implemented, Prompts 068–069)

Publication state is set explicitly, item by item. Publishing a parent never
publishes its children, and an episode without a valid playback source is
never published.

| Method | Path                        | Auth                | Permission                                            | Purpose                                              | Status      |
| ------ | --------------------------- | ------------------- | ----------------------------------------------------- | ---------------------------------------------------- | ----------- |
| `POST` | `/admin/api/publication`    | Authenticated admin | `drama.manage` / `season.manage` / `episode.manage` / `movie.manage` | Publish or unpublish one item or a bounded batch | Implemented |

The body is strict:

```json
{
  "contentType": "episode",
  "ids": ["<uuid>", "<uuid>"],
  "operation": "publish"
}
```

- `contentType` is `drama`, `season`, `episode`, or `movie`; the permission
  checked is the manage permission of that type.
- `operation` is `publish` or `unpublish`.
- `ids` holds 1–100 UUIDs. The operation is applied in bounded batches, and
  each batch runs in a transaction that locks its rows.
- The response reports every requested id:

```json
{
  "data": {
    "results": [
      { "id": "<uuid>", "status": "published", "reason": null, "message": null },
      { "id": "<uuid>", "status": "skipped", "reason": "missing_video_source", "message": "…" }
    ],
    "published": 1,
    "unpublished": 0,
    "skipped": 1,
    "failed": 0
  }
}
```

- The machine-readable skip reasons are `missing_video_source`,
  `already_published`, `already_unpublished`, `trashed`, `invalid_id`, and
  `duplicate_id`. One ineligible item never blocks the rest of the batch.
- Mutations reject cross-origin requests.

The admin surface is `/admin/publication`: type tabs, search, pagination,
checkbox selection, bulk publish/unpublish, and the per-item skip report.

### 3.14 Similar-drama management (implemented, Prompt 071)

| Method | Path                                           | Auth                | Permission     | Purpose                                                    | Status      |
| ------ | ---------------------------------------------- | ------------------- | -------------- | ---------------------------------------------------------- | ----------- |
| `GET`  | `/admin/api/similar-dramas?dramaId=<uuid>`     | Authenticated admin | `drama.manage` | List the stored recommendations of one drama, in order      | Implemented |
| `POST` | `/admin/api/similar-dramas`                    | Authenticated admin | `drama.manage` | Add one recommendation                                     | Implemented |
| `PUT`  | `/admin/api/similar-dramas`                    | Authenticated admin | `drama.manage` | Replace the whole recommendation list of one drama         | Implemented |
| `DELETE`| `/admin/api/similar-dramas?dramaId=&similarId=`| Authenticated admin | `drama.manage` | Remove one recommendation                                  | Implemented |
| `PUT`  | `/admin/api/similar-dramas/reorder`            | Authenticated admin | `drama.manage` | Set the stored order of the recommendations                 | Implemented |
| `GET`  | `/admin/api/similar-dramas/candidates?dramaId=`| Authenticated admin | `drama.manage` | Search dramas that can be recommended                      | Implemented |
| `GET`  | `/admin/api/similar-dramas/suggestions?dramaId=`| Authenticated admin | `drama.manage` | Scored automatic suggestions for one drama                | Implemented |

- A drama can never recommend itself, and a duplicate recommendation is a
  `409`.
- The suggestion endpoint is read-only: it never persists a recommendation.
  The score weights are fixed (category 3, platform 2, status 1, structure 1)
  and a candidate that shares nothing is not offered.
- The ordering endpoint takes `{ "dramaId": "<uuid>", "ids": ["<uuid>", …] }`
  and stores the order in one transaction.

### 3.15 Content Trash (implemented, Prompts 072–074)

| Method | Path                                   | Auth        | Permission                                                             | Purpose                                          | Status      |
| ------ | -------------------------------------- | ----------- | ---------------------------------------------------------------------- | ------------------------------------------------ | ----------- |
| `GET`  | `/admin/api/trash`                     | Admin       | Any of `drama.manage`, `season.manage`, `episode.manage`, `movie.manage` | Paginated Trash listing                         | Implemented |
| `POST` | `/admin/api/trash/restore`             | Admin       | The manage permission of the content type                              | Restore one trashed item                        | Implemented |
| `POST` | `/admin/api/trash/permanent-delete`    | Super Admin | —                                                                       | Preview, delete, or bulk delete trashed content | Implemented |

- `GET` accepts `type` (`all`, `drama`, `season`, `episode`, `movie`), `page`,
  `pageSize` (1–100), and `search`. The listing only contains the content
  types the actor is allowed to manage.
- The response carries the collection in `data` and the pagination in `meta`.
  The collection is never repeated inside `meta`:

```json
{
  "data": [
    {
      "id": "0f9f0f9c-....",
      "contentType": "drama",
      "title": "A trashed drama",
      "parentTitle": null,
      "deletedAt": "2026-11-22T10:00:00.000Z",
      "expiresAt": "2026-12-22T10:00:00.000Z",
      "childCounts": { "seasons": 2, "episodes": 12 }
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "pageSize": 20,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPreviousPage": false,
    "retentionDays": 30
  }
}
```

- The merge is paged in the database, not in the process: one `UNION ALL`
  query applies the search filter, the ordering, and the page window before
  the rows are returned.
- `POST /admin/api/trash/restore` takes `{ "contentType": "drama", "id": "<uuid>" }`.
  A drama restores only the children that were trashed with it, identified by
  the identical `deleted_at` timestamp. Restoring a child whose parent is
  still trashed is refused, and so is a restoration that would create a
  hierarchy conflict.
- `POST /admin/api/trash/permanent-delete` takes
  `{ "contentType": "drama", "id": "<uuid>" }` for one item or
  `{ "items": [{ "contentType": "drama", "id": "<uuid>" }] }` for a bulk
  deletion of up to 100 items. The response reports the impact per item and
  the outcome (`succeeded`/`failed`) with a message. A drama that was
  converted into a movie is refused with a `409` because the movie keeps
  permanent provenance.
- Permanent deletion removes bookmarks, playback progress, watched state, and
  watch history, and retains ratings and reviews in anonymized form.

### 3.16 Image asset upload and delivery (implemented, Prompts 075–078)

| Method      | Path                   | Auth                | Permission                    | Purpose                                       | Status      |
| ----------- | ---------------------- | ------------------- | ----------------------------- | --------------------------------------------- | ----------- |
| `POST`      | `/admin/api/media`     | Authenticated admin | `drama.manage` / `movie.manage` | Upload one poster or banner original       | Implemented |
| `GET`/`HEAD`| `/media/[...path]`     | Public              | —                             | Deliver a stored original image               | Implemented |

- The upload is a `multipart/form-data` request with `contentType`
  (`drama` or `movie`), `kind` (`poster` or `banner`), and one `file`.
- The server validates the declared MIME type, the file signature, the size
  (5 MB maximum), and the pixel dimensions. A poster must be portrait and a
  banner must be landscape.
- The file is stored unchanged under `IMAGE_STORAGE_DIR` as
  `{kind}/{uuid}.{ext}`. The response carries the managed path and the stored
  metadata:

```json
{
  "data": {
    "path": "/media/poster/0f9f0f9c-....png",
    "kind": "poster",
    "contentType": "image/png",
    "bytes": 184320,
    "width": 800,
    "height": 1200
  }
}
```

- Delivery returns the stored bytes with the file's own content type and
  `Cache-Control: public, max-age=31536000, immutable`. The route accepts
  only the managed `{kind}/{uuid}.{ext}` shape; every other path is a `404`.
  Images are never routed through `next/image`, Sharp, or a conversion
  pipeline.
- The storage directory has to survive a deployment. On a production Linux
  host the default is the systemd state directory `/var/lib/dramascan/images`;
  a production `IMAGE_STORAGE_DIR` inside the application directory is
  rejected at startup.
- Uploads reject cross-origin requests.

---

Server Actions are application operations, not REST endpoints. They are documented here with their permission keys and result shape.

| Area                    | Operations                                                                       | Permission examples                              | Status  |
| ----------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------ | ------- |
| Authentication          | Sign out, revoke own session                                                     | —                                                | Planned |
| Profile                 | View private profile                                                             | —                                                | Planned |
| Bookmarks               | Add, remove, toggle                                                              | Own bookmarks                                    | Planned |
| Playback                | Mark watched/unwatched, remove from Continue Watching                            | Own progress                                     | Planned |
| Reviews                 | Submit/update rating, submit/edit review, react, report review                   | Authenticated                                    | Planned |
| Content reports         | Submit a content report                                                          | Authenticated, rate-limited                      | Planned |
| Notifications           | Update preferences, mark read/unread, manage push subscription                   | Own notifications                                | Planned |
| Content administration  | Create/update/publish/unpublish/trash/restore content, seasons, episodes, movies | `drama.*`, `episode.*`, `movie.*`                | Implemented |
| Content Trash          | Move content into the Trash, restore it, and permanently delete it (Super Admin)  | `drama.*`, `season.*`, `episode.*`, `movie.*`   | Implemented |
| Image assets           | Upload and replace poster and banner artwork                                       | `drama.manage`, `movie.manage`                   | Implemented |
| Drama structure conversion | Preview and apply a season-based ↔ flat conversion, restore a structure snapshot | `drama.manage`                                   | Implemented |
| Drama → movie conversion   | Preview and apply a single-episode drama conversion into a standalone movie      | `drama.manage`                                   | Implemented |
| Source replacement      | Replace an episode or movie source after preview and confirmation                | `episode.manage`, `movie.manage`                                                | Planned |
| Taxonomy administration | Create/update/delete categories and platforms                                    | `category.*`, `platform.*`                       | Planned |
| Moderation              | Resolve content reports, remove reviews                                          | `review.manage`              | Planned |
| User administration     | Deactivate/reactivate accounts, assign and revoke roles                           | `admin.manage`, Super Admin for role assignment | Implemented |
| Admin administration    | Authorize/deactivate admins, assign roles, terminate sessions                    | `admin.*`                                        | Planned |
| System configuration    | Update settings, restore a version, maintenance mode                             | `settings.manage`                             | Planned |
| CSV import              | Dry run and apply metadata import                                                | `drama.manage`, `movie.manage`                                                | Planned |

Every action validates input with Zod, resolves a trusted actor, calls one service or workflow, and returns `ActionResult`.

---

## 5. Endpoint Documentation Template

When an endpoint is implemented, add a section with:

```markdown
### GET /api/example

- **Status:** Implemented
- **Auth:** Authenticated / Public / Admin
- **Permission:** `example.read`
- **Rate limit:** 60 requests/minute per user
- **Query parameters:** `page`, `pageSize`, `sort`, `q`, ...
- **Request body:** (schema or link to Zod schema)
- **Success:** `200` with `{ data, meta }`
- **Errors:** `400 validation_error`, `401 authentication_required`, `403 forbidden`, `404 not_found`, `429 rate_limited`
- **Caching:** `no-store`
- **Notes:** visibility rules, ownership rules, side effects
- **OpenAPI operationId:** `example.list`
```

---

## 6. OpenAPI

- The OpenAPI document is served at `/api/openapi`; Swagger UI at `/api/docs`.
- Generate schemas from Zod where practical; keep a single source of truth for request/response shapes.
- Every endpoint documents authentication, permissions, validation, responses, and error cases.
- The OpenAPI document must not expose secrets or internal-only fields.
- CI should validate that the OpenAPI document builds. A contract test is added when the API is implemented.

---

## 7. Change Process

1. Read `CONVENTIONS.md` §6–§8 and this document.
2. Confirm the operation belongs in REST (allowlist) or a Server Action.
3. Implement the service/workflow first; the entrypoint adapts it.
4. Enforce authentication and authorization at the entrypoint and re-check in the service.
5. Add tests for success, validation, authorization, not-found, conflict, and rate-limit cases.
6. Update this document and the OpenAPI document.
7. Update `PROJECT_STATUS.md` and `CHANGELOG.md`.

Do not add a REST endpoint for an operation that belongs in a Server Action. Do not implement parallel business logic in two entrypoints.
