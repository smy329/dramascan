# Shared Loading and Empty States — Design

**Prompt:** 047 — Create Shared Loading and Empty States
**Date:** 2026-11-11
**Status:** Proposed — awaiting approval

## 1. Goal

Add reusable, accessible, presentational state components that public and admin
interfaces can compose later:

- `Skeleton` — token-based decorative placeholder primitive.
- `SkeletonGroup` — owns one loading announcement for a group of skeletons.
- `ContentCardSkeleton` — loading counterpart of `ContentCard`, with the same
  2:3 poster and metadata rhythm to minimise layout shift.
- `LoadingIndicator` — inline or block spinner with a live-region announcement.
- `EmptyState` — "nothing to show" block with an optional action slot.
- `RetryState` — "operation failed" block with `role="alert"` and an action slot.
- `RetryButton` — client island for interactive retries.

This prompt is deliberately limited to the primitives. It does not wire them
into pages, does not add route boundaries, and does not migrate the existing
public `EmptyState`.

## 2. Confirmed Decisions

| Decision              | Choice                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| Scope                 | Shared primitives only                                                 |
| Location              | `src/components/states/`, direct file imports, no barrel               |
| Skeleton surface      | `Skeleton`, `SkeletonGroup`, `ContentCardSkeleton`                     |
| Loading indicator     | One component, `variant="inline" \| "block"`, configurable size/label  |
| Retry architecture    | Server-compatible `RetryState` shell + separate `RetryButton` island   |
| Empty state API       | Mirror existing `Layout.EmptyState` + optional `headingLevel`          |
| Skeleton accessibility| Bones always `aria-hidden`; `SkeletonGroup` owns the single announcement |

## 3. Non-Goals

- No changes to `src/app/**`, public pages, admin pages, or `src/components/ui/**`.
- No migration of the existing `Layout.EmptyState` usages.
- No `loading.tsx`, `error.tsx`, `not-found.tsx`, or admin shell.
- No data fetching, services, stores, or route changes.
- No new runtime or dev dependencies.
- No `TableSkeleton` or `FormSkeleton` in this prompt.
- No Next.js image optimisation or Sharp.

## 4. File Layout

```
src/components/states/
  skeleton.tsx               Skeleton + SkeletonGroup
  content-card-skeleton.tsx  ContentCardSkeleton
  loading-indicator.tsx      LoadingIndicator
  empty-state.tsx            EmptyState
  retry-state.tsx            RetryState (server-compatible)
  retry-button.tsx           RetryButton ("use client")
```

Two notes on the file list, both consequences of the approved APIs:

1. `RetryButton` must live in its own `"use client"` module. Putting
   `"use client"` on `retry-state.tsx` would make `RetryState` a client
   component, which the approved requirement forbids.
2. `SkeletonGroup` shares `skeleton.tsx` with `Skeleton`, because the approved
   file list names `skeleton.tsx` and does not include a separate group file.
   Import both from `@/components/states/skeleton`. If a separate
   `skeleton-group.tsx` is preferred, say so at approval.

Imports are direct, for example:

```ts
import { Skeleton, SkeletonGroup } from '@/components/states/skeleton';
import { EmptyState } from '@/components/states/empty-state';
```

No barrel `index.ts` is added.

## 5. Component APIs

### 5.1 `Skeleton`

```ts
export type SkeletonVariant = 'text' | 'circle' | 'rectangle';

export type SkeletonProps = Readonly<{
  variant?: SkeletonVariant; // default 'text'
  className?: string;
}>;
```

- Root `div` with `data-slot="skeleton"` and `aria-hidden="true"`.
- Base classes: `animate-pulse bg-muted motion-reduce:animate-none`.
- Variant classes:
  - `text` (default): `h-4 w-full rounded`
  - `circle`: `size-10 shrink-0 rounded-full`
  - `rectangle`: `h-24 w-full rounded-xl`
- `className` merges last and may override dimensions (the project uses `cn`,
  a Tailwind-merge drop-in).
