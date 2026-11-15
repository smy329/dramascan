# Admin Form Patterns (Prompt 052) — Design

**Status:** Proposed — awaiting approval
**Date:** 2026-11-13
**Requirement:** `docs/requirements/REQUIREMENTS.md` §8.1 (administrator features), §5.2–§5.3 (administrator input validation)
**Builds on:** Prompt 049 (`2026-11-12-admin-layout-design.md`), Prompt 050 (`2026-11-12-admin-sidebar-breadcrumbs-design.md`), Prompt 051 (`2026-11-12-admin-data-tables-design.md` — the listing-side sibling kit)

## 1. Intent

The admin shell (Prompts 049–050) and the admin data-table kit (Prompt 051) now give administrators navigation, an access gate, and listing patterns. No create/edit form pattern exists yet; the only forms today are the admin table toolbar GET forms and the Google sign-in form.

Every future admin create/edit surface — dramas, movies, seasons, episodes, categories, platforms, information pages, settings — needs one reusable pattern covering:

- the create/edit form shell (React Hook Form + Zod, Server Action submission),
- validation messages (client-side and server-side),
- dirty-state warnings,
- saving indicators,
- server error display.

This prompt builds that shared pattern set. It is deliberately **not** an entity CRUD prompt: no drama/movie/season/episode schema, workflow, route, or page is created here.

## 2. Goals / Non-goals / Anti-goals

### Goals

1. A reusable admin form kit in `src/components/admin/forms/` covering all five patterns.
2. Client-side validation through React Hook Form with a Zod resolver over the caller-supplied domain schema.
3. Submission through a Server Action returning the standard `ActionResult`; the server re-validates and stays authoritative; the client maps server `fieldErrors` onto form fields.
4. Dirty-state warning (`beforeunload`) while unsaved changes exist.
5. Saving indicator driven by React Hook Form's `isSubmitting`.
6. Server error display: one safe alert (`role="alert"`) plus field-level surfacing.

### Non-goals

- No entity-specific create/edit pages or CRUD workflows (later prompts own those).
- No new Server Actions or domain Zod schemas for new entities — the kit takes schemas and actions as props; module-owned `validation.ts` schemas remain the single source for entities.
- No router-level dirty-navigation blocker.
- No new permission keys, admin API surface, or persistence logic.

### Anti-goals

- Treating client-side validation as authoritative.
- Rendering an indefinite pending state or swallowing failures.

## 3. Constraints

- `CONVENTIONS.md` §6.3: Server Actions return `{ ok: true; data } | { ok: false; error }` via `mapErrorToActionResult`; they never throw raw errors across the boundary.
- `CONVENTIONS.md` §6.4 / `error-handling.md`: validate untrusted input with Zod on every boundary; `ActionError = { code, message, fieldErrors?, requestId? }`.
- `ARCHITECTURE.md` §7: `components` may import `lib`/`lib/contracts` and shared UI only — never modules. The kit therefore accepts the schema and action as caller-supplied dependencies and owns no domain schema.
- `REQUIREMENTS.md` §8.1, §5.2–§5.3: server-side validation is authoritative; validation errors appear next to the field (for example the direct MP4 URL field of §5.3).
- `TESTING.md` conventions: component tests in `tests/unit/components/`, jsdom opt-in, React Testing Library, `cleanup` in `afterEach`, user-observable assertions.

## 4. Decisions already made (project-established)

| Decision | Choice |
| --- | --- |
| Form stack | React Hook Form + `@hookform/resolvers` `zodResolver` over the domain Zod schema; submission via Server Action. (`CONVENTIONS.md` §6.3; `REQUIREMENTS.md` §8.1.) |
| Schema ownership | Caller-supplied Zod schema; the shared kit holds no domain schema. Module-owned `validation.ts` schemas remain the single source for entities. |
| Server Action contract | Action returns `{ ok: true; data } \| { ok: false; error }`; the client maps `error.fieldErrors` onto RHF fields via `setError` and renders `error.message` through the alert. |

## 5. Approaches considered

### 5.1 Location of the shared kit

- **A. `src/components/admin/forms/` (chosen).** Mirrors the `src/components/admin/data-table/` layout: admin-scoped shared patterns grouped by concern, no barrel, kebab-case file names, direct imports, same boundary rules.
- **B. `src/components/ui/form.tsx`.** Rejected: the vendored UI kit is built on Base UI (`@base-ui/react`), not Radix; a shadcn/Radix-style form stack would drag in a second component library.
- **C. `src/components/forms/` (cross-admin).** Deferred; the prompt is admin-scoped and a future shared location can be revisited without moving code.

### 5.2 Client validation

- **A. React Hook Form + `zodResolver` over the caller-supplied schema (chosen).** Live validation (`mode: 'onChange'`); resolver output feeds `handleSubmit`.
- **B. Hand-rolled validators next to RHF registration.** Rejected: duplicates the domain Zod schema and violates the "parse, don't cast / validate in one place" convention.

### 5.3 Server error → field error mapping

- **A. Map `ActionError.fieldErrors` onto RHF fields via `setError`, render `ActionError.message` via the alert (chosen).**

### 5.4 Dirty-state warning

