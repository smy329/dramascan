# Shared Content Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable, presentational `ContentCard` for drama and movie content that works in discovery grids and carousels and never fabricates ratings or status.

**Architecture:** A server-rendered card composes a small client-only poster island for image-error fallback. Pure URL and rating helpers live in a separate non-component file so they can be tested in the existing Node environment. Layout is owned by the consumer; the card is `w-full min-w-0` and imposes no scroll behavior.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS v4, lucide-react, Vitest, React Testing Library, jsdom, Playwright (regression only).

**Spec:** Approved design in the Prompt 046 conversation (2026-11-11).

## Global Constraints

- No runtime dependencies are added.
- No Next.js image optimization and no Sharp; use a plain `<img>`.
- No fake ratings, view counts, or lifecycle status.
- Movies never display a lifecycle status badge.
- Components do not fetch data and do not import domain modules.
- Existing Node test environment remains the default.
- Pre-existing uncommitted edits are committed separately before Prompt 046 work.
- `no-extra-parens` lint rule: render guards use `condition && <Element />`, not `(condition) && ...`.
- Do not push until verification passes; the user has authorized pushes without further approval.

## Review Focus

- A rating with a positive average but zero count must render nothing, not `0.0 (0)`.
- A movie passed a `status` prop must render no lifecycle badge.
- A poster that errors after render must fall back without leaving a broken image.
- A card without `href` must not render an empty or misleading link.
- Poster containers must keep a 2:3 ratio with `object-cover`, never stretch.

---

### Task 1: Add DOM component-test tooling without changing Node defaults

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `vitest.config.ts`

**Interfaces:**
- Produces: `npm test` discovers `tests/unit/**/*.test.ts` and `tests/unit/**/*.test.tsx`.
- Produces: component tests can opt into jsdom with `// @vitest-environment jsdom`.

- [ ] **Step 1: Install dev-only test dependencies**

Run: `npm install --save-dev @testing-library/react @testing-library/dom jsdom`

Expected: `package.json` lists all three under `devDependencies`; no `dependencies` change.

- [ ] **Step 2: Allow `.tsx` unit tests**

Change the Vitest `include` from `tests/unit/**/*.test.ts` to `tests/unit/**/*.test.{ts,tsx}`. Leave `environment: 'node'` unchanged.

- [ ] **Step 3: Verify existing unit suite still runs**

Run: `npm test`

Expected: existing unit tests pass; no component tests exist yet.

---

### Task 2: Pure card helpers (TDD)

**Files:**
- Create: `tests/unit/components/content-card-helpers.test.ts`
- Create: `src/components/public/content-card.ts`

**Interfaces:**
- Produces:
  - `type ContentKind = 'drama' | 'movie'`
  - `type ContentLifecycleStatus = 'ongoing' | 'completed' | 'coming-soon'`
  - `type ContentRating = { average: number; count: number }`
  - `CONTENT_KIND_LABELS: Record<ContentKind, string>`
  - `CONTENT_STATUS_LABELS: Record<ContentLifecycleStatus, string>`
  - `normalizeSafeUrl(value?: string | null): string | null`
  - `normalizeRating(rating?: ContentRating | null): ContentRating | null`
  - `formatRatingAverage(average: number): string`
  - `formatRatingCount(count: number): string`

- [ ] **Step 1: Write failing helper tests**

Cover:
```ts
expect(normalizeSafeUrl('/posters/a.jpg')).toBe('/posters/a.jpg');
expect(normalizeSafeUrl('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
expect(normalizeSafeUrl('  ')).toBeNull();
expect(normalizeSafeUrl('javascript:alert(1)')).toBeNull();
expect(normalizeSafeUrl('data:image/png;base64,abc')).toBeNull();
expect(normalizeSafeUrl('//evil.example/a.jpg')).toBeNull();
expect(normalizeSafeUrl('not a url')).toBeNull();

expect(normalizeRating({ average: 4.5, count: 1200 })).toEqual({ average: 4.5, count: 1200 });
expect(normalizeRating({ average: 0, count: 10 })).toBeNull();
expect(normalizeRating({ average: 5.1, count: 10 })).toBeNull();
expect(normalizeRating({ average: 4.5, count: 0 })).toBeNull();
expect(normalizeRating({ average: Number.NaN, count: 10 })).toBeNull();
expect(normalizeRating(null)).toBeNull();

expect(formatRatingAverage(4)).toBe('4.0');
expect(formatRatingAverage(4.55)).toBe('4.6');
expect(formatRatingCount(999)).toBe('999');
expect(formatRatingCount(1000)).toBe('1K');
expect(formatRatingCount(1200)).toBe('1.2K');
expect(formatRatingCount(15000)).toBe('15K');
expect(formatRatingCount(999999)).toBe('999.9K');
expect(formatRatingCount(1000000)).toBe('1M');
expect(formatRatingCount(1250000)).toBe('1.2M');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/content-card-helpers.test.ts`

