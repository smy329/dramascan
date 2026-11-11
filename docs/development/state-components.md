# Shared State Components

**Project:** DramaScan — International Drama & Movie Streaming Platform
**Version:** 1.0
**Date:** 2026-11-11

This document defines the shared skeleton, loading, empty, and retry components
created by Prompt 047. They are presentational primitives for later use by
public and admin interfaces. This prompt does not wire them into pages and does
not migrate the existing `Layout.EmptyState`.

---

## 1. Scope and Principles

- Located in `src/components/states/`.
- Direct file imports; there is no barrel `index.ts`.
- Server components by default. `RetryButton` is the only client island.
- No data fetching, services, stores, or domain imports.
- No page, route, `loading.tsx`, `error.tsx`, or `src/components/ui/**` changes.
- Every skeleton is decorative; loading announcements come from one status
  region.
- A failed operation must show `RetryState` and an action, never an indefinite
  loading state.

---

## 2. Files and Imports

| File                              | Exports                          | Client boundary |
| --------------------------------- | -------------------------------- | --------------- |
| `states/heading.ts`               | `HeadingLevel`, `HeadingTag`, `resolveHeadingTag` | Server |
| `states/skeleton.tsx`             | `Skeleton`, `SkeletonGroup`      | Server          |
| `states/content-card-skeleton.tsx`| `ContentCardSkeleton`            | Server          |
| `states/loading-indicator.tsx`    | `LoadingIndicator`               | Server          |
| `states/empty-state.tsx`          | `EmptyState`                     | Server          |
| `states/retry-state.tsx`          | `RetryState`                     | Server          |
| `states/retry-button.tsx`         | `RetryButton`                    | **Client**      |

```ts
import { Skeleton, SkeletonGroup } from '@/components/states/skeleton';
import { ContentCardSkeleton } from '@/components/states/content-card-skeleton';
import { LoadingIndicator } from '@/components/states/loading-indicator';
import { EmptyState } from '@/components/states/empty-state';
import { RetryState } from '@/components/states/retry-state';
import { RetryButton } from '@/components/states/retry-button';
```

---

## 3. Component APIs

### 3.1 `Skeleton`

Decorative placeholder bone. Never renders text, roles, or an accessible name.

| Prop        | Type                                  | Default  | Notes                              |
| ----------- | ------------------------------------- | -------- | ---------------------------------- |
| `variant`   | `'text' \| 'circle' \| 'rectangle'`   | `'text'` | Shape and default dimensions       |
| `className` | `string`                              | —        | Merged last; overrides dimensions  |

Variant defaults:

- `text`: `h-4 w-full rounded`
- `circle`: `size-10 shrink-0 rounded-full`
- `rectangle`: `h-24 w-full rounded-xl`

Every bone has `data-slot="skeleton"` and `aria-hidden="true"`.

```tsx
<Skeleton className="h-6 w-32" />
<Skeleton variant="circle" className="size-12" />
<Skeleton variant="rectangle" className="h-40 w-full" />
```

### 3.2 `SkeletonGroup`

Groups repeated skeletons and owns one loading announcement.

| Prop        | Type        | Default             | Notes                               |
| ----------- | ----------- | ------------------- | ----------------------------------- |
| `label`     | `string`    | `'Loading content'` | Announced once, rendered `sr-only`  |
| `className` | `string`    | —                   | Layout only; the group adds none    |
| `children`  | `ReactNode` | required            | Skeleton items                      |

Renders `role="status"`, `aria-live="polite"`, one `sr-only` label, then
`children`. It does not impose grid, flex, gap, or width.

```tsx
<SkeletonGroup label="Loading dramas">
  <Skeleton />
  <Skeleton />
</SkeletonGroup>
```

### 3.3 `ContentCardSkeleton`

Loading counterpart of `ContentCard`. Mirrors the 2:3 poster, `rounded-xl`
frame, `gap-3`, and metadata rhythm to limit layout shift.

| Prop        | Type     | Default | Notes             |
| ----------- | -------- | ------- | ----------------- |
| `className` | `string` | —       | Merged with root  |

The whole block is `aria-hidden="true"` and contains no headings, images, links,
buttons, or status regions.

### 3.4 `LoadingIndicator`

Communicates an in-progress operation through one polite status region.

