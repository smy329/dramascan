# Drama Structure Conversion (Prompt 066) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let administrators convert a drama between season-based and flat structures with a preview, explicit confirmation, transactional application, and an exact restorable snapshot.

**Architecture:** Domain rules and planning live in `src/modules/content/conversion.ts`; the workflow in `src/workflows/admin/conversion.ts` owns authorization, reads, serializable transactions, locking, and snapshot lifecycle. A REST route and Server Actions are thin adapters over the workflow. The admin UI is a minimal list plus a staged preview/confirm conversion panel.

**Tech Stack:** Next.js App Router, TypeScript strict, Drizzle ORM 0.45.4, PostgreSQL 18, Zod 4, React Hook Form/ConfirmationDialog, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-14-drama-structure-conversion-design.md`

## Global Constraints

- Strict TypeScript; no new runtime dependencies.
- Permission is `drama.manage` on every API route, Server Action, and page.
- Active rows only (`deleted_at IS NULL`); trashed rows are never modified or restored.
- Apply is `serializable`, locks the drama row `FOR UPDATE`, and verifies `fingerprint`.
- One `available` snapshot per drama; history retained.
- Episode IDs, viewing records, ratings, reviews, bookmarks, and metadata are preserved.
- Server-side validation is authoritative; client validation is UX only.
- No admin content UI beyond the minimal list and conversion page.

## Review Focus

1. A preview followed by any structural edit must fail apply with 409.
2. A restorable snapshot must reject after add/trash/reorder/renumber, not overwrite.
3. A failed apply must leave structure, snapshot statuses, and historical snapshots unchanged.
4. Flat → season with an available snapshot must require an explicit strategy.
5. Concurrent conversions for one drama must not create two available snapshots.
6. Trashed episodes/seasons must remain byte-for-byte unchanged.

---

### Task 1: Snapshot schema and migration

**Files:**
- Modify: `src/modules/content/schema.ts`
- Create: `drizzle/0005_*.sql`, `drizzle/meta/0005_snapshot.json`, update `drizzle/meta/_journal.json`

**Interfaces:**
- Produces: `structureConversionSnapshots` table with `id, drama_id, source_structure_type, target_structure_type, season_data (jsonb), episode_data (jsonb), post_conversion_fingerprint, status, restored_at, superseded_at, created_at, updated_at`.

- [ ] Add the table with status/direction checks, `idx_structure_conversion_snapshots_drama_id`, partial unique `uq_structure_conversion_snapshots_drama_id_available`, and FK cascade to `dramas.id`.
- [ ] Run `npm run db:generate`, inspect the SQL, and apply to the development database with `npm run db:migrate`.
- [ ] Run `npm run typecheck` and `npm run lint`.

### Task 2: Conversion contracts and domain rules

**Files:**
- Modify: `src/modules/content/validation.ts`
- Create: `src/modules/content/conversion.ts`
- Test: `tests/unit/modules/content/conversion.test.ts`

**Interfaces:**
- Produces: `ConversionPlan`, `ConversionRequest`, `ConversionDistributionInput`, `computeStructureFingerprint`, `orderSeasonStructure`, `buildFlatConversionPlan`, `validateDistribution`, `buildSeasonConversionPlan`, `buildSnapshotPayload`, `parseSnapshotPayload`.

- [ ] Add Zod schemas: conversion request, distribution, snapshot payload, and snapshot status/strategy enums.
- [ ] Implement deterministic ordering, renumbering, distribution validation, fingerprint, and snapshot payload parsing.
- [ ] Write unit tests for ordering, renumbering, every distribution rejection, fingerprint stability/sensitivity, and snapshot parsing.
- [ ] Run `npx vitest run tests/unit/modules/content/conversion.test.ts`.

### Task 3: Conversion workflow and snapshot lifecycle

**Files:**
- Create: `src/workflows/admin/conversion.ts`
- Test: `tests/integration/content/conversion.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 table, Task 2 contracts.
- Produces: `previewConversion(actor, input)`, `applyConversion(actor, input)`, `listConversionCandidates(actor, query)`, `loadConversionContext(actor, dramaId)`, `parseConversionListQuery(input)`.

