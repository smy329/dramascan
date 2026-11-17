# DATA INTEGRITY

**Project:** DramaScan — International Drama & Movie Streaming Platform
**Document:** Integrity constraints, legacy-data reconciliation, and the operator command
**Date:** 2026-11-17
**Status:** Implemented by `drizzle/0009_content_integrity_and_typed_targets.sql` and
`drizzle/0010_typed_analytics_targets_and_report_state.sql`. Applies to every environment.

**Authority chain:** `AGENTS.md` → `docs/requirements/REQUIREMENTS.md` → `docs/decisions/DECISIONS.md` → `docs/architecture/ARCHITECTURE.md` → `docs/development/CONVENTIONS.md` → `docs/development/DATABASE.md` → this document.

This document is the runbook for the Phase 4 integrity work (findings H-08, H-09,
M-07, SCOPE-D01 in `REMEDIATION_PLAN.md`). It records **what the database now
enforces**, **what it deliberately does not enforce yet**, and **how an operator
reconciles the difference without discarding data**.

---

## 1. What the migration changes

| Area                               | Change                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content hierarchy                  | `seasons.drama_id` → `dramas.id`; `episodes.drama_id` → `dramas.id`; composite `episodes(drama_id, season_id)` → `seasons(drama_id, id)`; all `ON DELETE RESTRICT`, because permanent deletion of content is an explicit Super Admin action, never a silent cascade.                                                  |
| Taxonomy and relationships         | Foreign keys on `drama_categories`, `drama_platforms`, `movie_categories`, `movie_platforms`, and both endpoints of `similar_dramas`, plus the index on each referencing column. Join-row FKs cascade (an association has no meaning without both endpoints); taxonomy rows themselves are soft-deleted.              |
| Scoped uniqueness                  | Partial unique indexes for active drama/category/platform slugs, drama-scoped episode numbers, drama-scoped season positions, one reaction per user and review, one active report per user and review, and one bookmark/progress/watched-state row per user and target.                                               |
| Reviews                            | `ck_ratings_value_range` (1–5), `review_reports.status` (`active`/`resolved`), and the partial unique index that allows a new report after the previous one is resolved.                                                                                                                                              |
| User content (H-09)                | Typed `drama_id`/`movie_id` columns on `bookmarks`, `playback_progress`, `watched_state`, and `watch_history`; exactly-one-target CHECK; foreign keys; per-user/per-target uniqueness. The legacy `content_type`/`content_id` pair remains, unchanged.                                                                |
| Analytics (H-09)                   | Typed `drama_id`/`movie_id` columns on `content_view_events`, `playback_analytics_events`, and `analytics_daily_aggregates`; foreign keys; an exactly-one-target CHECK on the two event tables and an at-most-one-target CHECK on the daily aggregate, which may be site-wide. The legacy pair remains.               |
| Report state (M-07)                | `review_reports.description` (optional), `resolved_by` (a user), `resolution_outcome`, `reported_at` (the submission time), and a lifecycle CHECK that ties the resolution fields to the status. The report → review foreign key is `ON DELETE RESTRICT`, so the moderation history survives the removal of a review. |
| Publication timestamps (SCOPE-D01) | Nullable `published_at` on `dramas`, `seasons`, `episodes`, `movies`.                                                                                                                                                                                                                                                 |

### 1.1 Which deletions cascade and which do not

The delete behaviour of a foreign key is part of the integrity contract, so it
is spelled out here rather than left to the migration:

- **Content targets use `ON DELETE RESTRICT`.** A bookmark, progress row,
  watched state, watch-history row, or analytics row that points at a drama or
  a movie blocks the permanent deletion of that content. Silently erasing a
  person's viewing history is not an acceptable side effect of a content
  deletion, and the deletion stays an explicit Super Admin action.
- **The hierarchy uses `ON DELETE RESTRICT`.** A season or episode cannot be
  permanently removed while another row still names it.
- **A row that names a user uses `ON DELETE CASCADE`.** A bookmark, progress
  row, watched state, watch-history row, reaction, report, or role assignment
  has no meaning without its user, and a removed account must not leave
  orphaned personal rows behind. The account removal is the explicit,
  transactional action that owns that cleanup.
- **Association rows use `ON DELETE CASCADE`.** A taxonomy join row exists
  only while both of its endpoints do; the taxonomy entries themselves are
  soft-deleted, so a hard delete of a category or platform is never the normal
  path.
