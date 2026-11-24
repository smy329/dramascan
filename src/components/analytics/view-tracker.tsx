'use client';

import { useEffect } from 'react';

/**
 * The view tracker (Prompt 140).
 *
 * A details page reports that it was opened. The report is a beacon: it is
 * fire-and-forget, and a failure never reaches the viewer.
 *
 * The tracker renders nothing. It exists so the report happens in the browser
 * — where the anonymous session cookie can be refreshed by the server that
 * receives it — and not while the page is rendering on the server.
 */

export type ViewTrackerProps = {
  /** The content type of the opened title. */
  type: 'drama' | 'movie';
  /** The id of the opened title. */
  contentId: string;
};

export function ViewTracker({ type, contentId }: Readonly<ViewTrackerProps>): null {
  useEffect(() => {
    const controller = new AbortController();

    void fetch('/api/analytics/view', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, contentId }),
      signal: controller.signal,
      keepalive: true,
    }).catch(() => {
      // A failed view report must never interrupt the page.
    });

    return () => {
      controller.abort();
    };
  }, [type, contentId]);

  return null;
}
