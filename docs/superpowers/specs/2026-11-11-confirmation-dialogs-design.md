# Confirmation Dialogs — Design

**Prompt:** 048 — Create Shared Dialogs and Confirmation Components
**Date:** 2026-11-11
**Status:** Proposed — awaiting approval

## 1. Goal

Add one reusable, accessible confirmation dialog and one reusable consequence
list for consequential administrator operations: destructive actions,
publishing, restoring, permanent deletion, source replacement, and similar.

The dialog must never perform the operation itself. It requests confirmation;
the caller owns the open state, the mutation, and the pending flag.

## 2. Confirmed Decisions

| Decision            | Choice                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| Component set       | One `ConfirmationDialog` + one `ConsequenceList`; no operation presets     |
| Lifecycle           | Approach B: controlled `open`/`onOpenChange` + optional trigger            |
| Confirm semantics   | Synchronous `onConfirm`; `isPending` fully caller-controlled               |
| Closure             | Confirm and Cancel both request closure through `onOpenChange`             |
| Pending behaviour   | Both actions disabled; Escape suppressed; no hidden async state            |
| Focus               | `initialFocus` on Cancel; Base UI `finalFocus` default returns to trigger  |
| Location            | `src/components/dialogs/`, direct imports, no barrel                      |
| Consequences        | `ConsequenceList` server-compatible, neutral styling by default            |
| Content sections    | Affected content and consequences optional, documented as required in use  |

## 3. Non-Goals

- No operation-specific presets (`PermanentDeleteDialog`, `PublishDialog`, …).
- No admin shell, admin page, or existing-page changes.
- No new dialog library; only the vendored Base UI alert dialog.
- No typed confirmation phrase or checkbox acknowledgement (not in the prompt).
- No confirmation for routine actions; this is a documented usage rule, not a
  runtime guard.
- No network calls, Server Actions, schema changes, or new dependencies.
- No changes to `src/components/ui/alert-dialog.tsx` or other UI primitives.

## 4. Files

```
src/components/dialogs/
  confirmation-dialog.tsx   "use client" — dialog composition
  consequence-list.tsx      server-compatible — neutral consequence list

tests/unit/components/
  confirmation-dialog.test.tsx
  consequence-list.test.tsx

docs/development/confirmation-dialogs.md   API, usage rules, examples
```

Imports are direct:

```ts
import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';
import { ConsequenceList } from '@/components/dialogs/consequence-list';
```

## 5. Component APIs

### 5.1 `ConsequenceList` (server-compatible)

```ts
export type ConsequenceListProps = Readonly<{
  items: ReactNode[];
  label?: string;      // accessible name for the list (aria-label)
  className?: string;
}>;
```

- Renders nothing when `items` is empty.
- Renders `<ul data-slot="consequence-list">` with `list-disc space-y-1.5 pl-5
  text-sm text-muted-foreground` plus `className`.
- Each `<li>` renders its `ReactNode` item.
- `label` becomes the list's `aria-label`; no visible heading is added, because
  the dialog owns section headings.
- Styling is neutral: no destructive colour, icon, or emphasis. A consequence
  list may describe a publish or a restore just as validly as a deletion.
- Contains no `"use client"`, no hooks, no event handlers.

### 5.2 `ConfirmationDialog` (client)

```ts
'use client';

export type ConfirmationVariant = 'default' | 'destructive';

export type ConfirmationDialogProps = Readonly<{
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;

  onConfirm: () => void;
  isPending?: boolean;

  title: string;
  description?: ReactNode;
  affectedContent?: ReactNode;
  affectedContentLabel?: string; // default 'Affected content'
  consequences?: ReactNode;
  consequencesLabel?: string;    // default 'Consequences'

  confirmLabel?: string;         // default 'Confirm'
  cancelLabel?: string;          // default 'Cancel'
  pendingLabel?: string;         // default 'Working…'
  variant?: ConfirmationVariant; // default 'default'

  trigger?: ReactElement;
  className?: string;
}>;
```

**Open state**

- `open` provides the controlled state. When supplied, the dialog is controlled
  and only the caller can change visibility.
- `defaultOpen` is for tests and stories only; production callers pass `open`.
- `onOpenChange` receives every open/close request: trigger press, Escape,
  Cancel, and Confirm.