- **The report → review reference uses `ON DELETE RESTRICT`.** Moderation
  history outlives the review it was filed against.

**Expand only.** No column is dropped, renamed, or narrowed. Both migrations are
forward-fix-only: if a release must be rolled back, the additive objects stay.

### 1.1 Consequence: the migration and the release ship together

A `NOT VALID` CHECK constraint is still enforced for **every new or updated
row**. It only tolerates rows that already existed when it was added. So after
`0009`/`0010` are applied:

- a write that sets no typed target is rejected (`23514`), even though the
  constraint is not yet validated;
- a write that changes only the legacy pair of a row that has no typed target
  is rejected as well, because the updated row is checked;
- a release that still writes the legacy pair only therefore stops working
  against the migrated schema.

This is deliberate: new writes are enforced immediately, and the operator
reconciles the historical rows afterwards. The application release that writes
the typed columns and the migration must therefore be deployed together. The
previous release keeps _reading_ the schema; it does not keep writing to it.

---

## 2. Safety posture on a populated database

Production data may already violate a constraint that the application never
enforced. A migration that aborts on such a row is a failed release; a migration
that silently repairs it destroys evidence. Neither happens here.

1. **Foreign keys and CHECK constraints are added `NOT VALID`.**
   PostgreSQL then checks them for every new or updated row while tolerating
   pre-existing rows. The migration cannot abort on legacy data.
2. **Unique indexes are created inside guarded blocks.**
   PostgreSQL has no `NOT VALID` for unique objects, so a duplicate would abort
   the migration. Each index is created in its own `BEGIN … EXCEPTION` block: a
   duplicate produces a `WARNING`, the index is skipped, and every index that can
   be created is created.
3. **No data is rewritten.** No `published_at` value is invented, no duplicate is
   merged, no ambiguous target is guessed, and no legacy report receives a
   submission date it cannot prove.
4. **`ck_review_reports_status` and `uq_seasons_drama_id_id` are fully validated
   from the start.** The `status` column is new and defaulted to `active`, so
   every existing row already satisfies it, and the composite unique target is
   always satisfiable. Every other constraint uses the `NOT VALID` posture.

### 2.1 Consequence: a skipped index is not enforced

A skipped unique index means duplicates of that shape are still possible until an
operator reconciles them. New writes are not fully protected for those shapes.
The application workflows serialize allocation on the parent drama row and
validate before writing, so the normal write path is still correct; the database
is the backstop that must be restored. `npm run db:integrity` reports exactly
which indexes are missing.

### 2.2 Consequence: `NOT VALID` constraints protect new rows only

A `NOT VALID` foreign key still rejects an insert or update that references a
missing parent. It does not prove that rows written before the migration are
valid. `convalidated = false` in `pg_constraint` is the honest status until the
operator runs `validate`.

---

## 3. The operator command

```bash
npm run db:integrity              # report (default, read-only)
npm run db:integrity -- backfill  # typed-target backfill (idempotent)
npm run db:integrity -- validate  # validate constraints + create skipped indexes
```

The implementation is `scripts/data-integrity.mjs`; it needs only `pg` and
`dotenv`, which the project already depends on. It reads `DATABASE_URL` from the
environment, falling back to `.env.local` (UTF-8, UTF-16 LE, and UTF-16 BE are
all handled; real environment variables always win). It is a short-lived command,
not a background worker or a job queue.

### 3.1 `report` — read-only

Prints **every** row that the new constraints or indexes cannot accept yet,
grouped by problem: unresolved legacy targets, unresolvable legacy pairs,
hierarchy orphans, foreign-key orphans outside the hierarchy, duplicate episode
numbers, duplicate season positions, duplicate active slugs, out-of-range
ratings, duplicate reactions, duplicate active reports, duplicate user-content
targets, the rows the backfill must not place, analytics rows without a typed
target, review reports without a submission time, review reports whose
resolution record does not match their status, constraints still `NOT VALID`,
and unique indexes that were skipped.

The report is never truncated: a truncated report looks like a complete one,
and an operator can only reconcile what the report names.

It issues `SELECT` statements only. It never writes, so it is safe to run against
production read-only access and safe to run repeatedly.

The report is scoped to `current_schema()`, so it reports on the schema the
connection actually resolves.

### 3.2 `backfill` — unambiguous rows only

