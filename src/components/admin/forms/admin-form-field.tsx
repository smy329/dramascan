'use client';

import type { JSX } from 'react';
import { useFormContext } from 'react-hook-form';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type AdminFormFieldProps = Readonly<{
  /** Field name as registered with the parent `AdminForm` form context. */
  name: string;
  /** Visible field label. */
  label: string;
  /** Native input type. Defaults to `text`. */
  type?: string;
  /** Whether the field is required; marks the label and the control. */
  required?: boolean;
  /** Optional helper text rendered below the control. */
  hint?: string;
  /** Render a textarea instead of a single-line input. */
  multiline?: boolean;
  /** Optional native auto-complete hint. */
  autoComplete?: string;
  className?: string;
}>;

const CONTROL_CLASS_NAME =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40';

/**
 * Labeled form field bound to the parent `AdminForm` React Hook Form context.
 * Validation messages come from the shared form state and are rendered inline.
 */
export function AdminFormField({
  name,
  label,
  type = 'text',
  required = false,
  hint,
  multiline = false,
  autoComplete,
  className,
}: AdminFormFieldProps): JSX.Element {
  const { register, formState: { errors } } = useFormContext<Record<string, unknown>>();
  const error = errors[name];
  const errorMessage = error && typeof error === 'object' && 'message' in error ? error.message : undefined;
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter((id): id is string => id !== null)
    .join(' ') || undefined;

  const field = register(name);

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={name} className="text-sm font-medium text-foreground">
        {required ? `${label} *` : label}
      </label>
      {multiline ?
        <textarea
          id={name}
          className={CONTROL_CLASS_NAME}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...field}
        />
       :
        <Input
          id={name}
          type={type}
          autoComplete={autoComplete}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={CONTROL_CLASS_NAME}
          {...field}
        />
      }
      {hint ? <p id={hintId} className="text-xs text-muted-foreground">{hint}</p> : null}
      {errorMessage ?
        <p id={errorId} className="text-sm text-destructive">
          {errorMessage}
        </p>
       : null}
    </div>
  );
}
