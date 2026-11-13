# Admin Forms

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Version:** 1.0  
**Date:** 2026-11-13  

This document describes the reusable admin form kit created by Prompt 052. The kit lives in `src/components/admin/forms/` and provides shared patterns for admin create/edit forms, covering all five user-observable concerns in a single integration point.

---

## 1. Principles

- **Client-side validation through React Hook Form + Zod.** A domain Zod schema supplied by the caller is the single source of validation rules; `zodResolver` wires the schema to RHF, and `mode: 'onChange'` gives live validation. Client validation is a convenience; the server re-validates and stays authoritative (`CONVENTIONS.md` §6.3/§6.4).
- **Server-side validation authoritative.** Server Actions return `{ ok: true; data } | { ok: false; error }` via `mapErrorToActionResult`. The client maps `error.fieldErrors` onto form fields via `setError` and renders `error.message` through the alert. Never trust client validation alone (`REQUIREMENTS.md` §8.1, §5.2–§5.3).
- **Dirty-state warning** via `beforeunload` driven by RHF `formState.dirtyFields` from the shared shell context. Cleanup on unmount and when the form is clean (`CONVENTIONS.md` §6.3).
- **Saving indicator** driven by RHF `isSubmitting` produced by the async `handleSubmit` handler. Submit control disabled, `aria-busy`, pending label swap.
- **Server error display** via the presentational `AdminFormError` alert (`role="alert"`). Optional action slot for retry. Field-level messages rendered by `AdminFormField`.
- **No module import from the kit.** Components may import `lib`/`lib/contracts` and shared UI only (`ARCHITECTURE.md` §7). The kit owns no domain schema; schemas and actions are caller-supplied dependencies.
- **Shared form shell** is used by both create and edit forms; edits pass `defaultValues` from the existing record.
- **`noValidate`** on the `<form>` so Zod owns all validation messages.

---

## 2. Files and Boundaries

| File                          | Exports                              | Boundary   |
| ----------------------------- | -------------------------------------- | ---------- |
| `src/components/admin/forms/admin-form-error.tsx` | `AdminFormError`                     | Presentational (no directive; rendered by client shell) |
| `src/components/admin/forms/admin-form-field.tsx` | `AdminFormField`                     | Client     |
| `src/components/admin/forms/admin-form.tsx` | `AdminForm`                          | Client     |

No barrel `index.ts` (`CONVENTIONS.md` §2.2); direct imports only; kebab-case; mirrors `src/components/admin/data-table/`.

| Responsibility                          | File(s)                                              |
| ---------------------------------------- | ---------------------------------------------------- |
| **Domain schema**                      | Caller-supplied Zod schema; modules own their `validation.ts` |
| **Server Action**                      | Caller-supplied action returning `ActionResult<unknown>` |
| **Shared kit — `src/components/admin/forms/`** | All three component files, exports, patterns         |
| **UI primitives**                      | `src/components/ui/input.tsx`, `src/components/ui/button.tsx` |
| **Contracts**                          | `src/lib/contracts/common.ts` (`ActionError`, `ActionResult`) |

---

## 3. Component APIs

### `AdminFormError`

Props: `title?`, `message?`, `children?` (optional action slot), `className?`.

- Renders a destructive-tinted panel with `role="alert"`.
- Heading defaults to `'Could not save'`; custom title via `title` prop.
- `message` rendered in a `<p>` below the heading.
- `children` rendered in an optional action slot below the message.
- Presentational only — the caller owns the error state and any retry action.

### `AdminFormField`

Props: `name`, `label`, `type?` (`'text'` default), `required?`, `hint?`, `multiline?`, `autoComplete?`, `className?`.

- Reads field state from `useFormContext()`.
- Renders `<label htmlFor={…}>`, the control (Input or textarea), hint, and the error `<p id={`${name}-error`}>`.
- Wires `aria-invalid` and `aria-describedby` on the control.
- Required → label shows `${label} *`.

### `AdminForm`

Props: `schema`, `serverAction`, `defaultValues?`, `onSuccess?`, `resetOnSuccess?`, `submitLabel?`, `pendingLabel?`, `className?`, `children`.

- `useForm({ resolver: zodResolver(schema), defaultValues, mode: 'onChange' })`.
- Renders `<FormProvider {...methods}>` around `<form onSubmit={handleSubmit(handleValid)} noValidate>`.
- On submit: `const result = await serverAction(values)`. On `ok`, reset and call `onSuccess`. On `ok: false`, map `error.fieldErrors` via `setError` and display `AdminFormError`.
- Submit footer: `<Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? pendingLabel : submitLabel}</Button>`.
- `beforeunload` dirty-state warning via `formState.dirtyFields`.
- `{serverError ? <AdminFormError message={serverError.message} /> : null}`.

---

## 4. Pattern Wiring

Create and edit forms use the same shell; edits pass `defaultValues` from the existing record. The form wires all patterns in one place — the administrator sees validation messages, dirty-state warnings, saving indicators, and server errors consistently across every admin create/edit surface.

---

## 5. Related Documents

- [Admin Data Tables](admin-data-tables.md) — the listing-side sibling kit (Prompt 051).
- [Admin Shell](admin-shell.md) — admin area navigation and access gate.
- [State Components](state-components.md) — empty/skeleton/retry states.
- [Confirmation Dialogs](confirmation-dialogs.md) — server-compatible confirmation flow.
- [Testing Conventions](testing-conventions.md) — component tests use RTL + jsdom.
- [Coding Conventions](coding-conventions.md) — conventions for this codebase.
- Decisions: `docs/decisions/DECISIONS.md` D-022 (Super Admin bootstrap).
- Design: `docs/superpowers/specs/2026-11-13-admin-form-patterns-design.md`.
- Plan: `docs/superpowers/plans/2026-11-13-admin-form-patterns.md`.