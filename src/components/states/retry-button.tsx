'use client';

import type { JSX } from 'react';
import { Loader2 } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type RetryButtonProps = Readonly<{
  onRetry: () => void;
  isRetrying?: boolean;
  label?: string;
  retryingLabel?: string;
  disabled?: boolean;
  className?: string;
}>;

function renderSpinner(isRetrying: boolean): JSX.Element | null {
  if (!isRetrying) {
    return null;
  }

  return <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />;
}

function renderRetryingAnnouncement(
  isRetrying: boolean,
  retryingLabel: string
): JSX.Element | null {
  if (!isRetrying) {
    return null;
  }

  return (
    <span role="status" aria-live="polite" className="sr-only">
      {retryingLabel}
    </span>
  );
}

/**
 * Client island for an interactive retry. The caller owns the retry operation
 * and must flip `isRetrying` while it runs; the button blocks duplicate clicks
 * in the meantime.
 */
export function RetryButton({
  onRetry,
  isRetrying = false,
  label = 'Try again',
  retryingLabel = 'Retrying…',
  disabled = false,
  className,
}: RetryButtonProps): JSX.Element {
  function handleClick(): void {
    if (isRetrying) {
      return;
    }

    onRetry();
  }

  return (
    <>
      <button
        type="button"
        data-slot="retry-button"
        className={cn(buttonVariants({ variant: 'default', size: 'default' }), className)}
        onClick={handleClick}
        disabled={disabled || isRetrying}
        aria-busy={isRetrying ? true : undefined}
      >
        {renderSpinner(isRetrying)}
        {isRetrying ? retryingLabel : label}
      </button>
      {renderRetryingAnnouncement(isRetrying, retryingLabel)}
    </>
  );
}