- Confirm and Cancel both request `onOpenChange(false)`. The caller may ignore
  the request (for example, to keep the dialog visible during an operation) by
  leaving `open` unchanged and passing `isPending`.

**Trigger**

- `trigger` is an optional React element rendered through Base UI's trigger, so
  it inherits keyboard behaviour and focus restoration.
- Without a trigger, the caller opens the dialog from its own button and sets
  `open`; focus then returns to the previously focused element.

**Confirmation and pending**

- The confirm button calls `onConfirm()` once, then requests closure.
- `onConfirm` is invoked synchronously. No Promise is awaited, no state is
  derived from a returned value, and the component never closes itself outside
  `onOpenChange`.
- While `isPending`: Confirm and Cancel are `disabled`, Confirm carries
  `aria-busy="true"`, shows a decorative spinner and `pendingLabel`, and the
  click handler returns early — a duplicate confirmation cannot call
  `onConfirm`.
- While `isPending`, a close request from Escape is ignored. Backdrop dismissal
  is already disabled by Base UI's alert-dialog semantics.

**Composition**

- `AlertDialogHeader` holds the title and optional description, plus
  `AlertDialogMedia` with `AlertTriangle` only for the destructive variant.
- Optional affected-content section: `<section aria-labelledby>` with an `h3`
  label and the caller's node inside a muted panel.
- Optional consequences section: `<section aria-labelledby>` with an `h3` label
  and the caller's node (normally a `ConsequenceList`).
- `AlertDialogFooter` holds Cancel (outline) and Confirm (`default` or
  `destructive` button variant).
- Sections are omitted entirely when their content is absent; no empty headings
  or empty containers are rendered.

**Styling**

- Existing tokens only: `popover`, `muted`, `border`, `destructive`, `primary`,
  `foreground`. No hex values.
- Destructive variant styles the confirm button with `variant="destructive"`
  and the media icon with the destructive token; the dialog frame itself is
  unchanged, since the primitive owns it.
- The spinner carries `motion-reduce:animate-none`.

## 6. Accessibility Contract

| Concern               | Behaviour                                                        |
| --------------------- | ---------------------------------------------------------------- |
| Dialog role           | Base UI alert dialog (`role="alertdialog"`)                       |
| Name and description  | `AlertDialogTitle` and `AlertDialogDescription` wiring            |
| Initial focus         | Cancel, via `initialFocus`                                        |
| Final focus           | Base UI default: the trigger, else the previously focused element |
| Keyboard              | Escape closes (except while pending); Tab is trapped; Cancel/Confirm are native buttons |
| Safe default          | Cancel is focused first and is visually secondary                 |
| Pending feedback      | `aria-busy` on Confirm, visible `pendingLabel`, disabled actions  |
| Section labels        | `section` + `aria-labelledby` with `h3`, under the dialog `h2`    |
| Consequence semantics | Real `<ul>`/`<li>` list; optional `aria-label`                    |

## 7. Server and Client Boundary

- `confirmation-dialog.tsx` starts with `"use client"`; Base UI's dialog is
  client-side.
- `consequence-list.tsx` has no `"use client"`, so a Server Component may render
  it directly.
- `affectedContent`, `consequences`, `description`, and item content are
  `ReactNode`, so server-rendered markup (summaries, counts, links) can be
  passed into the client dialog.
- `onConfirm` is a client callback. A Server Action flow uses a client wrapper:

```tsx
'use client';

import { useState, useTransition } from 'react';

import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';
import { ConsequenceList } from '@/components/dialogs/consequence-list';

export function PublishDramaButton({ id, title }: { id: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function confirm(): void {
    startTransition(async () => {
      await publishDrama(id);
      setOpen(false);
    });
  }

  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={setOpen}
      title={`Publish “${title}”?`}
      description="The drama becomes publicly visible."
      consequences={<ConsequenceList items={['Unpublished episodes stay hidden.']} />}
      confirmLabel="Publish"
      isPending={isPending}
      onConfirm={confirm}
    />
  );
}
```

`startTransition` from `useTransition` keeps `isPending` true while the action
runs, which is the supported way to keep the dialog busy.

## 8. Usage Rules

Use a confirmation dialog when an operation is consequential and not trivially
reversible: moving content to Trash, permanent deletion, publishing,
unpublishing, restoring, replacing a video source, bulk operations, destructive
settings, or a restore that overwrites current data.

