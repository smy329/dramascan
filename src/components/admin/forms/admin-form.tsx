'use client';

import { useEffect, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

import { Button } from '@/components/ui/button';
import { AdminFormError } from '@/components/admin/forms/admin-form-error';
import type { ActionError, ActionResult } from '@/lib/contracts/common';
import { cn } from '@/lib/utils';

export type AdminFormServerAction = (_payload: unknown) => Promise<ActionResult<unknown>>;

export type AdminFormProps = Readonly<{
  /** Domain create/edit schema; the single source of client and server validation rules. */
  schema: z.ZodType<Record<string, unknown>>;
  /** Server Action returning the standard ActionResult union. */
  serverAction: AdminFormServerAction;
  /** Initial values; required in spirit for edit forms, optional for create forms. */
  defaultValues?: Readonly<Record<string, unknown>>;
  /** Called after a successful save; navigation lives here. */
  onSuccess?: (_data: unknown) => void | Promise<void>;
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

/**
 * Shared admin create/edit form shell. Wires React Hook Form with the domain
 * Zod schema to a Server Action, owns the saving indicator, the server error
 * alert, and the dirty-state beforeunload warning. Server-side validation
 * remains authoritative; the client maps server field errors onto fields.
 */
export function AdminForm({
  schema,
  serverAction,
  defaultValues,
  onSuccess,
  resetOnSuccess = true,
  submitLabel = 'Save',
  pendingLabel = 'Saving…',
  className,
  children,
}: AdminFormProps): JSX.Element {
  const methods = useForm<Record<string, unknown>>({
    resolver: zodResolver(
      schema as z.ZodType<Record<string, unknown>, Record<string, unknown>>
    ),
    defaultValues: defaultValues ?? {},
    mode: 'onChange',
  });
  const { handleSubmit, formState: { isSubmitting, dirtyFields }, setError, reset } = methods;

  const [serverError, setServerError] = useState<ActionError | null>(null);
  const hasDirtyFields = Object.keys(dirtyFields).length > 0;

  useEffect(() => {
    if (!hasDirtyFields) {
      return undefined;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault();
      event.returnValue = 'You have unsaved changes.';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasDirtyFields]);

  async function handleValid(values: Record<string, unknown>): Promise<void> {
    const result = await serverAction(values);

    if (result.ok) {
      if (resetOnSuccess) {
        reset(defaultValues ?? {});
      }
      await onSuccess?.(result.data);
      return;
    }

    const error = result.error;

    if (error.fieldErrors) {
      for (const [field, messages] of Object.entries(error.fieldErrors)) {
        const firstMessage = Array.isArray(messages) ? messages[0] : messages;
        setError(field, { type: 'server', message: typeof firstMessage === 'string' ? firstMessage : undefined });
      }
    }

    setServerError(error);
  }

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleSubmit(handleValid)} noValidate className={cn('space-y-4', className)}>
        {serverError ? <AdminFormError message={serverError.message} /> : null}
        {children}
        <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting} className="w-fit">
          {isSubmitting ? pendingLabel : submitLabel}
        </Button>
      </form>
    </FormProvider>
  );
}
