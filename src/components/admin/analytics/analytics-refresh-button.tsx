'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

import { refreshAnalyticsAction } from '@/workflows/analytics/dashboard';

/**
 * The manual analytics refresh (Prompts 143, 146).
 *
 * The historical aggregates are written on demand: the administrator asks for
 * the selected range to be aggregated and the action does it and exits. There
 * is no queue, no worker, and no recurring schedule, so the dashboard's
 * refresh is exactly this one button.
 */

export type AnalyticsRefreshButtonProps = Readonly<{
  /** The first day of the range to aggregate. */
  startDate: string;
  /** The last day of the range to aggregate. */
  endDate: string;
}>;

export function AnalyticsRefreshButton({
  startDate,
  endDate,
}: Readonly<AnalyticsRefreshButtonProps>) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = () => {
    setMessage(null);

    startTransition(async () => {
      const result = await refreshAnalyticsAction({ startDate, endDate });

      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }

      setMessage('The analytics were refreshed.');
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={refresh}
        disabled={isPending}
        className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50"
      >
        <RefreshCw className={`size-4 ${isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
        {isPending ? 'Refreshing…' : 'Refresh data'}
      </button>

      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
