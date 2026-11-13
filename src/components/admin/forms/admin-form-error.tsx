import type { JSX, ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type AdminFormErrorProps = Readonly<{
  /** Alert heading. Defaults to "Could not save". */
  title?: string;
  /** Safe, user-facing error message. */
  message?: string;
  /** Optional action slot, for example a retry control. */
  children?: ReactNode;
  className?: string;
}>;

/**
 * Failure alert for a save that could not be completed. Presentational only:
 * the caller owns the error state and any retry action.
 */
export function AdminFormError({
  title = 'Could not save',
  message,
  children,
  className,
}: AdminFormErrorProps): JSX.Element {
  return (
    <div
      data-slot="admin-form-error"
      role="alert"
      className={cn(
        'rounded-xl border border-destructive/40 bg-destructive/5 px-6 py-14 text-center',
        className
      )}
    >
      <h2 className="text-base font-medium text-foreground">{title}</h2>
      {message ? <p className="mt-2 text-sm text-muted-foreground">{message}</p> : null}
      {children ? <div className="mt-6">{children}</div> : null}
    </div>
  );
}