- Never renders text, roles, or labels.

### 5.2 `SkeletonGroup`

```ts
export type SkeletonGroupProps = Readonly<{
  label?: string; // default 'Loading content'
  className?: string;
  children: ReactNode;
}>;
```

- Root `div` with `data-slot="skeleton-group"`, `role="status"`,
  `aria-live="polite"`, and the caller's `className`.
- Renders exactly one `<span className="sr-only">{label}</span>` followed by
  `children`.
- Does not impose grid, flex, gap, or width. Consumers compose grids with
  `.map()`.
- Because bones are `aria-hidden`, the status region announces only the group
  label, once.

### 5.3 `ContentCardSkeleton`

```ts
export type ContentCardSkeletonProps = Readonly<{
  className?: string;
}>;
```

- Root `div` with `data-slot="content-card-skeleton"` and `aria-hidden="true"`,
  classes `flex w-full min-w-0 flex-col gap-3` plus `className`.
- Poster block: `aspect-[2/3] w-full animate-pulse rounded-xl border
  border-border/70 bg-muted motion-reduce:animate-none`, mirroring
  `ContentPoster`'s aspect and rounded border.
- Metadata block: `min-w-0 space-y-1.5` containing three `Skeleton` text lines:
  title at `w-4/5`, title at `w-3/5`, metadata at `h-3 w-20`.
- Decorative only: no labels, no status region, no `aria-hidden` overrides
  exposed to callers.

### 5.4 `LoadingIndicator`

```ts
export type LoadingIndicatorVariant = 'inline' | 'block';
export type LoadingIndicatorSize = 'sm' | 'md' | 'lg';

export type LoadingIndicatorProps = Readonly<{
  variant?: LoadingIndicatorVariant; // default 'inline'
  size?: LoadingIndicatorSize;       // default 'md'
  label?: string;                    // default 'Loading'
  className?: string;
}>;
```

- Root `div` with `data-slot="loading-indicator"`, `role="status"`, and
  `aria-live="polite"`.
- `inline`: `inline-flex items-center gap-2`.
- `block`: `flex w-full flex-col items-center justify-center gap-2 py-8`.
- Spinner: `Loader2` from `lucide-react`, `aria-hidden="true"`, classes
  `animate-spin motion-reduce:animate-none`.
- Sizes: `sm` → `size-4`, `md` → `size-5`, `lg` → `size-6`.
- Label is always rendered as `<span className="sr-only">{label}</span>`, so the
  announcement is textual and the spinner is not announced twice.
- No visible label duplication. Visual loading is conveyed by the spinner.

### 5.5 `EmptyState`

```ts
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type EmptyStateProps = Readonly<{
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;      // action slot
  headingLevel?: HeadingLevel; // default 2
  className?: string;
}>;
```

- Root `div` with `data-slot="empty-state"`, classes `flex flex-col
  items-center justify-center rounded-xl border border-dashed border-border
  bg-card/40 px-6 py-14 text-center` plus `className`.
- Icon wrapper: `flex size-12 items-center justify-center rounded-full border
  border-border bg-secondary text-muted-foreground`; the icon is
  `aria-hidden="true"` and `size-5`.
- Title renders the element mapped from `headingLevel` (`h1`–`h6`) with `mt-5
  text-base font-medium text-foreground`.
- Description renders only when supplied: `mt-2 max-w-sm text-sm
  leading-relaxed text-muted-foreground`.
- Action slot renders only when `children` is supplied: `mt-6`.
- Props match the existing `Layout.EmptyState` (`icon`, `title`,
  `description`, `children`), with `description` now optional and `className`
  added. The existing component is untouched.

### 5.6 `RetryState` (server-compatible)

```ts
export type RetryStateProps = Readonly<{
  title: string;
  description?: string;
  children?: ReactNode;        // action slot
  icon?: LucideIcon;           // default AlertTriangle
  headingLevel?: HeadingLevel; // default 2
  className?: string;
}>;
```