| Prop        | Type                    | Default    | Notes                          |
| ----------- | ----------------------- | ---------- | ------------------------------ |
| `variant`   | `'inline' \| 'block'`   | `'inline'` | Compact or centered region     |
| `size`      | `'sm' \| 'md' \| 'lg'`  | `'md'`     | Spinner size                   |
| `label`     | `string`                | `'Loading'`| Accessible label, `sr-only`    |
| `className` | `string`                | —          | Merged with layout             |

The root is `role="status"` with `aria-live="polite"`. The spinner is
`aria-hidden="true"` and stops under reduced motion.

```tsx
<LoadingIndicator />
<LoadingIndicator variant="block" size="lg" label="Loading episodes" />
```

### 3.5 `EmptyState`

Consistent "nothing to show" block.

| Prop           | Type                          | Default | Notes                          |
| -------------- | ----------------------------- | ------- | ------------------------------ |
| `icon`         | `LucideIcon`                  | required| Decorative icon                |
| `title`        | `string`                      | required| Heading text                   |
| `description`  | `string`                      | —       | Optional explanation           |
| `children`     | `ReactNode`                   | —       | Action slot                    |
| `headingLevel` | `1 \| 2 \| 3 \| 4 \| 5 \| 6`  | `2`     | Semantic heading element       |
| `className`    | `string`                      | —       | Merged with root               |

Out-of-range levels from untyped callers fall back to `h2`.

```tsx
<EmptyState
  icon={Bookmark}
  title="No bookmarks yet"
  description="Sign in with Google to keep a saved list."
>
  <Link href="/auth/signin" className={buttonVariants({ size: 'sm' })}>
    Sign in
  </Link>
</EmptyState>
```

### 3.6 `RetryState`

Failure block for an operation that has stopped or errored. Server-compatible
and marked `role="alert"`.

| Prop           | Type                          | Default          | Notes                     |
| -------------- | ----------------------------- | ---------------- | ------------------------- |
| `title`        | `string`                      | required         | Heading text              |
| `description`  | `string`                      | —                | Optional explanation      |
| `children`     | `ReactNode`                   | —                | Action slot               |
| `icon`         | `LucideIcon`                  | `AlertTriangle`  | Decorative icon           |
| `headingLevel` | `1 \| 2 \| 3 \| 4 \| 5 \| 6`  | `2`              | Semantic heading element  |
| `className`    | `string`                      | —                | Merged with root          |

```tsx
<RetryState title="Could not load dramas" description="Check your connection and try again.">
  <Link href="/drama" className={buttonVariants()}>
    Try again
  </Link>
</RetryState>
```

### 3.7 `RetryButton`

Client island for an interactive retry. The caller owns the operation and must
flip `isRetrying` while it runs.

| Prop            | Type         | Default      | Notes                              |
| --------------- | ------------ | ------------ | ---------------------------------- |
| `onRetry`       | `() => void` | required     | Called once per idle click         |
| `isRetrying`    | `boolean`    | `false`      | Disables and announces progress    |
| `label`         | `string`     | `'Try again'`| Idle label                         |
| `retryingLabel` | `string`     | `'Retrying…'`| Visible and announced label        |
| `disabled`      | `boolean`    | `false`      | Additional disable                 |
| `className`     | `string`     | —            | Merged with button styles          |

While retrying: native `disabled`, `aria-busy="true"`, a decorative spinner, the
retrying label, and one `role="status"` announcement. The click handler also
returns early, so a duplicate event cannot call `onRetry`.

---

## 4. Accessibility Contract

| Concern                    | Behaviour                                                       |
| -------------------------- | --------------------------------------------------------------- |
| Skeleton bones             | `aria-hidden="true"`; no roles or labels                        |
| Grouped skeletons          | Exactly one `role="status"` + `aria-live="polite"` + sr-only text |
| Loading spinner            | `aria-hidden="true"`; region owns the label                     |
| Empty-state icon           | Decorative                                                      |
| Empty/retry headings       | Semantic `h1`–`h6`, default `h2`                                |
| Retry error                | Container `role="alert"`                                        |
| Retry action               | Native button, keyboard operable, visible focus ring            |
| Retry in progress          | `disabled`, `aria-busy="true"`, visible and sr-only feedback    |
| Reduced motion             | `motion-reduce:animate-none` on every animated element          |
| Duplicate announcements    | Prevented by hiding bones and using one group status region     |