Each of the seven typed tables receives two statements, one per target type:

```sql
WITH batch AS (
  SELECT id FROM bookmarks
   WHERE drama_id IS NULL AND movie_id IS NULL
     AND content_type = 'drama'
     AND EXISTS     (SELECT 1 FROM dramas d WHERE d.id = bookmarks.content_id)
     AND NOT EXISTS (SELECT 1 FROM movies m WHERE m.id = bookmarks.content_id)
   ORDER BY id
   LIMIT 500
)
UPDATE bookmarks AS t
   SET drama_id = t.content_id
  FROM batch
 WHERE t.id = batch.id;
```

A row is backfilled only when **all** of these hold:

- it has no typed target yet (so a second run is a no-op — verified by test);
- the legacy `content_type` names a table;
- the legacy id exists in that table;
- the legacy id does **not** also exist in the other table.

Anything else stays untouched. Specifically, a row is left alone when the legacy
type is unknown, when the legacy id matches no drama or movie, or when the same id
exists in both `dramas` and `movies` — the legacy pair alone cannot say which was
meant, and guessing would corrupt a person's viewing history. The report lists
those rows by id so a human can decide.

The work runs in **bounded batches** of 500 rows, one transaction per batch, so
a large table is never locked in one go and a failed batch leaves the rest of the
work for the next run.

### 3.2.1 The rows the backfill must not place

A row can be unambiguous and still not be placeable, because updating it would
be rejected by the database:

| Reason                 | Meaning                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `target-already-typed` | A row written after the migration already holds that typed target for the same user.        |
| `duplicate-legacy-row` | Another legacy row of the same user points at the same content; both would land on one key. |
| `missing-user`         | The row names a user that does not exist, so the update would fail the user foreign key.    |
| `missing-episode`      | The row names an episode that does not exist, so the update would fail that foreign key.    |

Such a row is **left untouched**, not updated and not fatal: the backfill must
not abort on one bad row, because an abort would roll back the placements that
did succeed. The row stays unresolved, is listed by the `backfill-blocked-rows`
report section, and needs a human merge.

The legacy `content_type`/`content_id` columns are never rewritten or dropped:
they are the only evidence left for the rows the backfill cannot place.

A daily aggregate with no content id is a site-wide aggregate, not an
unresolved row: it keeps no typed target and is not listed as a problem.

### 3.3 `validate` — the explicit gate

1. `ALTER TABLE … VALIDATE CONSTRAINT` for every `NOT VALID` constraint.
2. Recreates the unique indexes the migration had to skip. An index that already
   exists is skipped, so re-running is safe.
3. Prints every failure by name and exits non-zero if anything remains.

A failure is not hidden: one still-violating constraint must not mask the rest of
the state. The command is safe to run repeatedly while reconciliation proceeds.

### 3.4 Sequencing

1. Deploy the application release with migrations `0009` and `0010`.
2. `npm run db:integrity` — capture the baseline report.
3. Resolve the reported rows (merge or delete duplicates deliberately, correct a
   malformed rating, decide each ambiguous user-content or analytics row). Every
   resolution is an explicit, reviewed operation; the command never deletes
   anything.
4. `npm run db:integrity -- backfill`.
5. `npm run db:integrity -- validate`. Repeat 3–5 until it succeeds.
6. Keep the final report; it is the evidence that the schema guarantees hold.

Step 3 requires a product decision for every ambiguous row (see `DECISIONS.md`);
there is no automatic answer.

---

## 4. Verification

`tests/integration/db/migration-populated.integration.test.ts` proves the posture,
not just the syntax. It rebuilds the pre-Phase 4 schema in a disposable schema,
fills it with the shapes the migration must tolerate (duplicate active slug,
duplicate episode number, duplicate season position, orphan season, cross-parent
episode, out-of-range rating, duplicate reaction, duplicate active report,
ambiguous and unresolvable legacy targets, legacy analytics rows, legacy review
reports), then applies `0009` and `0010`.

The suite asserts, on that populated schema:

- both migrations apply without aborting;
- every legacy row survives and `published_at` stays `null` for a row that was
  already published;
- exactly the blocked unique indexes are skipped and the rest exist;
- FK/CHECK constraints are `NOT VALID` while the new `review_reports` check is
  validated;
