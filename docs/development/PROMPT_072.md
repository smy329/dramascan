# Prompts 072–074 — Content Trash, Restoration, Permanent Deletion, and Retention

## Overview

Prompts 072–074 implement the content Trash: a soft-deletion lifecycle for
dramas, seasons, episodes, and standalone movies.

| Prompt | Scope                                                                       | Entry point                            |
| ------ | --------------------------------------------------------------------------- | -------------------------------------- |
| 072    | Soft deletion (move content into Trash) with hierarchy preservation          | `src/workflows/admin/dramas.ts`        |
| 073    | Restoration and permanent deletion with dependency and retention rules       | `src/workflows/admin/restore.ts`, `src/workflows/admin/permanent-delete.ts` |
| 074    | Configurable retention and bounded expiry cleanup                            | `scripts/trash-cleanup.mjs`            |

This document describes the shipped implementation. The earlier revision of this
file described an earlier draft of the Trash and has been replaced.

---

## 1. Moving content into the Trash (Prompt 072)

`deleteDrama`, `deleteSeason`, `deleteEpisode`, and `deleteMovie` set
`deleted_at` instead of removing rows.

- The cascade is **atomic and timestamped**: trashing a drama writes the *same*
  `deleted_at` value to the drama, its seasons, and its episodes inside one
  transaction. That single timestamp is the identity of the cascade.
- Relationships are never rewritten. `seasons.drama_id`, `episodes.drama_id`,
  and `episodes.season_id` survive, so the hierarchy is intact for restoration.
- Trashing content that is already trashed is refused (no-op, not an error
  cascade).
- The workflow returns the affected child counts
  (`{ ok: true; affectedSeasons; affectedEpisodes }`) so the administrator sees
  what the operation touched before confirming it.
- Authorization uses the canonical manage permission of the content type
  (`drama.manage`, `season.manage`, `episode.manage`, `movie.manage`). An
  authorized **non-Super Admin** Content Manager may move content into the
  Trash.

Trashed rows are excluded from every admin listing and from the public site.

## 2. The Trash surface

`src/workflows/admin/trash.ts` provides one cross-content read model:

- `parseTrashListQuery` — tolerates stale or hand-edited URL values
  (`type`, `page`, `pageSize`, `search`) and falls back to safe defaults.
- `permittedTrashTypes(actor)` — returns only the content types the actor may
  manage, so the listing never shows rows the actor cannot act on.
- `listTrashItems` — paginated listing of trashed dramas, seasons, episodes,
  and movies with the parent title, the child counts, the date the content
  entered the Trash, and the projected expiry date.

The UI lives at `/admin/trash` (`src/app/admin/trash/page.tsx` plus the client
island `src/components/admin/trash/trash-manager.tsx`).

## 3. Restoration (Prompt 073)

`src/workflows/admin/restore.ts` implements `restoreDrama`, `restoreSeason`,
`restoreEpisode`, `restoreMovie`, and the `restoreTrashItem` dispatcher.

Restoration is the exact inverse of the cascade:

- A drama restores **only** the seasons and episodes whose `deleted_at` equals
  the drama's own `deleted_at`. A child that was trashed separately keeps its
  own timestamp and stays in the Trash.
- A season restores its episodes only when the parent drama is active again.
- An episode restores only when its drama — and its season, when it has one —
  are active.
- Restoring content that is not in the Trash is refused.
- Restoring never silently breaks a uniqueness rule: a conflicting slug,
  episode number, or season position is reported as a conflict instead of
  being renamed.

Restoration requires the manage permission of the content type, so an
authorized non-Super Admin administrator may restore content.

## 4. Permanent deletion (Prompt 073)

`src/workflows/admin/permanent-delete.ts` implements `previewPermanentDelete`,
`permanentDelete`, and `permanentDeleteBulk`.

- **Super Admin only.** `requireSuperAdmin` is the authority; there is no
  permission key that grants it to another role.
- The content must already be in the Trash. Permanent deletion is the second
  step of the lifecycle, never a shortcut for it.
- `previewPermanentDelete` reports the exact impact before the confirmation:
  seasons, episodes, bookmarks, playback progress, watched state, watch
  history, ratings, reviews, analytics events, notifications, and metadata
  rows.
- `permanentDeleteBulk` accepts up to 100 items and reports each item
  separately (`succeeded`/`failed` with a message), so one blocked item does
  not hide the outcome of the others.

### Retention rules

| Data                                          | Outcome                                                        |
| --------------------------------------------- | -------------------------------------------------------------- |
| Bookmarks, playback progress, watched state, watch history | **Removed** — personal records of content that no longer exists |
| Ratings and reviews                            | **Retained but anonymized** — `user_id = NULL`, `anonymized_at = now()`, content target set to `NULL` |
| Analytics events and daily aggregates          | Removed                                                        |
| Notifications, slug history, SEO rows, asset rows | Removed                                                     |
| Seasons, episodes, taxonomy joins, similar-drama links | Removed with the content                              |

The anonymization rule is enforced by the database: migration `0011` relaxes
the `ck_ratings_target` / `ck_reviews_target` checks so that only an
anonymized row (`anonymized_at IS NOT NULL`) may have no content target.

### Provenance block (D-030)

A drama that was converted into a standalone movie keeps a permanent
`movies.converted_from_drama_id` reference (`ON DELETE RESTRICT`). Deleting the
source drama would destroy the provenance of an existing movie, so the
permanent deletion is refused with a conflict until the movie itself is
removed.

## 5. Retention and expiry (Prompt 074)

- The retention period is configurable through `TRASH_RETENTION_DAYS`
  (default **30** days, whole days between 1 and 365).
- `scripts/trash-cleanup.mjs` is a **short-lived maintenance command**. It is
  not a worker, not a queue, and it holds no schedule of its own.
- `systemd/dramascan-trash-cleanup.service` and
  `systemd/dramascan-trash-cleanup.timer` trigger it once a day; the service
  exits after the run.
- The command works in bounded batches (`TRASH_CLEANUP_BATCH_SIZE`, default
  100) and supports `TRASH_CLEANUP_DRY_RUN=1` for a report-only run.
- A parent whose children have not expired yet is skipped, so a hierarchy is
  never removed from under a live child.
- Every run emits one JSON object per line (`trash_cleanup.started`,
  `trash_cleanup.finished`, and one entry per removed, skipped, or failed
  item), which `journald` can ingest directly.
- Active content and recently restored content are protected by construction:
  only rows with a non-null `deleted_at` older than the cutoff are eligible.

## 6. API surface

| Method | Path                                  | Auth        | Purpose                                     |
| ------ | ------------------------------------- | ----------- | ------------------------------------------- |
| `GET`  | `/admin/api/trash`                    | Admin       | Paginated Trash listing                     |
| `POST` | `/admin/api/trash/restore`            | Admin       | Restore one trashed item                    |
| `POST` | `/admin/api/trash/permanent-delete`   | Super Admin | Preview, permanently delete, or bulk delete |

## 7. Tests

- `tests/unit/workflows/admin/trash.test.ts` — query parsing, permitted types,
  permission mapping.
- `tests/unit/scripts/trash-cleanup.test.ts` — retention parsing, SQL
  construction, delete ordering, structured logging.
- `tests/integration/content/trash.integration.test.ts` — cascade with one
  timestamp, double-trash refusal, timestamp-matched restore, restore-order
  refusal, Super-Admin-only permanent deletion, refusal for content that is
  not trashed, hierarchy purge with anonymized ratings/reviews, and the
  provenance conflict.
