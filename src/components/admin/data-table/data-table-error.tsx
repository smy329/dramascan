import type { JSX, ReactNode } from 'react';

import { RetryState } from '@/components/states/retry-state';

export type AdminTableErrorProps = Readonly<{
  label: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}>;

/**
 * Failure block for a data table. The caller supplies the retry action.
 */
export function AdminTableError({
  label,
  description,
  children,
  className,
}: AdminTableErrorProps): JSX.Element {
  return (
    <RetryState title={`Could not load ${label}`} description={description} className={className}>
      {children}
    </RetryState>
  );
}