- Root `div` with `data-slot="retry-state"` and `role="alert"`, classes `flex
  flex-col items-center justify-center rounded-xl border border-destructive/40
  bg-destructive/5 px-6 py-14 text-center` plus `className`.
- No `"use client"`, no hooks, no event handlers. Usable directly inside a
  Server Component.
- Icon wrapper mirrors `EmptyState` but uses the destructive tone: `border
  border-destructive/30 bg-destructive/10 text-destructive`.
- Title uses the mapped heading element; description and action slot match
  `EmptyState` spacing.
- The action slot is the only interactive surface. Server Components may pass a
  `<Link>`, a form with a Server Action, or a `<RetryButton>` rendered by a
  Client Component wrapper. They must not pass an ordinary callback from a
  Server Component into a Client Component.

### 5.7 `RetryButton` (client island)

```ts
'use client';

export type RetryButtonProps = Readonly<{
  onRetry: () => void;
  isRetrying?: boolean;      // default false
  label?: string;            // default 'Try again'
  retryingLabel?: string;    // default 'Retrying…'
  disabled?: boolean;        // default false
  className?: string;
}>;
```

- Native `<button type="button">` styled with `buttonVariants({ variant:
  'default', size: 'default' })`; `className` merges last.
- `disabled={disabled || isRetrying}` stops duplicate submissions; the click
  handler also returns early while `isRetrying`.
- While retrying: spinner `Loader2` (`aria-hidden`, `animate-spin
  motion-reduce:animate-none`), visible text becomes `retryingLabel`, and the
  button gets `aria-busy="true"`.
- A sibling `<span role="status" aria-live="polite" className="sr-only">`
  renders `retryingLabel` only while retrying, so assistive technology receives
  explicit feedback.
- When idle: visible and accessible text is `label`; no status region.

## 6. Accessibility Contract

| Concern                        | Behaviour                                                        |
| ------------------------------ | ---------------------------------------------------------------- |
| Decorative skeletons           | `aria-hidden="true"` on every bone and on the card skeleton      |
| Group loading announcement     | One `role="status"` + `aria-live="polite"` + `sr-only` label     |
| Inline/block loading           | One `role="status"` region per instance, spinner hidden          |
| Empty state icon               | Decorative, `aria-hidden="true"`                                  |
| Empty state heading            | Semantic `h1`–`h6`, default `h2`                                  |
| Retry error announcement       | `role="alert"` on the container                                   |
| Retry action                   | Native button, keyboard operable, visible focus ring from styles  |
| Retry in progress              | `disabled`, `aria-busy="true"`, visible and sr-only feedback      |
| Reduced motion                 | `motion-reduce:animate-none` on every animated element            |
| Duplicate announcements        | Prevented by hiding bones and using one group status region       |

## 7. Visual and Token Rules

- Use only existing semantic tokens: `background`, `foreground`, `card`,
  `card-foreground`, `muted`, `muted-foreground`, `border`, `destructive`,
  `primary`, `ring`.
- Reuse the existing radii, spacing, and typography scale. No hard-coded hex
  values.
- Skeleton shimmer is `animate-pulse` on `bg-muted`; no gradients, images, or
  new keyframes.
- `ContentCardSkeleton` mirrors `ContentCard`: `rounded-xl`, `gap-3`,
  `aspect-[2/3]`, title/metadata line heights, and `min-w-0` behaviour.
- Respect the global reduced-motion rule and the explicit
  `motion-reduce:animate-none` utility.

## 8. Test Plan

All component tests live under `tests/unit/components/`, use `.test.tsx`, opt
into jsdom with `// @vitest-environment jsdom`, use React Testing Library, and
call `cleanup` in `afterEach`. No new test dependencies; retry clicks use
`fireEvent.click`.

### `skeleton.test.tsx`

- `Skeleton` defaults to the text variant and merges `className`.
- Each variant applies its shape/dimension classes.
- Every `Skeleton` has `aria-hidden="true"` and `data-slot="skeleton"`.
- `SkeletonGroup` renders exactly one `role="status"` with
  `aria-live="polite"`.
