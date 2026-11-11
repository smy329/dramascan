# Shared Loading and Empty States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add reusable, accessible skeleton, loading, empty, and retry state components under `src/components/states/` for later use by public and admin interfaces.

**Architecture:** Presentational server components by default, with one client island (`RetryButton`) for interactive retries. Skeletons are always decorative; a single `SkeletonGroup` owns the loading announcement. Components use existing semantic tokens and impose no page layout.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS v4, lucide-react, Vitest, React Testing Library, jsdom, Playwright (regression only).

**Spec:** `docs/superpowers/specs/2026-11-11-shared-loading-empty-states-design.md`

## Global Constraints

- Scope is primitives only: no page, route, admin shell, `loading.tsx`, `error.tsx`, or `src/components/ui/**` changes.
- Do not modify or migrate the existing `Layout.EmptyState`.
- No new runtime or dev dependencies.
- No data fetching, services, stores, or domain imports.
- Six component files plus one internal helper (`heading.ts`); no barrel `index.ts`.
- Direct imports from `@/components/states/<file>`.
- Only `retry-button.tsx` may start with `'use client'`.
- Use semantic tokens only: `background`, `foreground`, `card`, `muted`, `muted-foreground`, `border`, `destructive`, `primary`, `ring`. No hex values.
- Every animated element includes `motion-reduce:animate-none`.
- Component tests: `// @vitest-environment jsdom`, RTL, `cleanup` in `afterEach`, `fireEvent` (no `user-event`).
- `no-extra-parens` lint rule: use render helpers or early returns, not parenthesised conditional JSX.
- Project convention: one commit for the whole micro-prompt; do not commit after each task.
- Do not push until the user approves.

## File Structure

```
src/components/states/
  heading.ts                 HeadingLevel type + resolveHeadingTag helper (internal)
  skeleton.tsx               Skeleton + SkeletonGroup
  content-card-skeleton.tsx  ContentCardSkeleton
  loading-indicator.tsx      LoadingIndicator
  empty-state.tsx            EmptyState
  retry-state.tsx            RetryState (server-compatible)
  retry-button.tsx           RetryButton ("use client")

tests/unit/components/
  skeleton.test.tsx
  content-card-skeleton.test.tsx
  loading-indicator.test.tsx
  empty-state.test.tsx
  retry-state.test.tsx
  retry-boundary.test.ts
```

## Review Focus

- `SkeletonGroup` with many children must produce exactly one status announcement; bones must not appear in the accessibility tree.
- `RetryButton` clicked while retrying or disabled must not call `onRetry` again.
- `headingLevel` omitted or out of range (for example `9` from untyped JS) must render `h2`, never an undefined tag.
- `EmptyState` and `RetryState` with no description or children must render no empty paragraph and no action container.
- `LoadingIndicator` and `RetryButton` under reduced motion must carry `motion-reduce:animate-none` and stop spinning.

---

### Task 1: Skeleton family

**Files:**
- Create: `tests/unit/components/skeleton.test.tsx`
- Create: `src/components/states/skeleton.tsx`

**Interfaces:**
- Produces: `SkeletonVariant = 'text' | 'circle' | 'rectangle'`
- Produces: `SkeletonProps = { variant?: SkeletonVariant; className?: string }`
- Produces: `SkeletonGroupProps = { label?: string; className?: string; children: ReactNode }`
- Produces: `Skeleton(props): JSX.Element` and `SkeletonGroup(props): JSX.Element`

- [x] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { Skeleton, SkeletonGroup } from '@/components/states/skeleton';

afterEach(cleanup);

describe('Skeleton', () => {
  it('defaults to a text line, is decorative, and merges className', () => {
    const { container } = render(<Skeleton className="w-24" />);
    const bone = container.querySelector('[data-slot="skeleton"]');

    expect(bone?.getAttribute('aria-hidden')).toBe('true');
    expect(bone?.className).toContain('animate-pulse');
    expect(bone?.className).toContain('motion-reduce:animate-none');
    expect(bone?.className).toContain('h-4');
    expect(bone?.className).toContain('w-24');
  });

  it.each([
    ['circle', 'rounded-full'],
    ['rectangle', 'rounded-xl'],
  ] as const)('renders the %s variant', (variant, shape) => {
    const { container } = render(<Skeleton variant={variant} />);
    expect(container.querySelector('[data-slot="skeleton"]')?.className).toContain(shape);
  });
});