`role="status"` regions are announced when they mount after navigation or an
operation. Content that is present on the initial page load may not be
announced by every screen reader, which is the standard live-region behaviour.

---

## 5. Server and Client Boundaries

- `RetryState`, `EmptyState`, `LoadingIndicator`, `Skeleton`,
  `SkeletonGroup`, and `ContentCardSkeleton` contain no `"use client"`.
- `RetryButton` starts with `"use client"` and is the only interactive island.
- A Server Component may render `RetryState` with a `<Link>`, a form whose
  action is a Server Action, or a client wrapper.
- A Server Component must not pass an ordinary callback to `RetryButton`:

```tsx
// Invalid: a Server Component cannot pass a plain function to a client island.
<RetryButton onRetry={() => refresh()} />
```

Use a client wrapper that owns the callback:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { RetryButton } from '@/components/states/retry-button';
import { RetryState } from '@/components/states/retry-state';

export function DramaLoadError() {
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);

  function retry(): void {
    setIsRetrying(true);
    try {
      router.refresh();
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <RetryState title="Could not load dramas" description="Check your connection and try again.">
      <RetryButton onRetry={retry} isRetrying={isRetrying} />
    </RetryState>
  );
}
```

`tests/unit/components/retry-boundary.test.ts` guards the `"use client"`
placement so the server component cannot silently become a client component.

---

## 6. Usage Examples

### 6.1 Skeleton grid

```tsx
import { ContentCardSkeleton } from '@/components/states/content-card-skeleton';
import { SkeletonGroup } from '@/components/states/skeleton';

const SKELETON_COUNT = 8;

export function DramaGridSkeleton() {
  return (
    <SkeletonGroup
      label="Loading dramas"
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
    >
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <ContentCardSkeleton key={index} />
      ))}
    </SkeletonGroup>
  );
}
```

### 6.2 Block loading

```tsx
<LoadingIndicator variant="block" label="Loading episodes" />
```

### 6.3 Empty state with an action

```tsx
<EmptyState
  icon={Film}
  title="No films yet"
  description="New releases appear here as they are published."
>
  <Link href="/trending" className={buttonVariants({ size: 'sm' })}>
    Browse trending
  </Link>
</EmptyState>
```

### 6.4 Retry with a link action

```tsx
<RetryState title="Could not load films" description="The request failed. Try again.">
  <Link href="/movie" className={buttonVariants()}>
    Reload films
  </Link>
</RetryState>
```

---

## 7. Migration from `Layout.EmptyState`

The existing public `EmptyState` in `src/components/public/Layout.tsx` is
intentionally unchanged in this prompt. Its call sites continue to work.

When migrating later:

- The core props are the same: `icon`, `title`, `description`, `children`.
- `description` is now optional.
- `headingLevel` (default `2`) and `className` are new.
- Change the import to `@/components/states/empty-state`.
- Set `headingLevel` only when the surrounding page needs a different heading
  order.

---

## 8. Tests

Component tests live in `tests/unit/components/` and opt into jsdom per file:

- `skeleton.test.tsx` — variants, decorative bones, one group announcement,
  custom label, no imposed layout.
- `content-card-skeleton.test.tsx` — 2:3 poster, three text bones, decorative
  content, no per-card announcements.
- `loading-indicator.test.tsx` — status semantics, hidden spinner, layouts,
  sizes, reduced-motion class, labels.
- `empty-state.test.tsx` — default and custom heading levels, invalid-level
  fallback, optional description/action, icon, `className`.
- `retry-state.test.tsx` — alert semantics, heading levels, action slot, retry
  interaction, disabled and busy states, duplicate-click protection.
- `retry-boundary.test.ts` — `RetryState` is server-compatible and
  `RetryButton` is a client island.

Run the state-component tests with:

```
npx vitest run tests/unit/components
```

---

## 9. Related Documents

- [Testing Conventions](testing-conventions.md)
- [Coding Conventions](coding-conventions.md)
- [Functional Requirements](../requirements/functional-requirements.md) §6
- Design: `docs/superpowers/specs/2026-11-11-shared-loading-empty-states-design.md`
