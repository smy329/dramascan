# Confirmation Dialogs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one reusable, accessible `ConfirmationDialog` and one server-compatible `ConsequenceList` for consequential admin operations.

**Architecture:** `ConfirmationDialog` is a client component that composes the vendored Base UI alert dialog with a fully controlled open state, a synchronous `onConfirm`, and a caller-owned `isPending`. `ConsequenceList` is a presentational server-compatible `<ul>`. Neither component performs the operation or holds hidden async state.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS v4, Base UI alert dialog (`src/components/ui/alert-dialog.tsx`), lucide-react, Vitest, React Testing Library, jsdom, Playwright (regression only).

**Spec:** `docs/superpowers/specs/2026-11-11-confirmation-dialogs-design.md`

## Global Constraints

- One configurable dialog; no operation-specific presets.
- No admin shell, admin page, or existing-page changes.
- No new dialog library and no changes to `src/components/ui/**`.
- `consequence-list.tsx` must not contain `"use client"`; `confirmation-dialog.tsx` must start with it.
- `onConfirm` is synchronous. Do not await a returned value, derive state from it, or close on a Promise result.
- The caller owns `open` and `isPending`; the component only requests closure through `onOpenChange`.
- Both actions disabled while pending; Escape ignored while pending; duplicate confirm blocked by `disabled` plus an early return.
- Cancel is the safe default: `initialFocus` targets it.
- `finalFocus` is not overridden; Base UI's default returns focus to the trigger.
- Semantic tokens only (`popover`, `muted`, `border`, `destructive`, `primary`, `foreground`). No hex values.
- Every animated element carries `motion-reduce:animate-none`.
- Component tests: `// @vitest-environment jsdom`, RTL, `cleanup` in `afterEach`, `fireEvent`. No `user-event`.
- `no-extra-parens` lint rule: use render helpers or early returns, not parenthesised conditional JSX.
- Project convention: exactly one commit for the whole micro-prompt. Do not commit after each task.
- Obtain approval before pushing.

## File Structure

```
src/components/dialogs/
  confirmation-dialog.tsx   ConfirmationDialog + ConfirmationVariant ("use client")
  consequence-list.tsx      ConsequenceList (server-compatible)

tests/unit/components/
  consequence-list.test.tsx
  confirmation-dialog.test.tsx
  dialog-boundary.test.ts    "use client" placement guard

docs/development/confirmation-dialogs.md
docs/README.md               index entry
docs/PROJECT_STATUS.md       Prompt 048 row
docs/CHANGELOG.md            0.4.8 entry
```

## Review Focus

- A rapid double click on Confirm before React re-renders must call `onConfirm` exactly once.
- Escape pressed while `isPending` must not close a controlled dialog.
- Omitting `description`, `affectedContent`, or `consequences` must render no empty paragraph, heading, section, or list.
- `ConsequenceList` with zero items must render nothing, not an empty bullet list.
- Closing a triggered dialog must return focus to the trigger, and no trigger must not break opening.
- Confirm must both call `onConfirm` and request closure through `onOpenChange(false)`.

---

### Task 1: ConsequenceList

**Files:**
- Create: `src/components/dialogs/consequence-list.tsx`
- Test: `tests/unit/components/consequence-list.test.tsx`

**Interfaces:**
- Produces: `ConsequenceListProps = { items: ReactNode[]; label?: string; className?: string }`
- Produces: `ConsequenceList(props): JSX.Element | null`

- [x] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ConsequenceList } from '@/components/dialogs/consequence-list';

afterEach(cleanup);