describe('SkeletonGroup', () => {
  it('announces once for many decorative children', () => {
    const { container } = render(
      <SkeletonGroup>
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </SkeletonGroup>
    );

    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.getAttribute('aria-live')).toBe('polite');
    expect(statuses[0]?.textContent).toBe('Loading content');

    for (const bone of container.querySelectorAll('[data-slot="skeleton"]')) {
      expect(bone.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('accepts a custom announcement label', () => {
    render(
      <SkeletonGroup label="Loading dramas">
        <Skeleton />
      </SkeletonGroup>
    );

    expect(screen.getByRole('status').textContent).toBe('Loading dramas');
  });

  it('does not impose its own grid or flex layout', () => {
    render(
      <SkeletonGroup>
        <Skeleton />
      </SkeletonGroup>
    );

    expect(screen.getByRole('status').className).not.toContain('grid');
    expect(screen.getByRole('status').className).not.toContain('flex');
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/skeleton.test.tsx`

Expected: FAIL because `src/components/states/skeleton.tsx` and `content-card-skeleton.tsx` do not exist.

- [x] **Step 3: Implement `src/components/states/skeleton.tsx`**

Use `import type { JSX, ReactNode } from 'react'` and `cn` from `@/lib/utils`.

`Skeleton` root:

```tsx
<div
  data-slot="skeleton"
  aria-hidden="true"
  className={cn('animate-pulse bg-muted motion-reduce:animate-none', VARIANT_CLASSES[variant], className)}
/>
```

Variant classes:

- `text` (default): `h-4 w-full rounded`
- `circle`: `size-10 shrink-0 rounded-full`
- `rectangle`: `h-24 w-full rounded-xl`

`SkeletonGroup` root:

```tsx
<div data-slot="skeleton-group" role="status" aria-live="polite" className={className}>
  <span className="sr-only">{label}</span>
  {children}
</div>
```

Default `label` is `'Loading content'`. Do not add grid, flex, gap, or width classes. `SkeletonGroup` is exported from this same file; no separate group file.

- [x] **Step 4: Run the skeleton tests**

Run: `npx vitest run tests/unit/components/skeleton.test.tsx`

Expected: PASS.

---

### Task 2: Content-card skeleton

**Files:**
- Create: `tests/unit/components/content-card-skeleton.test.tsx`
- Create: `src/components/states/content-card-skeleton.tsx`

**Interfaces:**
- Consumes: `Skeleton` from `@/components/states/skeleton`
- Produces: `ContentCardSkeletonProps = { className?: string }`
- Produces: `ContentCardSkeleton(props): JSX.Element`

- [x] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ContentCardSkeleton } from '@/components/states/content-card-skeleton';
import { SkeletonGroup } from '@/components/states/skeleton';

afterEach(cleanup);

describe('ContentCardSkeleton', () => {
  it('is decorative and mirrors the content card dimensions', () => {
    const { container } = render(<ContentCardSkeleton />);
    const root = container.querySelector('[data-slot="content-card-skeleton"]');
    const poster = container.querySelector('[data-slot="content-card-skeleton-poster"]');

    expect(root?.getAttribute('aria-hidden')).toBe('true');
    expect(root?.className).toContain('w-full');
    expect(root?.className).toContain('min-w-0');
    expect(poster?.className).toContain('aspect-[2/3]');
    expect(poster?.className).toContain('rounded-xl');
    expect(poster?.className).toContain('animate-pulse');
    expect(poster?.className).toContain('motion-reduce:animate-none');
  });

  it('renders three text bones and no semantic content', () => {
    const { container } = render(<ContentCardSkeleton />);

    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
    expect(container.querySelector('h1,h2,h3,h4,h5,h6')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('merges className', () => {
    const { container } = render(<ContentCardSkeleton className="w-40" />);
    expect(container.querySelector('[data-slot="content-card-skeleton"]')?.className).toContain(
      'w-40'
    );
  });

  it('does not create per-card announcements inside a group', () => {
    render(
      <SkeletonGroup>
        <ContentCardSkeleton />
        <ContentCardSkeleton />
      </SkeletonGroup>
    );

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('Loading content');
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/content-card-skeleton.test.tsx`

Expected: FAIL because the component does not exist.

- [x] **Step 3: Implement `src/components/states/content-card-skeleton.tsx`**

Root: `flex w-full min-w-0 flex-col gap-3` plus `className`, `data-slot="content-card-skeleton"`, `aria-hidden="true"`.

Poster: `div` with `data-slot="content-card-skeleton-poster"` and classes `aspect-[2/3] w-full animate-pulse rounded-xl border border-border/70 bg-muted motion-reduce:animate-none`.

Metadata block: `div` with `min-w-0 space-y-1.5` containing:

- `<Skeleton variant="text" className="w-4/5" />`
- `<Skeleton variant="text" className="w-3/5" />`
- `<Skeleton variant="text" className="h-3 w-20" />`

- [x] **Step 4: Run the card-skeleton tests and the skeleton family tests**

Run: `npx vitest run tests/unit/components/content-card-skeleton.test.tsx tests/unit/components/skeleton.test.tsx`

Expected: PASS. The earlier `SkeletonGroup` tests now resolve `ContentCardSkeleton`.

---

### Task 3: Loading indicator

**Files:**
- Create: `tests/unit/components/loading-indicator.test.tsx`
- Create: `src/components/states/loading-indicator.tsx`

**Interfaces:**
- Produces: `LoadingIndicatorVariant = 'inline' | 'block'`
- Produces: `LoadingIndicatorSize = 'sm' | 'md' | 'lg'`
- Produces: `LoadingIndicatorProps = { variant?; size?; label?; className? }`
- Produces: `LoadingIndicator(props): JSX.Element`

- [x] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LoadingIndicator } from '@/components/states/loading-indicator';

afterEach(cleanup);

describe('LoadingIndicator', () => {
  it('renders one polite status region with a hidden spinner', () => {
    render(<LoadingIndicator />);

    const status = screen.getByRole('status');
    const spinner = status.querySelector('svg');

    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.querySelector('.sr-only')?.textContent).toBe('Loading');
    expect(spinner?.getAttribute('aria-hidden')).toBe('true');
    expect(spinner?.getAttribute('class')).toContain('animate-spin');
    expect(spinner?.getAttribute('class')).toContain('motion-reduce:animate-none');
  });

  it('supports a custom accessible label', () => {
    render(<LoadingIndicator label="Loading episodes" />);
    expect(screen.getByRole('status').textContent).toBe('Loading episodes');
  });

  it('applies the inline layout by default', () => {
    render(<LoadingIndicator />);
    expect(screen.getByRole('status').className).toContain('inline-flex');
  });

  it('applies the block layout', () => {
    render(<LoadingIndicator variant="block" />);
    const status = screen.getByRole('status');
    expect(status.className).toContain('flex');
    expect(status.className).toContain('py-8');
  });

  it.each([
    ['sm', 'size-4'],
    ['md', 'size-5'],
    ['lg', 'size-6'],
  ] as const)('renders the %s spinner size', (size, expected) => {
    render(<LoadingIndicator size={size} />);
    expect(screen.getByRole('status').querySelector('svg')?.getAttribute('class')).toContain(
      expected
    );
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/loading-indicator.test.tsx`

Expected: FAIL because the component does not exist.

- [x] **Step 3: Implement `src/components/states/loading-indicator.tsx`**

Import `Loader2` from `lucide-react`. Root `div`:

```tsx
<div
  data-slot="loading-indicator"
  role="status"
  aria-live="polite"
  className={cn(LAYOUT_CLASSES[variant], className)}
>
  <Loader2 aria-hidden="true" className={cn('animate-spin motion-reduce:animate-none', SIZE_CLASSES[size])} />
  <span className="sr-only">{label}</span>
</div>
```

- Layout: `inline` → `inline-flex items-center gap-2`; `block` → `flex w-full flex-col items-center justify-center gap-2 py-8`.
- Sizes: `sm` → `size-4`; `md` → `size-5`; `lg` → `size-6`.
- Defaults: `variant="inline"`, `size="md"`, `label="Loading"`.
- Render the label only as `sr-only` text; do not add a second visible label.

- [x] **Step 4: Run the loading-indicator tests**

Run: `npx vitest run tests/unit/components/loading-indicator.test.tsx`

Expected: PASS.

---

### Task 4: Empty state

**Files:**
- Create: `tests/unit/components/empty-state.test.tsx`
- Create: `src/components/states/heading.ts`
- Create: `src/components/states/empty-state.tsx`

**Interfaces:**
- Produces (from `heading.ts`): `HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6`
- Produces (from `heading.ts`): `resolveHeadingTag(level?: HeadingLevel): 'h1' | ... | 'h6'`
- Produces: `EmptyStateProps = { icon: LucideIcon; title: string; description?: string; children?: ReactNode; headingLevel?: HeadingLevel; className?: string }`
- Produces: `EmptyState(props): JSX.Element`

- [x] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Clapperboard } from 'lucide-react';

import { EmptyState } from '@/components/states/empty-state';
import type { HeadingLevel } from '@/components/states/heading';

afterEach(cleanup);

describe('EmptyState', () => {
  it('renders an h2 title by default with a decorative icon', () => {
    const { container } = render(
      <EmptyState icon={Clapperboard} title="Nothing here" description="Come back later." />
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Nothing here' })).toBeTruthy();
    expect(screen.getByText('Come back later.')).toBeTruthy();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it.each([1, 3, 4, 5, 6] as const)('renders an h%i for headingLevel', level => {
    render(<EmptyState icon={Clapperboard} title="Nothing here" headingLevel={level} />);
    expect(screen.getByRole('heading', { level, name: 'Nothing here' })).toBeTruthy();
  });

  it('falls back to h2 for an out-of-range level', () => {
    render(
      <EmptyState icon={Clapperboard} title="Nothing here" headingLevel={9 as HeadingLevel} />
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Nothing here' })).toBeTruthy();
  });

  it('omits the description and action slot when they are not supplied', () => {
    const { container } = render(<EmptyState icon={Clapperboard} title="Nothing here" />);

    expect(container.querySelector('p')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders an action in the children slot and merges className', () => {
    const { container } = render(
      <EmptyState icon={Clapperboard} title="Nothing here" className="max-w-md">
        <a href="/browse">Browse dramas</a>
      </EmptyState>
    );

    expect(screen.getByRole('link', { name: 'Browse dramas' }).getAttribute('href')).toBe(
      '/browse'
    );
    expect(container.querySelector('[data-slot="empty-state"]')?.className).toContain('max-w-md');
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/empty-state.test.tsx`

Expected: FAIL because the component and heading helper do not exist.

- [x] **Step 3: Implement `src/components/states/heading.ts`**

```ts
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

const HEADING_TAGS: Record<number, HeadingTag> = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
};

export function resolveHeadingTag(level?: HeadingLevel): HeadingTag {
  return HEADING_TAGS[level ?? 2] ?? 'h2';
}
```

- [x] **Step 4: Implement `src/components/states/empty-state.tsx`**

Import `type { LucideIcon }` from `lucide-react`, `type { JSX, ReactNode }` from `react`, `cn`, and `resolveHeadingTag`.

Root: `data-slot="empty-state"`, classes `flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 px-6 py-14 text-center` plus `className`.

Icon wrapper: `flex size-12 items-center justify-center rounded-full border border-border bg-secondary text-muted-foreground`; icon renders with `aria-hidden="true"` and `size-5`.

Title: `const Heading = resolveHeadingTag(headingLevel)` and `<Heading className="mt-5 text-base font-medium text-foreground">{title}</Heading>`.

Description: render `<p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">` only when `description` is supplied.

Action: render `<div className="mt-6">{children}</div>` only when `children` is supplied.

- [x] **Step 5: Run the empty-state tests**

Run: `npx vitest run tests/unit/components/empty-state.test.tsx`

Expected: PASS.

---

### Task 5: Retry state and retry button

**Files:**
- Create: `tests/unit/components/retry-state.test.tsx`
- Create: `tests/unit/components/retry-boundary.test.ts`
- Create: `src/components/states/retry-state.tsx`
- Create: `src/components/states/retry-button.tsx`

**Interfaces:**
- Consumes: `HeadingLevel`, `resolveHeadingTag` from `@/components/states/heading`
- Consumes: `buttonVariants` from `@/components/ui/button`
- Produces: `RetryStateProps = { title: string; description?: string; children?: ReactNode; icon?: LucideIcon; headingLevel?: HeadingLevel; className?: string }`
- Produces: `RetryState(props): JSX.Element`
- Produces: `RetryButtonProps = { onRetry: () => void; isRetrying?: boolean; label?: string; retryingLabel?: string; disabled?: boolean; className?: string }`
- Produces: `RetryButton(props): JSX.Element`

- [x] **Step 1: Write the failing retry-state tests**

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AlertTriangle } from 'lucide-react';

import { RetryState } from '@/components/states/retry-state';
import { RetryButton } from '@/components/states/retry-button';
import type { HeadingLevel } from '@/components/states/heading';

afterEach(cleanup);

describe('RetryState', () => {
  it('renders an alert with title, description, decorative icon, and action', () => {
    const { container } = render(
      <RetryState title="Could not load dramas" description="Check your connection and try again.">
        <a href="/drama">Try again</a>
      </RetryState>
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Could not load dramas' })).toBeTruthy();
    expect(screen.getByText('Check your connection and try again.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe('/drama');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('accepts a custom icon and heading level', () => {
    render(
      <RetryState title="Could not load" icon={AlertTriangle} headingLevel={3} />
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Could not load' })).toBeTruthy();
  });

  it('falls back to h2 for an out-of-range level', () => {
    render(<RetryState title="Could not load" headingLevel={9 as HeadingLevel} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Could not load' })).toBeTruthy();
  });
});

describe('RetryButton', () => {
  it('renders its label and calls onRetry once', () => {
    const onRetry = vi.fn();
    render(<RetryButton onRetry={onRetry} />);

    const button = screen.getByRole('button', { name: 'Try again' });
    fireEvent.click(button);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables while retrying, announces feedback, and blocks duplicate clicks', () => {
    const onRetry = vi.fn();
    render(<RetryButton onRetry={onRetry} isRetrying />);

    const button = screen.getByRole('button', { name: 'Retrying…' }) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.querySelector('svg')?.getAttribute('class')).toContain(
      'motion-reduce:animate-none'
    );
    expect(screen.getByRole('status').textContent).toBe('Retrying…');

    fireEvent.click(button);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('does not call onRetry while the disabled prop is set', () => {
    const onRetry = vi.fn();
    render(<RetryButton onRetry={onRetry} disabled />);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('becomes clickable again after retrying completes', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<RetryButton onRetry={onRetry} isRetrying />);

    rerender(<RetryButton onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('supports custom labels', () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <RetryButton onRetry={onRetry} label="Reload" isRetrying={false} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    rerender(<RetryButton onRetry={onRetry} label="Reload" retryingLabel="Reloading…" isRetrying />);

    expect(screen.getByRole('button', { name: 'Reloading…' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Reloading…');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
```

- [x] **Step 2: Write the failing boundary tests**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(file: string): string {
  return readFileSync(new URL(`../../../src/components/states/${file}`, import.meta.url), 'utf8');
}

describe('state component server/client boundaries', () => {
  it('keeps RetryState server-compatible', () => {
    expect(source('retry-state.tsx').trimStart().startsWith("'use client'")).toBe(false);
  });

  it('keeps RetryButton a client island', () => {
    expect(source('retry-button.tsx').trimStart().startsWith("'use client'")).toBe(true);
  });
});
```

- [x] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/retry-state.test.tsx tests/unit/components/retry-boundary.test.ts`

Expected: FAIL because both components do not exist.

- [x] **Step 4: Implement `src/components/states/retry-state.tsx`**

No `'use client'`. Import `AlertTriangle` and `type { LucideIcon }` from `lucide-react`, `type { JSX, ReactNode }` from `react`, `resolveHeadingTag`, and `cn`.

Root: `data-slot="retry-state"`, `role="alert"`, classes `flex flex-col items-center justify-center rounded-xl border border-destructive/40 bg-destructive/5 px-6 py-14 text-center` plus `className`.

Icon wrapper: `flex size-12 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-destructive`; icon defaults to `AlertTriangle`, renders `aria-hidden="true"` and `size-5`.

Title, description, and action spacing match `EmptyState` (`mt-5`, `mt-2 max-w-sm`, `mt-6`). Render description and action only when supplied.

- [x] **Step 5: Implement `src/components/states/retry-button.tsx`**

Start with `'use client'`.

Use a native `<button type="button" data-slot="retry-button">` with `buttonVariants({ variant: 'default', size: 'default' })` plus `className`.

- Defaults: `isRetrying = false`, `label = 'Try again'`, `retryingLabel = 'Retrying…'`, `disabled = false`.
- `disabled={disabled || isRetrying}`.
- Click handler returns early when `isRetrying`, else calls `onRetry`.
- While retrying: render `Loader2` with `aria-hidden="true"` and `animate-spin motion-reduce:animate-none`; visible text is `retryingLabel`; `aria-busy={isRetrying ? true : undefined}`.
- Render a sibling `<span role="status" aria-live="polite" className="sr-only">{retryingLabel}</span>` only while retrying.
- When idle: visible text is `label`; no status region.

- [x] **Step 6: Run the retry tests**

Run: `npx vitest run tests/unit/components/retry-state.test.tsx tests/unit/components/retry-boundary.test.ts`

Expected: PASS.

---

### Task 6: Documentation, verification, and commit

**Files:**
- Create: `docs/development/state-components.md`
- Modify: `docs/README.md`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/CHANGELOG.md`

- [x] **Step 1: Write `docs/development/state-components.md`**

Include:

- Purpose and scope (primitives only; no page wiring yet).
- File map and direct-import examples.
- API tables for `Skeleton`, `SkeletonGroup`, `ContentCardSkeleton`, `LoadingIndicator`, `EmptyState`, `RetryState`, `RetryButton`.
- Accessibility contract: bones `aria-hidden`; one `role="status"` per loading group; `role="alert"` for retry errors; keyboard-operable native retry button; reduced-motion handling.
- Server/client boundary: `RetryState` is server-compatible; `RetryButton` is the only client island. Server Components must not pass ordinary callbacks to `RetryButton`; use a client wrapper or a Server Action.
- Usage examples:
  - server empty state with a link action;
  - server retry state with a link action;
  - client retry wrapper with `RetryButton`;
  - skeleton grid composed with `.map()`;
  - block loading indicator.
- Migration note: `Layout.EmptyState` is intentionally unchanged; the shared `EmptyState` keeps the same core props and adds optional `description`, `headingLevel`, and `className`.

- [x] **Step 2: Update the documentation index**

Add `[State Components](development/state-components.md)` to the Quick Links in `docs/README.md`.

- [x] **Step 3: Update project status and changelog**

- `docs/PROJECT_STATUS.md`: set `**Current Prompt:** 047 — Create Shared Loading and Empty States` and add a Prompt 047 row with changed files, commands, and a short description.
- `docs/CHANGELOG.md`: add `## [0.4.7] - 2026-11-11` above `0.4.6`, describing the components, accessibility contract, server/client boundary, and verification results.

- [x] **Step 4: Run the full verification gate**

Run, in order:

```
npm run typecheck
npm run lint
npm test
npm run test:integration
```

Then run the production build with the existing production-shaped environment workaround:

```
node "C:\Users\User\AppData\Local\Temp\opencode\dramascan-build.mjs"
```

Then free port 3000 if needed and run the regression E2E suite:

```
npm run test:e2e
```

Expected: all pass. Report pre-existing failures (for example main-database migration warnings) separately from Prompt 047 regressions.

- [x] **Step 5: Review the diff**

Run:

```
git status --short
git diff
git diff --check
```

Confirm no `.env` files, credentials, build artifacts, or unrelated page changes are staged. Confirm only the new state components, tests, and documentation changed.

- [x] **Step 6: Commit**

```
git add src/components/states tests/unit/components docs/development/state-components.md docs/README.md docs/PROJECT_STATUS.md docs/CHANGELOG.md docs/superpowers
git commit -m "feat: add shared loading and empty states (Prompt 047)"
```

Do not push until the user approves. After approval, push and verify the result.