Do not use one for routine, reversible, or single-click-safe interactions:
opening an editor, saving a draft, filtering, sorting, paginating, toggling a
preference that is immediately reversible, or opening a preview.

Required content by operation:

| Operation           | Affected content                            | Consequences                                  |
| ------------------- | ------------------------------------------- | --------------------------------------------- |
| Permanent deletion  | Titles and counts, including child records  | What is deleted, what is retained, irreversibility |
| Trash / move        | Item and affected children                  | Retention window and restoration path         |
| Publish             | Item and scope                              | What becomes public; skipped invalid children |
| Unpublish           | Item and scope                              | What immediately disappears                   |
| Restore             | Item and replaced state                     | Overwritten data and conflicts                |
| Source replacement  | Episode/movie identity and old/new source   | Progress reset; old URL not retained          |
| Bulk operation      | Total count plus a readable sample          | Skipped items and why                         |

## 9. Test Plan

Both files live in `tests/unit/components/`, opt into jsdom, use React Testing
Library, and call `cleanup` in `afterEach`.

`consequence-list.test.tsx`

- Renders a real list with one item per entry.
- Renders nothing for an empty array.
- Applies `aria-label` when `label` is supplied.
- Uses neutral tokens only (no `destructive` class).
- Merges `className`.
- Has no `"use client"` directive (boundary guard).

`confirmation-dialog.test.tsx`

- Renders no dialog when closed.
- Renders title and description with `open`.
- `defaultOpen` renders an open dialog.
- Optional trigger opens the dialog and receives focus back after close.
- Cancel calls `onOpenChange(false)` and never calls `onConfirm`.
- Confirm calls `onConfirm` exactly once and requests closure.
- Pending disables both actions, sets `aria-busy`, shows `pendingLabel`, and a
  second click does not call `onConfirm`.
- Escape does not close while pending; it does close otherwise.
- Destructive variant gives the confirm button destructive styling.
- Affected content and consequences render with their labels; the consequence
  list items are reachable as list items.
- Sections are absent when content is omitted.
- Cancel has focus when the dialog opens.
- File starts with `"use client"` (boundary guard).

Base UI renders through a portal and may need a frame before focus settles, so
focus assertions use `waitFor`. If jsdom lacks an API Base UI needs
(`matchMedia`, `ResizeObserver`, `scrollIntoView`), the test file adds a minimal
local polyfill; no production code is changed to satisfy the test environment.

## 10. Documentation Plan

- New `docs/development/confirmation-dialogs.md`: API tables, accessibility
  contract, server/client boundary, usage rules, per-operation examples
  (permanent deletion, publish, restore, source replacement, bulk), and the
  `useTransition` pattern.
- Add the document to `docs/README.md`.
- Update `docs/PROJECT_STATUS.md` with Prompt 048.
- Add `0.4.8` to `docs/CHANGELOG.md` after verification.

## 11. Verification Plan

```
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run test:e2e
```

`npm run lint` enforces `no-extra-parens`; conditional JSX uses render helpers or
early returns. The production build uses the existing production-shaped env
workaround. Playwright is regression only — this prompt adds no route.

## 12. Risks and Mitigations

| Risk                                              | Mitigation                                                    |
| ------------------------------------------------- | ------------------------------------------------------------- |
| Base UI dialog is awkward in jsdom                | Assertions via `waitFor`; minimal local polyfills if required  |
| Caller keeps dialog open after confirm            | Documented: ignore `onOpenChange(false)` and pass `isPending`  |
| Uncontrolled `defaultOpen` bypasses pending Escape suppression | Documented as tests/stories only; production is controlled |
| Sections create heading-order noise               | Section labels are `h3` under the dialog's `h2`                 |
| Dialogs used for trivial actions                  | Documented usage rules with explicit do-not list                |
| Confirm executed twice by double click            | Disabled button plus early return in the handler                |
| Client boundary leaks into server components      | `ConsequenceList` has no directive; boundary test               |

## 13. Git Plan

- One commit: `feat: add shared confirmation dialogs (Prompt 048)`.
- Review the diff for secrets and unrelated changes.
- Verification gate must pass before committing.
- Obtain approval before pushing, per the Prompt 048 instruction.
