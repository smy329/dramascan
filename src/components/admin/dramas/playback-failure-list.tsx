import type { JSX } from 'react';

/**
 * The playback failures an administrator can see.
 *
 * The list shows what viewers reported. It does not claim to show every
 * failure: the application server never fetches the media, so a source that
 * stops working without anybody reporting it is invisible here. Only a
 * browser can observe that the source does not play, and the browser reports
 * it through the failure-report action.
 */

export type PlaybackFailureRow = {
  id: string;
  episodeId: string;
  episodeTitle: string;
  reason: string;
  detail: string | null;
  reportedBy: string | null;
  createdAt: string;
};

function formatDate(value: string): string {
  return new Date(value).toISOString().slice(0, 16).replace('T', ' ');
}

export function PlaybackFailureList({
  failures,
}: Readonly<{ failures: readonly PlaybackFailureRow[] }>): JSX.Element {
  return (
    <section
      aria-label="Reported playback failures"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <h2 className="text-sm font-medium text-foreground">Reported playback failures</h2>

      <p className="text-xs text-muted-foreground">
        These are the failures viewers reported for the episodes of this drama. A source that
        stops working without anybody reporting it is not listed: the server never fetches the
        media, so it cannot detect a failure on its own.
      </p>

      {failures.length === 0 ? (
        <p className="text-sm text-muted-foreground">No playback failure has been reported.</p>
      ) : (
        <ul className="space-y-2">
          {failures.map(failure => (
            <li
              key={failure.id}
              className="space-y-1 rounded-lg border border-border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-foreground">{failure.episodeTitle}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(failure.createdAt)}
                </span>
              </div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {failure.reason}
                {failure.reportedBy ? ' · reported by a signed-in viewer' : ' · reported anonymously'}
              </p>
              {failure.detail ? <p className="text-foreground">{failure.detail}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