Expected: FAIL because `src/components/public/content-card.ts` does not exist.

- [ ] **Step 3: Implement the helpers**

- `normalizeSafeUrl`: trim; accept root-relative paths starting with a single `/`; accept only `http:`/`https:` absolute URLs; reject everything else.
- `normalizeRating`: require finite `average` in `(0, 5]` and finite `count > 0`; floor the count.
- `formatRatingAverage`: `toFixed(1)`.
- `formatRatingCount`: integers below 1000 unchanged; thousands and millions use one decimal with a trailing `.0` removed, floored (not rounded up).

- [ ] **Step 4: Run the helper tests**

Run: `npx vitest run tests/unit/components/content-card-helpers.test.ts`

Expected: PASS.

---

### Task 3: `ContentCard` and `ContentPoster` (TDD)

**Files:**
- Create: `tests/unit/components/content-card.test.tsx`
- Create: `src/components/public/ContentPoster.tsx`
- Create: `src/components/public/ContentCard.tsx`

**Interfaces:**
- Consumes: all helpers and types from Task 2.
- Produces: `ContentCard(props: ContentCardProps): JSX.Element` and `ContentPoster({ src }: { src: string | null }): JSX.Element`.

- [ ] **Step 1: Write failing component tests**

At the top of the test file:
```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContentCard } from '@/components/public/ContentCard';

afterEach(cleanup);
```

Cover:
- Drama renders title, `Drama` type text, poster `<img>` with empty `alt`, card classes `w-full` and `min-w-0`, poster `aspect-[2/3]`.
- Movie renders `Movie` type text and no status badge.
- Missing, null, empty, and invalid poster render `[data-slot="content-poster-placeholder"]` and no `<img>`.
- `fireEvent.error` on a rendered image removes the image and shows the placeholder.
- Valid `href` renders a link with that `href`; missing/invalid `href` renders no link.
- Valid rating renders `4.5 (1.2K)` and the screen-reader text; absent/null/zero-count/invalid ratings render no star or rating text.
- Each drama status renders its label; absent status renders none; `kind="movie"` with `status="ongoing"` renders no status.
- The title is an `h3` accessible by heading role.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/content-card.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement `ContentPoster`**

Client component (`"use client"`). Track the failed source string, not a boolean, so a new `src` retries. Render a plain `<img src alt="" loading="lazy" decoding="async" onError={...}>` inside a `data-slot="content-poster"` container with `relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-border/70 bg-muted`. Placeholder uses `data-slot="content-poster-placeholder"`, `aria-hidden="true"`, muted radial background, and a `Film` icon.

- [ ] **Step 4: Implement `ContentCard`**

Server component. Normalize poster/href/rating through Task 2 helpers. Resolve status only when `kind === 'drama'`. Render:
- `<article>` root with `group flex w-full min-w-0 flex-col gap-3` plus `className`.
- Optional status badge absolutely positioned top-left over the poster.
- `<h3>` title with `line-clamp-2 text-sm font-medium leading-snug text-foreground`.
- Metadata row with muted type text, a decorative separator, and the rating group.
- Star icon `aria-hidden`; visible abbreviation `aria-hidden`; `sr-only` full label `Rated 4.5 out of 5 from 1200 ratings`.
- When `href` is valid, wrap the body in Next `Link` with visible focus ring classes; otherwise keep the non-interactive article.

- [ ] **Step 5: Run the component tests**

Run: `npx vitest run tests/unit/components/content-card.test.tsx`

Expected: PASS. If Next `Link` fails without router context, mock `next/link` to render an `<a href={href}>`; otherwise keep the real component.

- [ ] **Step 6: Run the full unit suite**

Run: `npm test`

Expected: all unit tests pass.

---

### Task 4: Documentation, verification, and Git

**Files:**
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/development/testing-conventions.md`

- [ ] **Step 1: Document component testing**

Add a short subsection to `docs/development/testing-conventions.md`: component tests live under `tests/unit/components/`, use `.test.tsx`, opt into jsdom with the per-file annotation, use RTL for user-observable behavior, and clean up after each test.

- [ ] **Step 2: Update status and changelog**

Set Current Prompt to 046 and add the Prompt 046 row to `PROJECT_STATUS.md`. Add a `0.4.6` changelog entry describing the card, poster fallback, optional link/rating/status contract, and test tooling.

- [ ] **Step 3: Run the completion checks**

Run, in order:
```
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
```

Expected: all pass. Report any pre-existing failure separately from Prompt 046 regressions.

- [ ] **Step 4: Review the diff and commit**

- Confirm no `.env`, credentials, or test artifacts are staged.
- Commit the pre-existing documentation edits first (`docs: sync project status and testing protocol`).
- Commit Prompt 046 separately (`feat: add shared content cards (Prompt 046)`).

- [ ] **Step 5: Push**

Push both commits to the configured remote and verify the result.