- [ ] Implement authorization + context reads (drama, active seasons/episodes, available snapshot).
- [ ] Implement preview for flat, season `convert`, and `restore_snapshot`, including strategy rules and stale warnings.
- [ ] Implement apply in a serializable transaction with drama row lock, fingerprint verification, all writes, snapshot create/supersede/restore, and `40001`/`23505` → `ConflictError`.
- [ ] Write integration tests for both directions, snapshot creation/restore/supersede, stale fingerprint, stale snapshot variants, trashed rows, rollback, authorization, and concurrent apply.
- [ ] Run `npm run test:integration`.

### Task 4: REST endpoint

**Files:**
- Create: `src/app/admin/api/dramas/convert/route.ts`
- Test: `tests/integration/content/conversion-api.integration.test.ts` (or extend Task 3 tests via HTTP)

**Interfaces:**
- Consumes: Task 3 workflow.

- [ ] Add `POST` with same-origin check, `resolveActor`, `drama.manage`, JSON body, preview/apply dispatch, and mapped errors.
- [ ] Test anonymous 401, forbidden 403, invalid 400, not-found 404, success 200, stale 409.
- [ ] Run integration tests.

### Task 5: Server Actions

**Files:**
- Create: `src/workflows/admin/conversion-actions.ts`
- Test: covered by Task 3 workflow tests + component tests.

**Interfaces:**
- Produces: `previewDramaConversion(dramaId, input)`, `applyDramaConversion(dramaId, input)` returning `ActionResult`.

- [ ] Add `'use server'` actions that resolve the actor, require `drama.manage`, call the workflow, and map errors with `mapErrorToActionResult`.
- [ ] Run `npm run typecheck`.

### Task 6: Minimal dramas list

**Files:**
- Create: `src/app/admin/dramas/page.tsx`, `loading.tsx`, `error.tsx`
- Modify: `src/components/admin/navigation.ts`
- Test: `tests/e2e/admin-dramas.spec.ts`

**Interfaces:**
- Consumes: Task 3 `listConversionCandidates`, `parseConversionListQuery`.

- [ ] Change the Dramas nav entry to `drama.manage`.
- [ ] Build the list page with title, structure type, active episode count, and a "Convert structure" link; reuse admin table/pagination/toolbar and query state.
- [ ] Add loading and error states.
- [ ] Add E2E for list + link + unauthorized 404.

### Task 7: Conversion page and panel

**Files:**
- Create: `src/app/admin/dramas/[id]/convert/page.tsx`
- Create: `src/components/admin/dramas/drama-conversion-panel.tsx`
- Test: `tests/unit/components/drama-conversion-panel.test.tsx`, `tests/e2e/admin-drama-conversion.spec.ts`

**Interfaces:**
- Consumes: Task 3 `loadConversionContext`, Task 5 actions.

- [ ] Build the server page with `drama.manage` guard and context loading.
- [ ] Build the client panel: preview, plan rendering, confirmation dialog, strategy choice, distribution editor, apply, error/pending states, accessible labels and live regions.
- [ ] Add component tests for preview/confirm/error/strategy/distribution.
- [ ] Add E2E for season→flat preview and confirm, and flat→season restore path.

### Task 8: Verification, docs, and delivery

**Files:**
- Modify: `docs/PROJECT_STATUS.md`, `docs/implementation/CHANGELOG.md`, `docs/decisions/DECISIONS.md` (D-029), `docs/development/DATABASE.md`, `docs/API.md`, `docs/architecture/ARCHITECTURE.md`
- Modify: `docs/superpowers/specs/2026-11-14-drama-structure-conversion-design.md` (status: approved)

- [ ] Run `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:integration`, `npm run test:e2e`, and `npm run build` with HTTPS overrides.
- [ ] Update documentation with the conversion contract, snapshot lifecycle, and Prompt 066 status.
- [ ] Review `git status`/`git diff`, exclude unrelated untracked files, commit `feat: implement drama structure conversion (Prompt 066)`, and push to `origin/main`.
