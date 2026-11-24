'use client';

import { useState, useTransition } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { resolveReportAction } from '@/workflows/admin/resolve-report-action';

/**
 * The content-report moderation queue.
 *
 * A report is resolved, not deleted: the row stays as moderation history and
 * records what was decided. The action re-checks the moderator permission on
 * the server.
 */

/** One report as the queue shows it. */
export type ContentReportRow = {
  id: string;
  contentType: 'drama' | 'movie';
  contentId: string;
  reason: string;
  description: string | null;
  status: 'pending' | 'reviewed' | 'resolved';
  createdAt: string;
};

export type ContentReportQueueProps = Readonly<{
  /** The reports to show. */
  reports: readonly ContentReportRow[];
}>;

export function ContentReportQueue({ reports }: ContentReportQueueProps): React.JSX.Element {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resolve(reportId: string, status: 'reviewed' | 'resolved') {
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const result = await resolveReportAction({
        reportId,
        status,
        note: notes[reportId] ?? '',
      });

      if (result.ok) {
        setMessage(`The report was marked as ${result.data.status}.`);

        return;
      }

      setError(result.error.message);
    });
  }

  return (
    <div className="space-y-4">
      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {reports.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-10 text-center text-sm text-muted-foreground">
          There are no content reports in this queue.
        </p>
      ) : (
        <ul className="space-y-3">
        {reports.map(report => (
          <li key={report.id} className="rounded-lg border border-border bg-card/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded border border-border px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                  {report.contentType}
                </span>
                <span className="font-medium text-foreground">{report.reason}</span>
                <span
                  className={cn(
                    'rounded px-2 py-0.5 text-xs',
                    report.status === 'pending'
                      ? 'bg-secondary text-secondary-foreground'
                      : 'bg-primary/10 text-primary'
                  )}
                >
                  {report.status}
                </span>
              </div>

              <time dateTime={report.createdAt} className="text-xs text-muted-foreground">
                {new Date(report.createdAt).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </time>
            </div>

            <p className="mt-2 font-mono text-xs text-muted-foreground">{report.contentId}</p>

            {report.description ? (
              <p className="mt-2 text-sm text-foreground">{report.description}</p>
            ) : null}

            {report.status === 'pending' ? (
              <div className="mt-4 space-y-3">
                <div className="space-y-1">
                  <label
                    htmlFor={`content-report-note-${report.id}`}
                    className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    Outcome note (optional)
                  </label>

                  <input
                    id={`content-report-note-${report.id}`}
                    type="text"
                    value={notes[report.id] ?? ''}
                    onChange={event =>
                      setNotes(current => ({ ...current, [report.id]: event.target.value }))
                    }
                    maxLength={1000}
                    disabled={isPending}
                    className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => resolve(report.id, 'reviewed')}
                    disabled={isPending}
                    className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  >
                    Mark reviewed
                  </button>

                  <button
                    type="button"
                    onClick={() => resolve(report.id, 'resolved')}
                    disabled={isPending}
                    className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}
                  >
                    Resolve
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
        </ul>
      )}
    </div>
  );
}
