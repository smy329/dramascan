# Admin Content Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin panel sufficient to create and manage categories, platforms, seasons and episodes, so a first playable drama can be entered without SQL.

**Architecture:** Two taxonomy pages plus one drama detail page, each rendering a client manager built on the existing admin form kit. Client components call Server Actions that resolve the actor, re-check the canonical permission, validate with a client-safe schema, and delegate to server-only workflows. Seasons and episodes reuse the existing `seasons.ts` / `episodes.ts` workflows; taxonomy gets a new `taxonomy.ts`. No REST route and no migration are added.

**Tech Stack:** Next.js App Router, TypeScript (strict), Drizzle ORM on PostgreSQL, Zod, React Hook Form, Tailwind/shadcn, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-admin-content-management-design.md`

## Global Constraints

- No new dependency, no database migration, no REST route for taxonomy.
- New screens mutate through Server Actions (`'use server'` files may export only async functions).
- Every page and every action re-checks the canonical permission; navigation is never authorization.
- Slugs are derived from names and are never typed: `slugFromText` is the single rule.
- Deletes are soft deletes (`deleted_at`); association rows are kept.
- `components/**` imports only `components`, `lib`, `lib/contracts`; domain schemas stay in `modules`; workflows stay in `src/workflows/admin`.
- Components are client components only when interactive (`'use client'`).
- ESLint `no-extra-parens` is enabled; do not wrap returned JSX in unnecessary parentheses.
- Only `TEST_DATABASE_URL` (name ending `_test`) may be used by integration and E2E tests.
- Every task ends with a commit. Push once, at the end of Task 8.

## Review Focus

1. A name differing only by case (`Romance` vs `romance`) must be rejected on `name`; the database has no name constraint.
2. Two names that slugify identically (`Sci-Fi` vs `Sci Fi`) must be rejected on `name`, not surface a raw unique-index 500.
3. A name with no Latin characters (`我的家`) must be rejected on `name`, never stored with an empty slug.
4. An episode created with a season id from another drama, or reordered across dramas, must be rejected and leave rows unchanged.
5. Deleting a season that holds episodes must trash the episodes with it and state the count in the confirmation.
6. Two concurrent creations of the same name must produce one row and one validation error, not a 500.

---

### Task 1: Shared slug rule and shared select field

**Files:**
- Create: `src/lib/contracts/slug.ts`
- Modify: `src/lib/contracts/drama-form.ts`
- Create: `src/components/admin/forms/admin-form-control.ts`
- Create: `src/components/admin/forms/admin-form-select-field.tsx`
- Modify: `src/components/admin/forms/admin-form-field.tsx`
- Modify: `src/components/admin/dramas/drama-create-form.tsx`
- Test: `tests/unit/lib/slug-contract.test.ts`, `tests/unit/components/admin-form-select-field.test.tsx`

**Interfaces:**
- Produces: `slugFromText(text: string): string`, `SLUG_MAX_LENGTH = 100` in `@/lib/contracts/slug`; `ADMIN_CONTROL_CLASS_NAME: string` in `@/components/admin/forms/admin-form-control`; `AdminFormSelectField` with props `{ name: string; label: string; options: readonly { value: string; label: string }[]; required?: boolean; hint?: string; className?: string }`.
- Keeps: `dramaSlugFromTitle(title)` and `DRAMA_SLUG_MAX_LENGTH` exported from `@/lib/contracts/drama-form`.

- [ ] **Step 1: Write the failing slug test**

```ts
// tests/unit/lib/slug-contract.test.ts
import { describe, expect, it } from 'vitest';
import { SLUG_MAX_LENGTH, slugFromText } from '@/lib/contracts/slug';
import { DRAMA_SLUG_MAX_LENGTH, dramaSlugFromTitle } from '@/lib/contracts/drama-form';

describe('slugFromText', () => {
  it.each([
    ['This Is My Home', 'this-is-my-home'],
    ['  Spaced   Out  ', 'spaced-out'],
    ['Café & Crème!', 'cafe-creme'],
    ["Don't Stop", 'dont-stop'],
    ['A--B__C', 'a-b-c'],
  ])('derives %s as %s', (input, expected) => {
    expect(slugFromText(input)).toBe(expected);
  });

  it('returns an empty slug when no Latin characters remain', () => {
    expect(slugFromText('我的家')).toBe('');
    expect(slugFromText('!!!')).toBe('');
  });

  it('caps at SLUG_MAX_LENGTH without a trailing hyphen', () => {
    const slug = slugFromText(`${'a'.repeat(SLUG_MAX_LENGTH - 1)} tail`);
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('keeps the drama helpers working through the shared rule', () => {
    expect(DRAMA_SLUG_MAX_LENGTH).toBe(SLUG_MAX_LENGTH);
    expect(dramaSlugFromTitle('Café & Crème!')).toBe(slugFromText('Café & Crème!'));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/unit/lib/slug-contract.test.ts`
Expected: FAIL — cannot resolve `@/lib/contracts/slug`.

- [ ] **Step 3: Implement `slug.ts` and delegate from `drama-form.ts`**

Move the normalization chain that `dramaSlugFromTitle` already contains into `slugFromText`; keep `DRAMA_SLUG_MAX_LENGTH` as `SLUG_MAX_LENGTH` and `dramaSlugFromTitle` as a one-line delegate so existing imports and the existing drama test keep passing.

- [ ] **Step 4: Run both slug suites**

Run: `npx vitest run tests/unit/lib/slug-contract.test.ts tests/unit/lib/drama-form-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing select-field test**

```tsx
// tests/unit/components/admin-form-select-field.test.tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useForm, FormProvider } from 'react-hook-form';
import { AdminFormSelectField } from '@/components/admin/forms/admin-form-select-field';

function Harness(): JSX.Element {
  const methods = useForm<Record<string, unknown>>({ defaultValues: { kind: 'b' } });
  return (
    <FormProvider {...methods}>
      <AdminFormSelectField
        name="kind"
        label="Kind"
        required
        hint="Pick one."
        options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }]}
      />
    </FormProvider>
  );
}

afterEach(cleanup);

describe('AdminFormSelectField', () => {
  it('renders the labelled select, its options and the hint', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Kind *')).toBeTruthy();
    expect(screen.getByRole('combobox')).toHaveProperty('value', 'b');
    expect(screen.getByRole('option', { name: 'Alpha' })).toBeTruthy();
    expect(screen.getByText('Pick one.')).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `npx vitest run tests/unit/components/admin-form-select-field.test.tsx`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 7: Implement the shared control class and select field**

Create `admin-form-control.ts` exporting the exact class string currently held by `AdminFormField` (rename only), point `AdminFormField` at it, create `AdminFormSelectField` with the same registration, `aria-invalid`, `aria-describedby`, hint and error markup that `SelectField` in `drama-create-form.tsx` renders. Then delete that local `SelectField` and use `AdminFormSelectField` for `status` and `structure_type`.

- [ ] **Step 8: Run the form tests**

Run: `npx vitest run tests/unit/components/admin-form-select-field.test.tsx tests/unit/components/drama-create-form.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/contracts/slug.ts src/lib/contracts/drama-form.ts src/components/admin/forms tests/unit/lib/slug-contract.test.ts tests/unit/components/admin-form-select-field.test.tsx src/components/admin/dramas/drama-create-form.tsx
git commit -m "refactor: share the slug rule and the admin select field"
```

---

### Task 2: Taxonomy contracts and domain validation

**Files:**
- Create: `src/lib/contracts/taxonomy-form.ts`
- Modify: `src/modules/content/validation.ts`
- Test: `tests/unit/lib/taxonomy-form-contract.test.ts`, `tests/unit/modules/content/taxonomy-validation.test.ts`

**Interfaces:**
- Produces in `@/lib/contracts/taxonomy-form`: `CATEGORY_VISIBILITY_OPTIONS`, `taxonomySlugFromName(name: string): string`, `categoryFormSchema`, `platformFormSchema`, `updateCategoryFormSchema` (`{ id, name, visibility }`), `updatePlatformFormSchema` (`{ id, name }`), `taxonomyIdFormSchema` (`{ id }`), `reorderTaxonomyFormSchema` (`{ ids: string[] }`), `CATEGORY_FORM_DEFAULTS`, `PLATFORM_FORM_DEFAULTS`, and `type TaxonomyDto = { id: string; name: string; slug: string; position: number | null; visibility: string | null; usageCount: number }`.
- Produces in `@/modules/content/validation`: `createCategorySchema` (name 1–80, `visibility` default `'visible'`), `updateCategorySchema` (both optional), `createPlatformSchema` (name 1–80), `updatePlatformSchema` (name optional).

- [ ] **Step 1: Write the failing contract tests**

Assert: `categoryFormSchema.safeParse({ name: 'Romance', visibility: 'visible' }).success === true`; empty name, 81-char name, `visibility: 'secret'`, and an extra `slug` key all fail; `platformFormSchema` rejects a `visibility` key because it is strict; `taxonomySlugFromName('Café & Crème') === 'cafe-creme'`.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/lib/taxonomy-form-contract.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the failing domain tests**

Assert: `createCategorySchema` trims `name` and defaults `visibility` to `'visible'`; `createCategorySchema` rejects `visibility: 'hidden '` (not trimmed by the enum); `updateCategorySchema` accepts `{}`; `createPlatformSchema` rejects a `slug` key.

- [ ] **Step 4: Implement both modules**

`taxonomy-form.ts` mirrors the drama contract style (client-safe, no server imports). `validation.ts` gains the four schemas next to `createDramaSchema`, matching the existing export style.

- [ ] **Step 5: Run the taxonomy and drama validation suites**

Run: `npx vitest run tests/unit/lib/taxonomy-form-contract.test.ts tests/unit/modules/content/taxonomy-validation.test.ts tests/unit/modules/content/drama-validation.test.ts`
Expected: PASS (the last suite proves nothing regressed).

- [ ] **Step 6: Commit**

```bash
git add src/lib/contracts/taxonomy-form.ts src/modules/content/validation.ts tests/unit/lib/taxonomy-form-contract.test.ts tests/unit/modules/content/taxonomy-validation.test.ts
git commit -m "feat: add taxonomy contracts and validation"
```

---

### Task 3: Taxonomy workflows

**Files:**
- Create: `src/workflows/admin/taxonomy.ts`
- Create: `src/platform/db/pg-errors.ts`
- Test: `tests/integration/content/taxonomy.integration.test.ts`, `tests/unit/platform/pg-errors.test.ts`

**Interfaces:**
- Produces (all in `server-only` module `@/workflows/admin/taxonomy`), with `ActorContext` from `@/modules/authorization`:
  - `listCategories(actor): Promise<{ categories: TaxonomyRow[] }>`
  - `listPlatforms(actor): Promise<{ platforms: TaxonomyRow[] }>`
  - `createCategory(actor, input: unknown)`, `updateCategory(actor, id: string, input: unknown)`, `deleteCategory(actor, id: string)`, `reorderCategories(actor, ids: string[])`
  - `createPlatform(actor, input: unknown)`, `updatePlatform(actor, id: string, input: unknown)`, `deletePlatform(actor, id: string)`, `reorderPlatforms(actor, ids: string[])`
  - Mutation results follow the existing style: `{ ok: true; … } | { ok: false; error: unknown }`.
  - `type TaxonomyRow = { id: string; name: string; slug: string; position: number | null; visibility: string | null; usageCount: number; createdAt: string }`.
- Consumes: `slugFromText`, `parseOrThrow`, the Task 2 schemas, `db`, `categories`/`platforms`/join tables, `requirePermission`.

- [ ] **Step 1: Write the failing integration tests**

Use the `TEST_DATABASE_URL` hoist block and `vi.mock('server-only')` pattern from `tests/integration/content/dramas.integration.test.ts`. Cleanup deletes only rows whose slug starts with `it-taxonomy-admin-`.

Cases:
1. `createCategory(actor, { name: 'Romance' })` → slug `romance`, `visibility: 'visible'`, `position: 0`.
2. Second `createCategory` with `{ name: 'romance' }` → `ok:false`, `error.fieldErrors.name` defined, and only one active row remains.
3. `createCategory` with `'Sci-Fi'` then `'Sci Fi'` → second rejected on `name` (same slug).
4. `createCategory` with `'我的家'` → rejected on `name`; no row inserted.
5. `updateCategory` renaming to an existing name → rejected; renaming to a fresh name re-derives the slug.
6. Soft-deleted row does not block its name or slug being reused.
7. `deleteCategory` on a category attached to a drama → `usageCount === 1`, `deleted_at` set, `drama_categories` row still present.
8. `reorderCategories(actor, [c2.id, c1.id])` → positions `0,1` in that order.
9. An actor with `permissions: []` → each mutation rejects with an authorization error (assert the thrown/reported `code` is `forbidden`).
10. `createPlatform` accepts `{ name: 'Netflix' }`, derives `netflix`, and rejects a `visibility` key.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/content/taxonomy.integration.test.ts`
Expected: FAIL — cannot resolve `@/workflows/admin/taxonomy`.

- [ ] **Step 3: Implement the workflows**

Rules to encode:
- Slug from `slugFromText(name)`; empty slug → `validation_error` with `fieldErrors: { name: ['Name must contain at least one Latin letter or number.'] }`.
- Duplicate active name (case-insensitive) and duplicate active slug both report on `name`.
- Create allocates `position = max + 1` (null-safe) inside one transaction.
- Update keeps the current position and re-derives the slug from the new name.
- Delete sets `deleted_at` and returns the count of join rows (`drama_categories` + `movie_categories`; platforms use `drama_platforms` + `movie_platforms`).
- Reorder rejects duplicate ids and ids that are missing/trashed, then writes `0..n-1` in the given order.
- `requirePermission(actor, 'category.manage')` / `'platform.manage'` first in every function.
- List orders by `position asc nulls last, name asc` and computes `usageCount` with one grouped query per resource.
- Every insert/update is wrapped so a PostgreSQL unique violation (`23505` on `uq_*_slug_active`) is returned as the same `validation_error` on `name`; two concurrent creations must yield one row and one field error, never a 500.

- [ ] **Step 4: Write the failing unique-violation unit test, then implement `pg-errors.ts`**

```ts
// tests/unit/platform/pg-errors.test.ts
import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from '@/platform/db/pg-errors';

describe('isUniqueViolation', () => {
  it('recognises a unique violation and ignores anything else', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
  });
});
```

`isUniqueViolation(error: unknown): boolean` reads a `code` property without importing `pg` types, and `taxonomy.ts` uses it around its insert/update.

- [ ] **Step 5: Run the integration and unit suites**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/content/taxonomy.integration.test.ts`
Run: `npx vitest run tests/unit/platform/pg-errors.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/workflows/admin/taxonomy.ts src/platform/db/pg-errors.ts tests/integration/content/taxonomy.integration.test.ts tests/unit/platform/pg-errors.test.ts
git commit -m "feat: add category and platform workflows"
```

---

### Task 4: Taxonomy Server Actions

**Files:**
- Create: `src/workflows/admin/action-errors.ts`
- Create: `src/workflows/admin/taxonomy-actions.ts`
- Modify: `src/workflows/admin/drama-actions.ts` (use the shared helper; behaviour unchanged)
- Test: `tests/unit/workflows/admin/taxonomy-actions.test.ts`

**Interfaces:**
- Produces in `@/workflows/admin/action-errors`: `toActionError(error: unknown): ActionError` and `withFieldError(error: ActionError, from: string, to: string): ActionError`. This file has no `'use server'` directive.
- Produces in `@/workflows/admin/taxonomy-actions` (all async): `createCategoryAction(input)`, `updateCategoryAction(input)`, `deleteCategoryAction(input)`, `reorderCategoriesAction(input)`, and the four platform equivalents, each `Promise<ActionResult<…>>` where create/update return `TaxonomyDto`, delete returns `{ usageCount: number }`, reorder returns `{ reordered: number }`.
- Consumes: `resolveActor`, `requirePermission`, `parseOrThrow`, Task 2 schemas, Task 3 workflows, `mapErrorToActionResult`.

- [ ] **Step 1: Write the failing action tests**

Mock `server-only`, `@/modules/authorization` (real `requirePermission`, mocked `resolveActor`) and `@/workflows/admin/taxonomy`, following `tests/unit/workflows/admin/drama-actions.test.ts`. Cases:
1. A manager creates a category; the action passes `{ name, visibility }` and returns the workflow row.
2. An actor without `category.manage` gets `{ ok:false, error.code: 'forbidden' }` and the workflow is not called.
3. An empty name is rejected as `validation_error` before the workflow runs.
4. A duplicate-name error from the workflow arrives as `fieldErrors.name`.
5. `deleteCategoryAction` returns `{ usageCount }` from the workflow.
6. `reorderCategoriesAction` rejects `{ ids: [] }` with `validation_error`.
7. A platform action rejects a payload carrying `visibility`.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/workflows/admin/taxonomy-actions.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement the shared error helper and the actions**

Move `toActionError` and `isActionErrorLike` verbatim from `drama-actions.ts` into `action-errors.ts`; generalise the slug remap into `withFieldError` and have `drama-actions.ts` call `withFieldError(error, 'slug', 'title')`. Each action resolves the actor, requires the permission, parses the payload, calls the workflow, and maps both the `ok:false` error and any thrown value through `toActionError`.

- [ ] **Step 4: Run the action and drama-action suites**

Run: `npx vitest run tests/unit/workflows/admin/taxonomy-actions.test.ts tests/unit/workflows/admin/drama-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workflows/admin/action-errors.ts src/workflows/admin/taxonomy-actions.ts src/workflows/admin/drama-actions.ts tests/unit/workflows/admin/taxonomy-actions.test.ts
git commit -m "feat: add category and platform server actions"
```

---

### Task 5: Taxonomy pages, manager and navigation

**Files:**
- Create: `src/components/admin/taxonomy/taxonomy-manager.tsx`
- Create: `src/app/admin/categories/page.tsx`, `src/app/admin/platforms/page.tsx`
- Modify: `src/components/admin/navigation.ts` (set `implemented: true` on `categories` and `platforms`)
- Test: `tests/unit/components/taxonomy-manager.test.tsx`, `tests/unit/app/admin-categories-page.test.tsx`, `tests/unit/app/admin-platforms-page.test.tsx`, `tests/unit/components/admin-navigation.test.ts`

**Interfaces:**
- Produces: `TaxonomyManager` with props `{ resource: 'category' | 'platform'; rows: TaxonomyDto[] }`.
- Consumes: `AdminForm`, `AdminFormField`, `AdminFormSelectField`, `AdminDataTable`, `ConfirmationDialog`, the Task 4 actions, `useRouter().refresh()`.

- [ ] **Step 1: Write the failing component test**

Render `TaxonomyManager` with `resource="category"` and two rows. Assert: a "New category" form with the Name field and a Visibility select; each row exposes an "Edit" control that reveals a prefilled form; "Move up" is disabled on the first row and "Move down" on the last; "Delete" opens a dialog whose text contains the row's usage count; submitting the create form with an empty name shows `Name is required.` and does not call the action; a successful create calls `router.refresh()`.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/components/taxonomy-manager.test.tsx`
Expected: FAIL — cannot resolve the component.

- [ ] **Step 3: Implement the manager**

Render the create form above an `AdminDataTable` whose columns are Name, Visibility (categories only), Used by, and Actions. Actions are `Move up` / `Move down` / `Edit` / `Delete`; reorder sends the full id order to the reorder action; delete opens `ConfirmationDialog` with `variant="destructive"` and `affectedContent` naming the usage count; every successful mutation calls `router.refresh()`. Editing swaps the row's cells for an inline `AdminForm` prefilled from the row.

- [ ] **Step 4: Implement the two pages**

`force-dynamic`, `requireAdminPageAccess('/admin/categories' | '/admin/platforms')`, then `hasPermission(actor, toPermissionKey('category'|'platform','manage'))` else `notFound()`, load rows through Task 3, render a heading plus the manager.

- [ ] **Step 5: Write the failing page tests and update navigation tests**

Mock `../_access`, `@/modules/authorization`, and the taxonomy workflow. Assert a permitted actor renders the heading and rows, and an unpermitted actor calls `notFound()`. In `admin-navigation.test.ts`, assert Categories and Platforms now render for an actor holding their `read` permission and that `hasAdminAreaAccess` still rejects an actor with none.

- [ ] **Step 6: Run the UI suites**

Run: `npx vitest run tests/unit/components/taxonomy-manager.test.tsx tests/unit/app/admin-categories-page.test.tsx tests/unit/app/admin-platforms-page.test.tsx tests/unit/components/admin-navigation.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/taxonomy src/app/admin/categories src/app/admin/platforms src/components/admin/navigation.ts tests/unit/components/taxonomy-manager.test.tsx tests/unit/app/admin-categories-page.test.tsx tests/unit/app/admin-platforms-page.test.tsx tests/unit/components/admin-navigation.test.ts
git commit -m "feat: add category and platform admin pages"
```

---

### Task 6: Drama detail page and season management

**Files:**
- Modify: `src/workflows/admin/dramas.ts` (add `getDramaForAdmin`)
- Modify: `src/workflows/admin/seasons.ts` (next-free position on create; add `reorderSeasons`)
- Create: `src/lib/contracts/season-form.ts`
- Create: `src/workflows/admin/season-actions.ts`
- Create: `src/components/admin/dramas/season-manager.tsx`
- Create: `src/app/admin/dramas/[id]/page.tsx`
- Modify: `src/app/admin/dramas/page.tsx` (title links to the detail page)
- Test: `tests/integration/content/seasons-admin.integration.test.ts`, `tests/unit/workflows/admin/season-actions.test.ts`, `tests/unit/components/season-manager.test.tsx`, `tests/unit/app/admin-drama-detail-page.test.tsx`

**Interfaces:**
- Produces in `@/workflows/admin/dramas`: `getDramaForAdmin(actor, dramaId): Promise<{ drama: AdminDramaDetail; categoryNames: string[]; platformNames: string[] } | null>` where `AdminDramaDetail` carries `id, title, slug, description, status, structure_type, visibility, poster, banner, activeSeasons, activeEpisodes, createdAt`.
- Produces in `@/workflows/admin/seasons`: `reorderSeasons(actor, dramaId, seasonIds): Promise<{ ok: true; reordered: number } | { ok: false; error: unknown }>`; `createSeason` accepts an omitted `position`.
- Produces in `@/lib/contracts/season-form`: `seasonFormSchema` (`{ title, position? }`), `updateSeasonFormSchema` (`{ id, title?, position? }`), `deleteSeasonFormSchema` (`{ id }`), `reorderSeasonsFormSchema` (`{ drama_id, ids }`).
- Produces in `@/workflows/admin/season-actions`: `createSeasonAction`, `updateSeasonAction`, `deleteSeasonAction`, `reorderSeasonsAction`; delete returns `{ affectedEpisodes: number }`.

- [ ] **Step 1: Write the failing season integration tests**

Cases: two creates without a position yield `0` then `1`; an explicit position that is taken is rejected; `reorderSeasons` reverses the order and keeps every position distinct; a season from another drama is rejected; a caller without `season.manage` is rejected; `getDramaForAdmin` returns the drama with category/platform names and counts, and `null` for an unknown id.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/content/seasons-admin.integration.test.ts`
Expected: FAIL — `reorderSeasons`/`getDramaForAdmin` not exported.

- [ ] **Step 3: Implement the workflow changes**

`createSeason` keeps the drama lock, then allocates the next free position when none is supplied (the existing duplicate-position check still runs for explicit values). `reorderSeasons` validates every id belongs to the drama and is active, then clears the affected positions and writes `0..n-1` in one transaction, because `uq_seasons_drama_id_position_active` rejects naive swaps. `getDramaForAdmin` requires `drama.manage` and returns `null` when the row is missing or trashed.

- [ ] **Step 4: Run the integration suite**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/content/seasons-admin.integration.test.ts tests/integration/content/dramas.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing action tests, then implement**

Cover: create/update/delete/reorder call the workflow with normalized values; a missing `season.manage` yields `forbidden`; delete surfaces `affectedEpisodes`; an invalid title is rejected before the workflow. Implement `season-actions.ts` on the Task 4 helper.

- [ ] **Step 6: Write the failing component test, then implement the manager**

Assert: for a `season_based` drama the create form renders and posts a title with no position; a flat drama renders the "Convert structure" explanation and no create form; rows show episode counts; delete opens a dialog containing the affected episode count; move controls are disabled at the ends; success calls `router.refresh()`.

- [ ] **Step 7: Implement the page and the dramas-list link**

`src/app/admin/dramas/[id]/page.tsx`: `force-dynamic`, gate on `drama.manage`, `notFound()` when `getDramaForAdmin` returns `null`, render the summary (title, slug, structure, status, visibility, categories, platforms) with links to convert, convert-to-movie and similar-dramas, then the season manager and an episode placeholder section. In the dramas list, wrap the title cell in `Link href={`/admin/dramas/${row.id}`}`.

- [ ] **Step 8: Write the failing page test and run the UI suites**

Assert a permitted actor sees the summary and season manager, and an unknown id calls `notFound()`. Then run:

`npx vitest run tests/unit/workflows/admin/season-actions.test.ts tests/unit/components/season-manager.test.tsx tests/unit/app/admin-drama-detail-page.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/workflows/admin/dramas.ts src/workflows/admin/seasons.ts src/lib/contracts/season-form.ts src/workflows/admin/season-actions.ts src/components/admin/dramas/season-manager.tsx src/app/admin/dramas tests
git commit -m "feat: add drama detail page and season management"
```

---

### Task 7: Episode management

**Files:**
- Create: `src/lib/contracts/episode-form.ts`
- Create: `src/workflows/admin/episode-actions.ts`
- Create: `src/components/admin/dramas/episode-manager.tsx`
- Modify: `src/app/admin/dramas/[id]/page.tsx` (render the episode manager)
- Test: `tests/integration/content/episodes-admin.integration.test.ts`, `tests/unit/workflows/admin/episode-actions.test.ts`, `tests/unit/components/episode-manager.test.tsx`

**Interfaces:**
- Produces in `@/lib/contracts/episode-form`: `episodeFormSchema` (`{ title, description?, season_id?, episode_number?, video_source? }`), `updateEpisodeFormSchema` (`{ id, drama_id, title?, description?, season_id?, episode_number?, video_source? }`), `deleteEpisodeFormSchema` (`{ id }`), `reorderEpisodesFormSchema` (`{ drama_id, ids }`), `renumberEpisodesFormSchema` (`{ drama_id }`), and `type EpisodeDto` mirroring `toEpisode`.
- Produces in `@/workflows/admin/episode-actions`: `createEpisodeAction`, `updateEpisodeAction`, `deleteEpisodeAction`, `reorderEpisodesAction`, `renumberEpisodesAction`; reorder returns `{ episodesReordered: number }`, renumber `{ episodesModified: number }`.

- [ ] **Step 1: Write the failing episode integration tests**

Cases: create without a number allocates `1`, the next `2`; an explicit duplicate number is rejected on `episode_number`; a season id from another drama is rejected; changing the season appends the episode inside the target season; reorder sends only one season's ids and leaves the other season's positions untouched; renumber rewrites `1..n` in drama-wide display order; an invalid `video_source` (`http://…` or a non-MP4) is rejected; an actor without `episode.manage` is rejected.

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/content/episodes-admin.integration.test.ts`
Expected: FAIL — cannot resolve the actions/workflows used by the test.

- [ ] **Step 3: Implement the episode actions**

`updateEpisodeAction` calls `updateEpisode` with the metadata and, when `season_id` differs from the current row, calls `moveEpisodesToSeason` afterwards so the position is reallocated inside the target season. `reorderEpisodesAction` passes the ids in display order for a single scope. Every action re-checks `episode.manage` and maps errors through `toActionError`.

- [ ] **Step 4: Run the integration suite**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/content/episodes-admin.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing action and component tests, then implement**

Component assertions: season-based drama shows a Season select (including "No season"); flat drama hides it; create posts the entered values with no `position`; an invalid URL shows the server field error on Video source URL; edit reveals a prefilled form; move up/down is disabled at the ends; delete shows the episode title; renumber button posts the drama id; success calls `router.refresh()`.

- [ ] **Step 6: Render the manager in the detail page**

Replace the placeholder section with `EpisodeManager` receiving `dramaId`, `structureType`, `seasons`, and `episodes`, grouped by season for season-based dramas.

- [ ] **Step 7: Run the episode suites**

Run: `npx vitest run tests/unit/workflows/admin/episode-actions.test.ts tests/unit/components/episode-manager.test.tsx tests/unit/app/admin-drama-detail-page.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/contracts/episode-form.ts src/workflows/admin/episode-actions.ts src/components/admin/dramas/episode-manager.tsx src/app/admin/dramas tests
git commit -m "feat: add episode management to the drama detail page"
```

---

### Task 8: Browser flow, documentation and full verification

**Files:**
- Create: `tests/e2e/admin-content-management.spec.ts`
- Modify: `docs/CHANGELOG.md`, `docs/PROJECT_STATUS.md`, `docs/decisions/DECISIONS.md`

- [ ] **Step 1: Write the E2E spec**

Seed a Super Admin with `adminSession.seed`, set the cookie as `tests/e2e/admin-drama-create.spec.ts` does, then:
1. `/admin/categories`: create `E2E Genre <suffix>` and see it listed.
2. `/admin/platforms`: create `E2E Platform <suffix>` and see it listed.
3. `/admin/dramas/new`: both new names appear as checkboxes; create `E2E Managed Drama <suffix>` as `season_based` with both checked.
4. Open the drama from the list title link; add `Season One` and `Season Two`; add an episode `Pilot` in Season One with `https://cdn.example.com/pilot.mp4`.
5. Assert the episode row shows `Pilot` and the derived slug link path is correct.
6. Delete the category and confirm the dialog; assert it disappears from `/admin/categories`.
7. In `finally`, remove the drama (by derived slug), the taxonomy rows and the seeded user through the existing helpers; add a `removeTaxonomyBySlug` helper to `tests/e2e/support/` next to `drama-fixture.mjs`.

- [ ] **Step 2: Run the new spec**

Run: `npx playwright test tests/e2e/admin-content-management.spec.ts`
Expected: PASS. If another server holds port 3000, stop it first — Playwright refuses to test against a server it did not start.

- [ ] **Step 3: Update the documentation**

`CHANGELOG.md`: a new entry describing the three screens, the derived slugs, the soft delete, the permissions, and the limitation that episodes stay `draft`. `PROJECT_STATUS.md`: one row for this approved change listing the files and the exact verification results. `DECISIONS.md`: `D-033 - Admin content management derives taxonomy slugs, gates each screen by its own permission, and defers publication`.

- [ ] **Step 4: Run the full verification**

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run test:e2e
$env:APP_URL='https://app.example.com'; $env:TRUSTED_ORIGINS='https://app.example.com'; npm run build
```

Expected: all PASS. Record the actual counts in `PROJECT_STATUS.md`; the `.env.local` HTTP origin is why the build needs the HTTPS overrides.

- [ ] **Step 5: Review the diff, commit and push**

Inspect `git status` and `git diff` for stray files or secrets, then:

```bash
git add -A
git commit -m "feat: add admin category, platform, season and episode management"
git push origin main
```

Verify the push output names `main -> main`, then report the commit hash, the verification results, and the known limitations.