- Default label is `Loading content`; a custom label overrides it.
- Multiple `ContentCardSkeleton` children produce one status region total.
- The group does not add grid or flex layout classes of its own.

### `content-card-skeleton.test.tsx`

- Root is `aria-hidden="true"` and has `data-slot="content-card-skeleton"`.
- Poster block keeps `aspect-[2/3]`, `rounded-xl`, and `animate-pulse`.
- Three text bones render, at the expected widths.
- Root classes include `w-full` and `min-w-0`; `className` merges.
- No heading, image, link, or role is exposed.

### `loading-indicator.test.tsx`

- `role="status"` and `aria-live="polite"` are present in both variants.
- Default label is `Loading`; custom label renders in `sr-only` text.
- Spinner is `aria-hidden="true"`.
- `inline` and `block` apply their distinct layout classes.
- `sm`, `md`, and `lg` change the spinner size.
- `motion-reduce:animate-none` is present.
- `className` merges.

### `empty-state.test.tsx`

- Default title is an `h2`; `headingLevel` 1–6 renders the matching heading.
- Title, description, icon wrapper, and action slot render.
- Omitting `description` and `children` renders neither.
- The icon is decorative.
- `className` merges.

### `retry-state.test.tsx`

- `RetryState` has `role="alert"` and renders title/description/action.
- Default heading is `h2`; `headingLevel` changes it.
- The default icon is decorative; a custom icon renders.
- The action slot accepts a link without making the component interactive.
- Architecture guard: `retry-state.tsx` does not begin with `'use client'`, and
  `retry-button.tsx` does.
- `RetryButton` renders its label and calls `onRetry` once on click.
- `isRetrying` disables the button, sets `aria-busy="true"`, shows the spinner
  and retrying text, and emits one status announcement.
- Clicking while retrying or while `disabled` does not call `onRetry`.
- `onRetry` fires again after `isRetrying` returns to false.

## 9. Documentation Plan

- Add `docs/development/state-components.md`:
  - purpose and scope;
  - file map and import examples;
  - API tables for every component;
  - accessibility contract;
  - server/client boundary rules;
  - usage examples for a server page, a client retry, and a skeleton grid;
  - migration note for the existing `Layout.EmptyState`.
- Add the new document to `docs/README.md` quick links.
- Update `docs/PROJECT_STATUS.md` (Current Prompt 047 + row).
- Add `0.4.7` to `docs/CHANGELOG.md` after implementation.
- No changes to `docs/development/testing-conventions.md` unless a new pattern
  appears.

## 10. Verification Plan

Run, in order:

```
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run test:e2e
```

Notes:

- `npm run lint` enforces `no-extra-parens`; conditional JSX uses render helpers
  or early returns, not parenthesised `&&`/ternary bodies.
- The production build uses the existing production-shaped env workaround
  (`APP_URL`/`TRUSTED_ORIGINS` as HTTPS) and the repo's UTF-8 env loader.
- Playwright is regression only; this prompt adds no route.
- Pre-existing main-database migration warnings are reported separately and are
  not Prompt 047 regressions.

## 11. Git Plan

- One commit: `feat: add shared loading and empty states (Prompt 047)`.
- Review the diff for secrets and unrelated changes before committing.
- Do not push until the user approves, per the Prompt 047 instruction.

## 12. Risks and Mitigations

| Risk                                             | Mitigation                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| New `EmptyState` collides conceptually with the old one | Different module path; docs call out coexistence and migration |
| `role="alert"` fires for static error blocks     | Documented for post-failure rendering; static error pages may use `description` only |
| `role="status"` is not announced if present at initial load | Documented; the pattern targets states mounted after navigation or an operation |
| Skeleton bones announced individually            | Bones always `aria-hidden`; group owns one announcement           |
| Client boundary leak                             | `RetryState` has no `"use client"`; architecture guard test       |
| Reduced-motion spinner still animates            | Explicit `motion-reduce:animate-none` plus the global rule        |