- new writes that violate the constraints are rejected even while unvalidated;
- `backfill` resolves only the unambiguous rows, leaves the seven unresolved
  rows untouched, places the analytics rows, and a second run updates zero rows;
- `backfill` does not abort on a row whose unique key is taken or whose user is
  missing, and lists those rows with their reason;
- `validate` reports exactly the eleven remaining items by name;
- `report` lists the same rows for an operator, the legacy reports without a
  submission time, the foreign-key orphans, and no analytics row without a typed
  target.

`tests/unit/scripts/data-integrity.test.ts` proves that the report prints every
row: a truncated report looks like a complete one.

`tests/integration/db/integrity-constraints.integration.test.ts` covers the same
constraints from the application side (SQLSTATE assertions on real inserts).

`tests/integration/content/movie-conversion.integration.test.ts` proves that the
conversion moves the typed targets, keeps the watch history append-only, merges
the rows that would otherwise collide on the per-user/per-target uniqueness, and
merges every row of a date into one daily aggregate — including the case where
the target already holds several rows for that date.

Isolation note: the suite uses a disposable schema rather than a scratch
database, because the project's database roles do not have `CREATEDB`. Every
statement runs with `search_path` pointed at the disposable schema and `"public".`
references in the migration SQL are rewritten to it, so nothing in `public` is
touched and the file runs in parallel with the rest of the integration suite.

---

## 5. Known limitations

1. **Skipped unique indexes are not enforced** until reconciliation completes.
   The report names them; `validate` retries them.
2. **`NOT VALID` constraints do not prove historical correctness.** Only
   `validate` does, and it cannot succeed while a violating row exists.
3. **The backfill cannot resolve every legacy row.** Ambiguous and unresolvable
   rows are a documented human decision, not an automated one.
4. **The legacy pair is not kept in sync** with the typed columns for new writes.
   Application code writes the typed columns; `content_type`/`content_id` remain
   for the reconciliation window. Removing them is a later, separately approved
   contract step — and only after every consumer reads the typed columns. The
   drama → movie conversion is the one write path that rewrites both
   representations together.
5. **The index creation is not `CONCURRENTLY`.** Applying the migration takes a
   brief write lock per index build; on a large table a reviewed `CONCURRENTLY`
   follow-up is the production path.
6. **`validate` validates every `fk_*`/`ck_*` constraint in the report list**, not
   only the ones this migration added. That is intentional: the gate is meant to
   leave the schema fully validated.
7. **A legacy report has no submission time.** `reported_at` is `NULL` for every
   report that predates the column, and the report lists them. The `created_at`
   of such a row is the moment the row was migrated, not the moment it was
   submitted; it must not be presented as a submission date.
8. **The daily aggregate has no unique `(date, target)` index.** The conversion
   merges the rows of one date deterministically, but two application writes for
   the same date and target can still produce two rows. The index belongs to the
   phase that builds the analytics write path, after the data has been audited.
9. **The report reason stays free-text.** The requirement's vocabulary
   (spam/advertising, harassment/bullying, inappropriate language,
   misleading/false information, other) is enforced by the moderation service
   of Phase 8, not by a database constraint, so no legacy reason is rewritten.
10. **The moderation service does not exist yet.** The state it will write is
    enforced by the database now; the workflow that resolves a report, notifies
    the reporter, and lists reported reviews is Phase 8.
11. **The Recently Added listing does not exist yet.** Phase 4 provides
    `published_at` and the ordering rule; the listing that uses them is Phase 8.
12. **The operator command has no shebang.** It is invoked through
    `npm run db:integrity`, and a shebang in a file that Git checks out with
    CRLF line endings breaks the Vite transform that the integration test uses
    to import the module.

---

## 6. Rollback

`drizzle/0009` and `drizzle/0010` are forward-fix-only. Rolling the database
back would require dropping columns that hold backfilled data, which the project
forbids. If the release must be rolled back, the application can run against the
additive schema, and a later migration fixes forward. Note that a release that
writes only the legacy pair is rejected by the new CHECK constraints after the
migration, so the rollback of the application is only safe together with a
rollback of the writes that produce typed targets.

---

## 7. Change process

- New integrity rules follow `CONVENTIONS.md` §10: schema change, migration,
  `DATABASE.md` update, tests, then this document if an operator action is needed.
- Never edit an applied migration.
- Never resolve a reported row by deleting it without explicit confirmation; the
  report exists to make the decision visible, not to make it.
