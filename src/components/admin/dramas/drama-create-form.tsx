'use client';

import type { JSX, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useFormContext } from 'react-hook-form';
import type { z } from 'zod';

import { AdminForm } from '@/components/admin/forms/admin-form';
import { AdminFormField } from '@/components/admin/forms/admin-form-field';
import {
  DRAMA_FORM_DEFAULTS,
  DRAMA_STATUS_OPTIONS,
  DRAMA_STRUCTURE_OPTIONS,
  dramaFormSchema,
  type DramaTaxonomyOption,
} from '@/lib/contracts/drama-form';
import { createDramaAction } from '@/workflows/admin/drama-actions';

export type DramaCreateFormProps = Readonly<{
  /** Active categories offered by the form. */
  categories: readonly DramaTaxonomyOption[];
  /** Active platforms offered by the form. */
  platforms: readonly DramaTaxonomyOption[];
}>;

const CONTROL_CLASS_NAME =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive';

type SelectOption = Readonly<{ value: string; label: string }>;

function fieldError(errors: unknown, name: string): string | undefined {
  if (typeof errors !== 'object' || errors === null) {
    return undefined;
  }

  const error = (errors as Record<string, unknown>)[name];

  return error && typeof error === 'object' && 'message' in error
    ? ((error as { message?: unknown }).message as string | undefined)
    : undefined;
}

function SelectField({
  name,
  label,
  options,
  required = false,
  hint,
}: Readonly<{
  name: string;
  label: string;
  options: readonly SelectOption[];
  required?: boolean;
  hint?: string;
}>): JSX.Element {
  const {
    register,
    formState: { errors },
  } = useFormContext<Record<string, unknown>>();
  const errorMessage = fieldError(errors, name);
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-sm font-medium text-foreground">
        {required ? `${label} *` : label}
      </label>
      <select
        id={name}
        className={CONTROL_CLASS_NAME}
        required={required}
        aria-invalid={errorMessage ? true : undefined}
        aria-describedby={[errorId, hint ? hintId : null].filter(Boolean).join(' ') || undefined}
        {...register(name)}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {errorMessage ? (
        <p id={errorId} className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

function CheckboxGroupField({
  name,
  label,
  options,
  emptyMessage,
  hint,
}: Readonly<{
  name: string;
  label: string;
  options: readonly DramaTaxonomyOption[];
  emptyMessage: ReactNode;
  hint?: string;
}>): JSX.Element {
  const {
    register,
    formState: { errors },
  } = useFormContext<Record<string, unknown>>();
  const errorMessage = fieldError(errors, name);
  const errorId = `${name}-error`;

  return (
    <fieldset className="space-y-2" aria-describedby={errorMessage ? errorId : undefined}>
      <legend className="text-sm font-medium text-foreground">{label}</legend>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {options.map(option => (
            <label
              key={option.id}
              htmlFor={`${name}-${option.id}`}
              className="flex items-center gap-2 text-sm text-foreground"
            >
              <input
                id={`${name}-${option.id}`}
                type="checkbox"
                value={option.id}
                className="size-4 rounded border-input"
                {...register(name)}
              />
              {option.name}
            </label>
          ))}
        </div>
      )}
      {errorMessage ? (
        <p id={errorId} className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * Admin form for creating a drama.
 *
 * Every field required by Prompt 053 is present. Two fields are always
 * submitted: the Ongoing/Completed status and the episode structure, so a
 * drama is created either season-based or flat from the start. The form never
 * exposes a release year. On success it navigates back to the drama list,
 * where the new row is visible.
 */
export function DramaCreateForm({ categories, platforms }: DramaCreateFormProps): JSX.Element {
  const router = useRouter();

  return (
    <AdminForm
      schema={dramaFormSchema as z.ZodType<Record<string, unknown>>}
      serverAction={createDramaAction}
      defaultValues={DRAMA_FORM_DEFAULTS}
      resetOnSuccess={false}
      submitLabel="Create drama"
      pendingLabel="Creating…"
      onSuccess={() => {
        router.push('/admin/dramas');
        router.refresh();
      }}
    >
      <AdminFormField name="title" label="Title" required autoComplete="off" />
      <AdminFormField
        name="slug"
        label="Slug"
        required
        autoComplete="off"
        hint="Lowercase letters, numbers, and hyphens. Used in the public URL."
      />
      <AdminFormField name="description" label="Description" multiline />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField name="status" label="Status" options={DRAMA_STATUS_OPTIONS} required />
        <SelectField
          name="structure_type"
          label="Episode structure"
          options={DRAMA_STRUCTURE_OPTIONS}
          required
          hint="The structure cannot be changed later on this form; use structure conversion."
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminFormField name="poster" label="Poster URL" type="url" autoComplete="off" />
        <AdminFormField name="banner" label="Banner URL" type="url" autoComplete="off" />
      </div>
      <CheckboxGroupField
        name="categories"
        label="Categories"
        options={categories}
        emptyMessage="No categories exist yet. Create categories before associating them."
      />
      <CheckboxGroupField
        name="platforms"
        label="Platforms"
        options={platforms}
        emptyMessage="No platforms exist yet. Create platforms before associating them."
      />
    </AdminForm>
  );
}
