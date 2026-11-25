'use client';

import { useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { refreshOperationalAnalyticsAction } from '@/workflows/analytics/dashboard';

/**
 * The operational analytics refresh (D-068).
 *
 * The dashboard's default range includes today, and today's numbers change
 * while the administrator watches. This component re-aggregates the current
 * Dhaka day once a minute and refreshes the page, but only while the tab is
 * visible: a background tab does not keep writing to the database.
 *
 * It renders nothing. The refresh is a bounded server action, not a worker:
 * there is no queue, no interval on the server, and nothing runs when the page
 * is closed.
 */

/** How often a visible dashboard re-aggregates today. */
export const OPERATIONAL_REFRESH_INTERVAL_MS = 60_000;

export function OperationalRefresh() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const runningRef = useRef(false);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (runningRef.current || document.visibilityState !== 'visible') {
        return;
      }

      runningRef.current = true;

      startTransition(async () => {
        try {
          const result = await refreshOperationalAnalyticsAction();

          if (result.ok) {
            router.refresh();
          }
        } finally {
          runningRef.current = false;
        }
      });
    }, OPERATIONAL_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [router, startTransition]);

  return null;
}
