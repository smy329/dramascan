# Confirmation Dialogs

**Project:** DramaScan — International Drama & Movie Streaming Platform
**Version:** 1.0
**Date:** 2026-11-11

This document defines the shared confirmation primitives created by Prompt 048:
`ConfirmationDialog` and `ConsequenceList`. They exist so every consequential
administrator operation asks for confirmation in one consistent, accessible
way, and so the affected records and consequences are visible before the user
commits.

The components are primitives. This prompt does not create an admin shell, does
not wire them into pages, and does not provide operation-specific presets.

---

## 1. Principles

- One configurable dialog; no per-operation components.
- The dialog never performs the operation. The caller owns the mutation.
- The caller owns `open` and `isPending`; the dialog only reports requests.
- No hidden asynchronous state and no automatic close on a resolved Promise.
- Cancel is the safe default: it receives initial focus.
- Consequential operations show affected content and consequences; routine
  actions do not use a dialog at all.
- Existing design tokens and the vendored Base UI alert dialog only. No second
  dialog library.

---

## 2. Files and Imports

| File                                       | Exports                                    | Boundary    |
| ------------------------------------------ | ------------------------------------------ | ----------- |
| `src/components/dialogs/confirmation-dialog.tsx` | `ConfirmationDialog`, `ConfirmationVariant` | **Client** |
| `src/components/dialogs/consequence-list.tsx`    | `ConsequenceList`                          | Server      |

```ts
import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';
import { ConsequenceList } from '@/components/dialogs/consequence-list';
```

Direct imports only; there is no barrel `index.ts`.

---

## 3. `ConfirmationDialog`

### 3.1 Props

| Prop                   | Type                                        | Default             | Notes                                                    |
| ---------------------- | ------------------------------------------- | ------------------- | -------------------------------------------------------- |
| `open`                 | `boolean`                                   | —                   | Controlled visibility. Production callers always pass it. |
| `onOpenChange`         | `(nextOpen: boolean) => void`               | —                   | Receives every open/close request                         |
| `defaultOpen`          | `boolean`                                   | `false`             | Tests and stories only; do not use in production          |
| `onConfirm`            | `() => void`                                | required            | Synchronous; called once per idle confirmation            |
| `isPending`            | `boolean`                                   | `false`             | Caller-owned; disables actions and blocks duplicates      |
| `title`                | `string`                                    | required            | Dialog heading (`h2`)                                     |
| `description`          | `ReactNode`                                 | —                   | Optional explanation                                      |
| `affectedContent`      | `ReactNode`                                 | —                   | Optional affected-records section                         |
| `affectedContentLabel` | `string`                                    | `'Affected content'`| Section heading (`h3`)                                    |
| `consequences`         | `ReactNode`                                 | —                   | Optional consequences section, usually a `ConsequenceList`|
| `consequencesLabel`    | `string`                                    | `'Consequences'`    | Section heading (`h3`)                                    |
| `confirmLabel`         | `string`                                    | `'Confirm'`         | Confirm action text                                       |
| `cancelLabel`          | `string`                                    | `'Cancel'`          | Cancel action text                                        |
| `pendingLabel`         | `string`                                    | `'Working…'`        | Confirm text and spinner while pending                    |
| `variant`              | `'default' \| 'destructive'`                | `'default'`         | Destructive styling for the confirm action                |
| `trigger`              | `ReactElement`                              | —                   | Optional trigger rendered through Base UI                 |
| `className`            | `string`                                    | —                   | Applied to the dialog panel                               |

### 3.2 Lifecycle contract

1. The caller sets `open` (or renders a `trigger` with `defaultOpen` in tests).
2. Cancel requests `onOpenChange(false)` and never calls `onConfirm`.
3. Confirm calls `onConfirm()` once and requests `onOpenChange(false)`.
4. The caller decides whether the dialog actually closes. It may ignore the
   request and keep `open` true while `isPending` shows progress.
5. The dialog never awaits `onConfirm`, never inspects a return value, and never
   closes itself.

