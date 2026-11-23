'use client';

import type { JSX } from 'react';
import { useState, useTransition } from 'react';

import { reportPlaybackFailureAction } from '@/workflows/playback/actions';

/**
 * "Report this playback problem".
 *
 * A viewer who cannot play an episode can tell an administrator about it.
 * The report describes the failure and never carries the source URL, so the
 * failure table cannot become a second copy of the content table.
 *
 * The action is a Server Action, so the reporter identity is resolved from
 * the session on the server: a viewer cannot report a failure on behalf of
 * somebody else.
 */
export function PlaybackFailureReport({
  episodeId,
}: Readonly<{ episodeId: string }>): JSX.Element {
  const [state, setState] = useState<'idle' | 'reported' | 'failed'>('idle');
  const [isPending, startTransition] = useTransition();

  const handleReport = () => {
    startTransition(async () => {
      const result = await reportPlaybackFailureAction({
        episodeId,
        reason: 'unknown',
      });

      setState(result.ok ? 'reported' : 'failed');
    });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleReport}
        disabled={isPending || state === 'reported'}
        className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium disabled:opacity-60"
      >
        {isPending ? 'Reporting…' : 'Report this problem'}
      </button>

      {state === 'reported' && (
        <span className="text-xs text-muted-foreground">
          Reported. Thank you — an administrator can see this.
        </span>
      )}

      {state === 'failed' && (
        <span className="text-xs text-destructive">The report could not be sent.</span>
      )}
    </div>
  );
}
