'use client';

import type { JSX } from 'react';
import { useFormContext } from 'react-hook-form';

import { cn } from '@/lib/utils';

export type AdminFormSelectOption = Readonly<{ value: string; label: string }>;

export type AdminFormSelectFieldProps = Readonly<{
  /** Field name as registered with the parent `AdminForm` form context. */
  name: string;
  /** Visible field label. */
  label: string;
  /** Options rendered in order; the first is selected when no default exists. */
  options: readonly AdminFormSelectOption[];
  /** Whether the field is required; marks the label and the control. */
  required?: boolean;
  /** Optional helper text rendered below the control. */
  hint?: string;
  className?: string;
}>;

const SELECT_CLASS_NAME =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive';

function fieldError(errors: unknown, name: string): string | undefined {
  if (typeof errors !== 'object' || errors === null) {
    return undefined;
  }

  const error = (errors as Record<string, unknown>)[name];

  return error && typeof error === 'object' && 'message' in error
    ? ((error as { message?: unknown }).message as string | undefined)
    : undefined;
}

/**
 * Labeled select bound to the parent `AdminForm` React Hook Form context.
 *
 * Same registration, labelling and error rendering as `AdminFormField`, so a
 * form can mix text inputs and selects without a second validation path.
 */
export function AdminFormSelectField({
  name,
  label,
  options,
  required = false,
  hint,
  className,
}: AdminFormSelectFieldProps): JSX.Element {
  const {
    register,
    formState: { errors },
  } = useFormContext<Record<string, unknown>>();
  const errorMessage = fieldError(errors, name);
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const describedBy =
    [errorMessage ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={name} className="text-sm font-medium text-foreground">
        {required ? `${label} *` : label}
      </label>
      <select
        id={name}
        className={SELECT_CLASS_NAME}
        required={required}
        aria-invalid={errorMessage ? true : undefined}
        aria-describedby={describedBy}
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