```tsx
const [open, setOpen] = useState(false);

<ConfirmationDialog
  open={open}
  onOpenChange={setOpen}
  onConfirm={moveToTrash}
  title="Move “Midnight Signal” to Trash?"
  description="You can restore it from Trash for 30 days."
/>
```

### 3.3 Pending behaviour

While `isPending` is true:

- Confirm and Cancel are disabled.
- Confirm has `aria-busy="true"`, a decorative spinner, and the
  `pendingLabel` text.
- The click handler returns early, so a duplicate confirmation cannot call
  `onConfirm` even if a click event arrives directly.
- Escape does not request closure, so a running operation is not unmounted.

### 3.4 Destructive variant

`variant="destructive"` styles the confirm button with the destructive button
variant and adds a destructive-toned `AlertTriangle`. It does not change the
dialog frame, because the vendored primitive owns that styling.

---

## 4. `ConsequenceList`

| Prop        | Type          | Default | Notes                              |
| ----------- | ------------- | ------- | ---------------------------------- |
| `items`     | `ReactNode[]` | required| One `<li>` per entry               |
| `label`     | `string`      | —       | Accessible name for the `<ul>`     |
| `className` | `string`      | —       | Merged with the list classes       |

- Renders `null` when `items` is empty, so no empty bullet list appears.
- Neutral styling by default: consequences may be positive (publishing) or
  destructive (permanent deletion), so the list does not imply a tone.
- The dialog supplies the visible section heading; `label` only names the list
  for assistive technology.

```tsx
<ConsequenceList
  items={[
    'Bookmarks and playback progress for this drama are deleted.',
    'Ratings and reviews stay anonymous for aggregate analytics.',
  ]}
/>
```

---

## 5. Accessibility Contract

| Concern              | Behaviour                                                      |
| -------------------- | --------------------------------------------------------------- |
| Dialog semantics     | Base UI alert dialog (`role="alertdialog"`)                     |
| Name and description | Base UI title/description wiring                                |
| Initial focus        | Cancel, via `initialFocus`                                      |
| Final focus          | Base UI default: the trigger, else the previously focused element |
| Keyboard             | Escape closes unless pending; focus is trapped; actions are native buttons |
| Safe default         | Cancel is focused first and visually secondary                  |
| Pending feedback     | `aria-busy`, disabled actions, visible `pendingLabel`           |
| Section headings     | `h3` inside labelled `section` elements, under the dialog `h2`  |
| Consequences         | Real `<ul>`/`<li>` list with an optional `aria-label`           |

---

## 6. Server and Client Boundary

`ConfirmationDialog` is a client component because Base UI's dialog is
client-side. `ConsequenceList` has no `"use client"` and can be rendered by a
Server Component.

`affectedContent`, `consequences`, `description`, and list items accept
`ReactNode`, so server-rendered summaries, counts, and links can be passed into
the client dialog.

`onConfirm` is a client callback. With Server Actions or an async client
mutation, wrap the call in `useTransition` so `isPending` stays accurate:

```tsx
'use client';

import { useState, useTransition } from 'react';

import { ConfirmationDialog } from '@/components/dialogs/confirmation-dialog';
import { ConsequenceList } from '@/components/dialogs/consequence-list';
import { publishDrama } from '@/modules/content';

export function PublishDramaButton({ id, title }: { id: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm(): void {
    startTransition(async () => {
      await publishDrama({ id });
      setOpen(false);
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Publish
      </button>
      <ConfirmationDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={handleConfirm}
        isPending={isPending}
        title={`Publish “${title}”?`}
        description="The drama becomes publicly visible immediately."
        affectedContent={<p>{title}</p>}
        consequences={
          <ConsequenceList
            items={[
              'Published episodes become available to guests.',
              'Unpublished episodes stay hidden.',
            ]}
          />
        }
        confirmLabel="Publish"
      />
    </>
  );
}
```

A Server Component must not pass an inline function to `onConfirm`; the
interactive wrapper above is the supported pattern.

---

## 7. When to Use a Confirmation Dialog

Use one when the operation is consequential and not trivially reversible:

