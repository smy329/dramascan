'use client';

import { useState, type JSX } from 'react';

import { AdminTableError } from '@/components/admin/data-table/data-table-error';
import { RetryButton } from '@/components/states/retry-button';

export default function AdminUsersError({
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): JSX.Element {
  const [isRetrying, setIsRetrying] = useState(false);

  function handleRetry(): void {
    setIsRetrying(true);
    reset();
  }

  return (
    <AdminTableError label="users" description="The request failed. Try again.">
      <RetryButton onRetry={handleRetry} isRetrying={isRetrying} />
    </AdminTableError>
  );
}