describe('ConsequenceList', () => {
  it('renders one list item per consequence', () => {
    render(<ConsequenceList items={['Bookmarks are removed.', 'Ratings are anonymised.']} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Bookmarks are removed.')).toBeTruthy();
  });

  it('renders nothing when there are no items', () => {
    const { container } = render(<ConsequenceList items={[]} />);
    expect(container.querySelector('ul')).toBeNull();
  });

  it('applies an accessible label', () => {
    render(<ConsequenceList label="What happens next" items={['Progress resets.']} />);
    expect(screen.getByRole('list', { name: 'What happens next' })).toBeTruthy();
  });

  it('uses neutral styling and merges className', () => {
    const { container } = render(
      <ConsequenceList items={['Progress resets.']} className="mt-4" />
    );
    const list = container.querySelector('ul');

    expect(list?.className).not.toContain('destructive');
    expect(list?.className).toContain('mt-4');
  });
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/consequence-list.test.tsx`

Expected: FAIL â€” the module `@/components/dialogs/consequence-list` cannot be resolved.

- [x] **Step 3: Implement `src/components/dialogs/consequence-list.tsx`**

No `"use client"`. Import `type { JSX, ReactNode } from 'react'` and `cn` from `@/lib/utils`.

- Root: `null` when `items.length === 0`.
- Otherwise `<ul data-slot="consequence-list" aria-label={label} className={cn('list-disc space-y-1.5 pl-5 text-sm text-muted-foreground marker:text-muted-foreground/70', className)}>`.
- Render `items.map((item, index) => <li key={index}>{item}</li>)`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/consequence-list.test.tsx`

Expected: PASS â€” 4 tests.

---

### Task 2: ConfirmationDialog core lifecycle

**Files:**
- Create: `src/components/dialogs/confirmation-dialog.tsx`
- Test: `tests/unit/components/confirmation-dialog.test.tsx`
- Test: `tests/unit/components/dialog-boundary.test.ts`

**Interfaces:**
- Consumes: `src/components/ui/alert-dialog.tsx` exports (`AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogCancel`) and `Button`.
- Produces: `ConfirmationDialogProps` (Task 2 subset):
  `{ open?: boolean; onOpenChange?: (open: boolean) => void; defaultOpen?: boolean; onConfirm: () => void; title: string; description?: ReactNode; confirmLabel?: string; cancelLabel?: string; trigger?: ReactElement; className?: string }`
- Produces: `ConfirmationDialog(props): JSX.Element`

- [x] **Step 1: Write the failing lifecycle tests**

```tsx
// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';

afterEach(cleanup);

const BASE_PROPS = {
  title: 'Delete drama',
  onConfirm: () => {},
} as const;

describe('ConfirmationDialog lifecycle', () => {
  it('renders nothing while closed', () => {
    render(<ConfirmationDialog {...BASE_PROPS} open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('renders the title and description when open', async () => {
    render(
      <ConfirmationDialog
        {...BASE_PROPS}
        open
        onOpenChange={() => {}}
        description="This moves the drama to Trash."
      />
    );

    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Delete drama' })).toBeTruthy();
    expect(screen.getByText('This moves the drama to Trash.')).toBeTruthy();
  });

  it('opens from its trigger', async () => {
    render(
      <ConfirmationDialog
        {...BASE_PROPS}
        defaultOpen={false}
        trigger={<button type="button">Delete drama</button>}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete drama' }));

    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });

  it('renders an open dialog with defaultOpen', async () => {
    render(<ConfirmationDialog {...BASE_PROPS} defaultOpen />);
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });

  it('requests closure without confirming when cancelled', async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmationDialog
        title="Delete drama"
        onConfirm={onConfirm}
        open
        onOpenChange={onOpenChange}
      />
    );

    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms exactly once and requests closure', async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmationDialog
        title="Delete drama"
        onConfirm={onConfirm}
        open
        onOpenChange={onOpenChange}
      />
    );

    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('honours custom confirm and cancel labels', async () => {
    render(
      <ConfirmationDialog
        {...BASE_PROPS}
        open
        onOpenChange={() => {}}
        confirmLabel="Move to Trash"
        cancelLabel="Keep it"
      />
    );

    await screen.findByRole('alertdialog');
    expect(screen.getByRole('button', { name: 'Move to Trash' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeTruthy();
  });

  it('focuses Cancel when it opens', async () => {
    render(<ConfirmationDialog {...BASE_PROPS} open onOpenChange={() => {}} />);

    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
  });

  it('returns focus to the trigger after closing', async () => {
    render(
      <ConfirmationDialog
        {...BASE_PROPS}
        trigger={<button type="button">Delete drama</button>}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Delete drama' });
    fireEvent.click(trigger);
    await screen.findByRole('alertdialog');

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
```

- [x] **Step 2: Write the boundary test**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(file: string): string {
  return readFileSync(new URL(`../../../src/components/dialogs/${file}`, import.meta.url), 'utf8');
}

describe('dialog component server/client boundaries', () => {
  it('keeps ConfirmationDialog a client component', () => {
    expect(source('confirmation-dialog.tsx').trimStart().startsWith("'use client'")).toBe(true);
  });

  it('keeps ConsequenceList server-compatible', () => {
    expect(source('consequence-list.tsx').trimStart().startsWith("'use client'")).toBe(false);
  });
});
```

- [x] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/confirmation-dialog.test.tsx tests/unit/components/dialog-boundary.test.ts`

Expected: FAIL â€” `confirmation-dialog.tsx` does not exist, so both the import and the boundary assertion fail.

- [x] **Step 4: Implement the core dialog**

Start the file with `'use client'`. Import:
`useRef, type JSX, type ReactElement, type ReactNode` from `react`; `AlertDialog as AlertDialogPrimitive` from `@base-ui/react/alert-dialog`; the vendored parts from `@/components/ui/alert-dialog`; `Button` from `@/components/ui/button`; `cn` from `@/lib/utils`.

Structure:

```tsx
<AlertDialogPrimitive.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
  {trigger ? <AlertDialogTrigger render={trigger} /> : null}
  <AlertDialogContent initialFocus={cancelRef} className={className}>
    <AlertDialogHeader>
      <AlertDialogTitle>{title}</AlertDialogTitle>
      {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel ref={cancelRef}>{cancelLabel}</AlertDialogCancel>
      <AlertDialogPrimitive.Close
        onClick={handleConfirm}
        render={<Button data-slot="confirmation-dialog-confirm" variant="default" />}
      >
        {confirmLabel}
      </AlertDialogPrimitive.Close>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialogPrimitive.Root>
```

- Defaults: `confirmLabel = 'Confirm'`, `cancelLabel = 'Cancel'`.
- `handleConfirm` returns early if a duplicate is already guarded later; for now it calls `onConfirm()`.
- The confirm control is Base UI's `Close` rendered as a `Button`, because the vendored `AlertDialogAction` is a plain `Button` that never requests closure. Do not modify `src/components/ui/alert-dialog.tsx`.
- `AlertDialogContent` receives `initialFocus={cancelRef}`, where `cancelRef` is `useRef<HTMLButtonElement>(null)`. Do not set `finalFocus`; Base UI returns focus to the trigger by default.
- If `AlertDialogCancel` does not forward `ref` under React 19, render Cancel through `AlertDialogPrimitive.Close` with `render={<Button ref={cancelRef} variant="outline" />}` instead; the behaviour and props stay the same.
- Omit `description` entirely when absent; do not render an empty `AlertDialogDescription`.
- Render helper for the description rather than a parenthesised `&&` body, to suit `no-extra-parens`.

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/confirmation-dialog.test.tsx tests/unit/components/dialog-boundary.test.ts`

Expected: PASS â€” 9 lifecycle tests plus 2 boundary tests. If Base UI throws for a missing jsdom API (`matchMedia`, `ResizeObserver`, or `scrollIntoView`), add a minimal local stub at the top of the test file and re-run. Do not change production code for the test environment.

---

### Task 3: Pending state, destructive variant, sections, Escape

**Files:**
- Modify: `src/components/dialogs/confirmation-dialog.tsx`
- Test: `tests/unit/components/confirmation-dialog.test.tsx`

**Interfaces:**
- Extends `ConfirmationDialogProps` with:
  `{ isPending?: boolean; pendingLabel?: string; variant?: 'default' | 'destructive'; affectedContent?: ReactNode; affectedContentLabel?: string; consequences?: ReactNode; consequencesLabel?: string }`
- Produces: `ConfirmationVariant = 'default' | 'destructive'`
- Consumes: `ConsequenceList` from `@/components/dialogs/consequence-list` in tests only.

- [x] **Step 1: Write the failing tests**

Append to `confirmation-dialog.test.tsx` (add `vi` if not already imported):

```tsx
describe('ConfirmationDialog pending state', () => {
  it('disables both actions, announces busy, and blocks duplicates', async () => {
    const onConfirm = vi.fn();

    render(
      <ConfirmationDialog
        title="Delete drama"
        onConfirm={onConfirm}
        open
        onOpenChange={() => {}}
        isPending
      />
    );

    const confirm = (await screen.findByRole('button', { name: 'Workingâ€¦' })) as HTMLButtonElement;
    const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;

    expect(confirm.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(confirm.getAttribute('aria-busy')).toBe('true');
    expect(confirm.querySelector('svg')?.getAttribute('class')).toContain(
      'motion-reduce:animate-none'
    );

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('supports a custom pending label', async () => {
    render(
      <ConfirmationDialog
        title="Delete drama"
        onConfirm={() => {}}
        open
        onOpenChange={() => {}}
        isPending
        pendingLabel="Deletingâ€¦"
      />
    );

    expect(await screen.findByRole('button', { name: 'Deletingâ€¦' })).toBeTruthy();
  });

  it('ignores Escape while pending but closes otherwise', async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ConfirmationDialog
        title="Delete drama"
        onConfirm={() => {}}
        open
        onOpenChange={onOpenChange}
        isPending
      />
    );

    await screen.findByRole('alertdialog');
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(onOpenChange).not.toHaveBeenCalled();

    rerender(
      <ConfirmationDialog
        title="Delete drama"
        onConfirm={() => {}}
        open
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('ConfirmationDialog variant and sections', () => {
  it('styles the confirm action destructively', async () => {
    render(
      <ConfirmationDialog
        title="Delete drama"
        onConfirm={() => {}}
        open
        onOpenChange={() => {}}
        variant="destructive"
      />
    );

    const confirm = await screen.findByRole('button', { name: 'Confirm' });
    expect(confirm.className).toContain('text-destructive');
  });

  it('renders affected content and consequences with labels', async () => {
    render(
      <ConfirmationDialog
        title="Permanently delete drama"
        onConfirm={() => {}}
        open
        onOpenChange={() => {}}
        affectedContent={<p>Midnight Signal Â· 3 seasons Â· 24 episodes</p>}
        consequences={
          <ConsequenceList items={['Bookmarks and progress are removed.', 'Ratings stay anonymous.']} />
        }
      />
    );

    await screen.findByRole('alertdialog');

    expect(screen.getByRole('heading', { level: 3, name: 'Affected content' })).toBeTruthy();
    expect(screen.getByText('Midnight Signal Â· 3 seasons Â· 24 episodes')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Consequences' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('supports custom section labels', async () => {
    render(
      <ConfirmationDialog
        title="Replace source"
        onConfirm={() => {}}
        open
        onOpenChange={() => {}}
        affectedContent={<p>Episode 4</p>}
        affectedContentLabel="Episode"
        consequences={<ConsequenceList items={['Progress resets.']} />}
        consequencesLabel="What changes"
      />
    );

    await screen.findByRole('alertdialog');
    expect(screen.getByRole('heading', { level: 3, name: 'Episode' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'What changes' })).toBeTruthy();
  });

  it('renders no sections when content is omitted', async () => {
    const { container } = render(
      <ConfirmationDialog
        title="Restore drama"
        onConfirm={() => {}}
        open
        onOpenChange={() => {}}
      />
    );

    await screen.findByRole('alertdialog');
    expect(container.querySelectorAll('h3')).toHaveLength(0);
    expect(screen.queryByRole('list')).toBeNull();
  });
});
```

Add the import at the top of the file:

```tsx
import { ConsequenceList } from '@/components/dialogs/consequence-list';
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/confirmation-dialog.test.tsx`

Expected: FAIL â€” `isPending`, `pendingLabel`, `variant`, and the section props are not accepted, and no destructive styling or section markup is rendered.

- [x] **Step 3: Extend the implementation**

- Defaults: `isPending = false`, `pendingLabel = 'Workingâ€¦'`, `variant = 'default'`, `affectedContentLabel = 'Affected content'`, `consequencesLabel = 'Consequences'`.
- Wrap the open-change handler: if `nextOpen` is false and `isPending`, return without calling `onOpenChange`.
- Confirm: `disabled={isPending}`, `aria-busy={isPending ? true : undefined}`, early return in `handleConfirm` when `isPending`, spinner `Loader2` with `aria-hidden="true"` and `animate-spin motion-reduce:animate-none`, and text `isPending ? pendingLabel : confirmLabel`.
- Cancel: `disabled={isPending}`.
- Destructive variant: confirm `variant="destructive"`; header gains `<AlertDialogMedia className="text-destructive"><AlertTriangle className="size-5" aria-hidden="true" /></AlertDialogMedia>` only for `variant === 'destructive'`.
- Sections, each rendered only when its node is supplied:
  - `<section aria-labelledby={affectedId} className="rounded-lg border border-border bg-muted/40 p-3 text-left">` containing `<h3 id={affectedId} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{affectedContentLabel}</h3>` and `<div className="mt-2 text-sm text-foreground">{affectedContent}</div>`.
  - `<section aria-labelledby={consequencesId} className="text-left">` containing `<h3 id={consequencesId} ...>{consequencesLabel}</h3>` and `<div className="mt-2">{consequences}</div>`.
  - Generate ids with `useId()`. Use render helpers or early returns for conditional sections.

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/confirmation-dialog.test.tsx tests/unit/components/dialog-boundary.test.ts`

Expected: PASS â€” 16 lifecycle tests plus 2 boundary tests.

- [x] **Step 5: Run lint and typecheck**

Run: `npm run typecheck` then `npm run lint`

Expected: exit 0 for both.

---

### Task 4: Documentation, verification, commit

**Files:**
- Create: `docs/development/confirmation-dialogs.md`
- Modify: `docs/README.md`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/CHANGELOG.md`

- [x] **Step 1: Write `docs/development/confirmation-dialogs.md`**

Cover:

- Purpose and scope: two primitives, no operation presets, no page wiring.
- File map and direct-import examples.
- API tables for `ConfirmationDialog` and `ConsequenceList`.
- Lifecycle contract: controlled `open`; confirm requests closure; caller may keep it open with `isPending`; no hidden async.
- Pending behaviour and duplicate-submission prevention.
- Accessibility contract table from the design (Â§6), including `initialFocus` on Cancel and Base UI's `finalFocus` default.
- Server/client boundary with the `useTransition` client-wrapper example from the design (Â§7).
- Usage rules: when to confirm and when not to.
- Per-operation examples: permanent deletion with affected children, publish, restore, source replacement with progress reset, bulk operation with sample and skipped count.
- Testing note: `tests/unit/components/confirmation-dialog.test.tsx` and `consequence-list.test.tsx`.

- [x] **Step 2: Update the documentation index**

Add `[Confirmation Dialogs](development/confirmation-dialogs.md)` to `docs/README.md` Quick Links, next to the state-components entry.

- [x] **Step 3: Update project status and changelog**

- `docs/PROJECT_STATUS.md`: set `**Current Prompt:** 048 â€” Create Shared Dialogs and Confirmation Components` and add a Prompt 048 row with changed files, commands, and a short description.
- `docs/CHANGELOG.md`: add `## [0.4.8] - 2026-11-11` above `0.4.7`, describing both components, the controlled lifecycle, accessibility, boundary, and verification results.

- [x] **Step 4: Run the full verification gate**

Run, in order:

```
npm run typecheck
npm run lint
npm test
npm run test:integration
```

Then the production build with the existing production-shaped environment workaround:

```
node "C:\Users\User\AppData\Local\Temp\opencode\dramascan-build.mjs"
```

Then free port 3000 if needed and run:

```
npm run test:e2e
```

Expected: all pass. Report pre-existing main-database `information_pages` migration warnings separately from Prompt 048 regressions.

- [x] **Step 5: Review the diff**

Run:

```
git status --short
git diff
git diff --check
```

Confirm only the two components, three test files, and the four documentation files changed. No `.env`, secrets, build artifacts, or page changes.

- [x] **Step 6: Commit**

```
git add src/components/dialogs tests/unit/components docs/development/confirmation-dialogs.md docs/README.md docs/PROJECT_STATUS.md docs/CHANGELOG.md docs/superpowers
git commit -m "feat: add shared confirmation dialogs (Prompt 048)"
```

Do not push until the user approves. After approval, push and verify `origin/main` matches `HEAD`.