- **A. `beforeunload` while any field is dirty, driven by RHF `formState.dirtyFields` (chosen).** Cleanup on unmount / when clean.

### 5.5 Saving indicator

- **A. React Hook Form `isSubmitting` produced by the async `handleSubmit` handler (chosen).** Submit control disabled, `aria-busy`, pending label.

### 5.6 Server error display

- **A. Presentational `AdminFormError` alert (`role="alert"`) with an optional action slot; field-level messages rendered by `AdminFormField`. (Chosen.)**

## 6. Detailed design

### 6.1 New files (the kit)

| File | Exports | Boundary |
| --- | --- | --- |
| `src/components/admin/forms/admin-form.tsx` | `AdminForm` | **Client** |
| `src/components/admin/forms/admin-form-field.tsx` | `AdminFormField` | **Client** |
| `src/components/admin/forms/admin-form-error.tsx` | `AdminFormError` | Presentational (no directive; rendered by the client shell) |

No barrel `index.ts` (convention); direct imports only; kebab-case; mirrors `admin/data-table/`.

### 6.2 `AdminForm` — the shell

```ts
export type AdminFormServerAction = (payload: unknown) => Promise<ActionResult<unknown>>;

export type AdminFormProps = Readonly<{
  /** Domain create/edit schema; the single source of client and server validation rules. */
  schema: z.ZodType;
  /** Server Action reference. Returns the standard ActionResult union. */
  serverAction: AdminFormServerAction;
  /** Initial values; required in spirit for edit forms, optional for create forms. */
  defaultValues?: Readonly<Record<string, unknown>>;
  /** Called after a successful save; navigation lives here. */
  onSuccess?: (data: unknown) => void | Promise<void>;
  /** Reset the form after a successful save. Default: true. */
  resetOnSuccess?: boolean;
  /** Submit label. Default: 'Save'. */
  submitLabel?: string;
  /** Pending label. Default: 'Saving…'. */
  pendingLabel?: string;
  className?: string;
  /** Fields; register through the RHF context provided by the shell. */
  children: ReactNode;
}>;
```

Behavior:

1. `useForm({ resolver: zodResolver(schema), defaultValues, mode: 'onChange' })`.
2. Render `<FormProvider {...methods}>` around `<form onSubmit={handleSubmit(onValid, onInvalid)} noValidate>`.
3. `onValid`: `const result = await serverAction(data)`. On `ok`, reset when `resetOnSuccess` and call `onSuccess`. On `ok: false`, map `error.fieldErrors` via `setError` and hold the error for the alert.
4. Submit footer: `<Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>…{isSubmitting ? pendingLabel : submitLabel}</Button>`.

### 6.3 `AdminFormField` — labeled field with validation message

Props: `name`, `label`, `type?` (`'text'` default; any native input type), `required?`, `hint?`, `multiline?`, `autoComplete?`, `className?`.

- Reads field state from `useFormContext()`.
- Renders `<label htmlFor={…}>`, the control, hint, and the error `<p id={`${name}-error`}>`; wires `aria-invalid` and `aria-describedby` on the control.

### 6.4 `AdminFormError` — server error alert

Props: `title?`, `message?`, `children?` (optional action slot), `className?`.

- Renders a destructive-tinted panel with `role="alert"`; heading default `'Could not save'`; optional action slot.

### 6.5 Pattern wiring

Create and edit forms use the same shell; edits pass `defaultValues` from the existing record. Dirty state is `formState.dirtyFields` from the shell context, exposed through the same RHF context so pages can render unsaved-changes affordances.

## 7. Flagged decisions (awaiting your approval)

1. **Kit contents:** include `AdminForm`, `AdminFormField`, and `AdminFormError` (three files, mirroring the data-table kit's granularity). *Recommendation: yes.*
2. **Dirty-state warning:** `beforeunload` only. *Recommendation: yes; router-level blocking is out of scope.*
3. **`noValidate`:** set on the shared form so Zod owns validation messages. *Recommendation: yes.*
4. **Dependency addition:** `react-hook-form` + `@hookform/resolvers` (zodResolver). *Recommendation: proceed — mandated by `CONVENTIONS.md` §6.3 and `REQUIREMENTS.md` §8.1.*

## 8. Testing plan (proposed)

| Area | File |
| --- | --- |
| Error alert | `tests/unit/components/admin-form-error.test.tsx` |
| Field | `tests/unit/components/admin-form-field.test.tsx` |
| Shell | `tests/unit/components/admin-form.test.tsx` |

No integration or E2E tests: the kit has no entity surface yet; the existing suites must stay green.

## 9. Verification plan (post-approval)

- `npm install react-hook-form @hookform/resolvers`
- `npm run typecheck`, `npm run lint`, `npx vitest run tests/unit/components`, `npm run build`.

## 10. Related documents

- [Admin Shell](admin-shell.md), [Admin Data Tables](admin-data-tables.md), [State Components](state-components.md), [Confirmation Dialogs](confirmation-dialogs.md)
- `docs/requirements/REQUIREMENTS.md` §8.1, §5.2–§5.3
- `docs/development/CONVENTIONS.md` §6.3/§6.4, `docs/development/error-handling.md`, `docs/development/api-conventions.md` §2.7
- Design precedent: `2026-11-12-admin-data-tables-design.md`
