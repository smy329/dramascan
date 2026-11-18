import type { JSX, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useFormContext } from 'react-hook-form';

import { dramaFormSchema } from '@/lib/contracts/drama-form';
import { AdminForm } from '@/components/admin/forms/admin-form';
import { AdminFormField } from '@/components/admin/forms/admin-form-field';
import { AdminFormSelectField } from '@/components/admin/forms/admin-form-select-field';
import {
  DRAMA_FORM_DEFAULTS,
  DRAMA_STATUS_OPTIONS,
  DRAMA_STRUCTURE_OPTIONS,
} from '@/lib/contracts/drama-form';
import { createDramaAction } from '@/workflows/admin/drama-actions';

export type DramaCreateFormProps = Readonly<{
  categories: readonly DramaTaxonomyOption[];
  platforms: readonly DramaTaxonomyOption[];
}>;

type DramaTaxonomyOption = Readonly<{ id: string; name: string }>;

function fieldError(errors: unknown, name: string): string | undefined {
  if (typeof errors !== 'object' || errors === null) {
    return undefined;
  }

  const error = (errors as Record<string, unknown>)[name];

  return error && typeof error === 'object' && 'message' in error
    ? ((error as { message?: unknown }).message as string | undefined)
    : undefined;
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
      schema={dramaFormSchema}
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
      <AdminFormField
        name="title"
        label="Title"
        required
        autoComplete="off"
        hint="The URL slug is generated from the title."
      />
      <AdminFormField name="description" label="Description" multiline />
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminFormSelectField
          name="status"
          label="Status"
          options={DRAMA_STATUS_OPTIONS}
          required
        />
        <AdminFormSelectField
          name="structure_type"
          label="Episode structure"
          options={DRAMA_STRUCTURE_OPTIONS}
          required
          hint="The structure cannot be changed later on this form; use structure conversion."
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminFormField name="poster" label="Poster" type="file" autoComplete="off" />
        <AdminFormField name="banner" label="Banner" type="file" autoComplete="off" />
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