- moving content to Trash;
- permanent deletion, single or bulk;
- publishing or unpublishing;
- restoring content or a backup that replaces current data;
- replacing an episode or movie video source;
- destructive settings changes and configuration imports;
- other operations the specification requires to be confirmed.

Do **not** use one for routine or immediately reversible interactions:

- opening an editor, preview, or details view;
- saving a draft or applying a filter;
- sorting, paginating, or switching tabs;
- toggling a preference that can be switched back without data loss;
- any action whose failure costs nothing.

---

## 8. Per-Operation Examples

### 8.1 Permanent deletion (Super Admin)

```tsx
<ConfirmationDialog
  open={open}
  onOpenChange={setOpen}
  onConfirm={permanentlyDelete}
  isPending={isPending}
  variant="destructive"
  title="Permanently delete “Midnight Signal”?"
  description="This cannot be undone."
  affectedContent={
    <ul className="list-disc space-y-1 pl-5">
      <li>1 drama</li>
      <li>3 seasons</li>
      <li>24 episodes</li>
      <li>1,204 bookmarks and progress records</li>
    </ul>
  }
  consequences={
    <ConsequenceList
      items={[
        'The drama, seasons, and episodes are removed from the database.',
        'Bookmarks, playback progress, and watch history are deleted.',
        'Ratings and reviews are retained anonymously for analytics.',
      ]}
    />
  }
  confirmLabel="Delete permanently"
/>
```

### 8.2 Restore from Trash

```tsx
<ConfirmationDialog
  open={open}
  onOpenChange={setOpen}
  onConfirm={restoreDrama}
  isPending={isPending}
  title="Restore “Midnight Signal”?"
  affectedContent={<p>Midnight Signal · 3 seasons · 24 episodes</p>}
  consequences={
    <ConsequenceList
      items={[
        'The drama returns to its previous publication state.',
        'Episodes unpublished before deletion stay unpublished.',
      ]}
    />
  }
  confirmLabel="Restore"
/>
```

### 8.3 Source replacement

```tsx
<ConfirmationDialog
  open={open}
  onOpenChange={setOpen}
  onConfirm={replaceSource}
  isPending={isPending}
  title="Replace the video source for Episode 4?"
  description="The new URL passed the browser playback preview."
  affectedContentLabel="Episode"
  affectedContent={<p>Midnight Signal · S1E4 · “The Long Night”</p>}
  consequencesLabel="What changes"
  consequences={
    <ConsequenceList
      items={[
        'Playback progress for this episode resets.',
        'Watch-history records keep their historical dates.',
        'The previous URL is not kept as a fallback.',
      ]}
    />
  }
  confirmLabel="Replace source"
/>
```

### 8.4 Bulk operation

```tsx
<ConfirmationDialog
  open={open}
  onOpenChange={setOpen}
  onConfirm={publishSelected}
  isPending={isPending}
  title="Publish 40 selected dramas?"
  affectedContent={
    <p>40 dramas selected · 3 have unverified episodes and will be skipped.</p>
  }
  consequences={
    <ConsequenceList
      items={[
        'Eligible dramas become publicly visible.',
        'Skipped dramas remain unpublished and are reported afterwards.',
      ]}
    />
  }
  confirmLabel="Publish 40 dramas"
/>
```

---

## 9. Tests

Component tests live in `tests/unit/components/` and opt into jsdom per file:

- `confirmation-dialog.test.tsx` — closed and open rendering, trigger,
  `defaultOpen`, cancel, confirm, custom labels, initial focus, trigger focus
  return, pending, duplicate prevention, Escape, destructive styling, sections,
  and omitted sections.
- `consequence-list.test.tsx` — items, empty input, accessible label, neutral
  styling, `className`.
- `dialog-boundary.test.ts` — `"use client"` placement for both modules.

Run them with:

```
npx vitest run tests/unit/components
```

---

## 10. Related Documents

- [State Components](state-components.md)
- [Testing Conventions](testing-conventions.md)
- [Coding Conventions](coding-conventions.md)
- Functional requirements: `docs/requirements/REQUIREMENTS.md` §8.1, §4.8, §5.7
- Design: `docs/superpowers/specs/2026-11-11-confirmation-dialogs-design.md`
