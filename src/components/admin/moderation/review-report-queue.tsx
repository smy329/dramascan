'use client';

import { useState, useTransition } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  removeReviewAction,
  resolveReviewReportAction,
} from '@/workflows/moderation/review-moderation';

/**
 * The review-report moderation queue.
 *
 * A report is resolved with a written outcome, and the reporter is told what
 * was decided. Removing the review is a separate, permanent action: it is the
 * only way a review disappears, and it cannot be undone.
 */

/** One report as the queue shows it. */
export type ReviewReportRow = {
  id: string;
  reviewId: string | null;
  reviewIdSnapshot: string | null;
  reason: string;
  description: string | null;
  status: 'active' | 'resolved';
  reviewTitle: string | null;
  reviewContent: string | null;
  reviewRemoved: boolean;
  createdAt: string;
};

export type ReviewReportQueueProps = Readonly<{
  /** The reports to show. */
  reports: readonly ReviewReportRow[];
  /** Whether the moderator may permanently remove a review. */
  canRemove: boolean;
}>;

export function ReviewReportQueue({
  reports,
  canRemove,
}: ReviewReportQueueProps): React.JSX.Element {
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resolve(reportId: string) {
    setError(null);
    setMessage(null);

    const outcome = (outcomes[reportId] ?? '').trim();

    if (outcome.length === 0) {
      setError('Write what was decided before resolving the report.');

      return;
    }

    startTransition(async () => {
      const result = await resolveReviewReportAction({ reportId, outcome });

      if (result.ok) {
        setMessage('The report was resolved and the reporter was notified.');

        return;
      }

      setError(result.error.message);
    });
  }

  function remove(reviewId: string) {
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const result = await removeReviewAction({ reviewId });

      if (result.ok) {
        setMessage('The review was permanently removed.');

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
          There are no review reports in this queue.
        </p>
      ) : (
        <ul className="space-y-3">
        {reports.map(report => {
          const reviewId = report.reviewId ?? report.reviewIdSnapshot;

          return (
            <li key={report.id} className="rounded-lg border border-border bg-card/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-foreground">{report.reason}</span>
                  <span
                    className={cn(
                      'rounded px-2 py-0.5 text-xs',
                      report.status === 'active'
                        ? 'bg-secondary text-secondary-foreground'
                        : 'bg-primary/10 text-primary'
                    )}
                  >
                    {report.status}
                  </span>
                  {report.reviewRemoved ? (
                    <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
                      review removed
                    </span>
                  ) : null}
                </div>

                <time dateTime={report.createdAt} className="text-xs text-muted-foreground">
                  {new Date(report.createdAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </time>
              </div>

              {report.reviewTitle || report.reviewContent ? (
                <blockquote className="mt-3 space-y-1 border-l-2 border-border pl-3">
                  {report.reviewTitle ? (
                    <p className="text-sm font-medium text-foreground">{report.reviewTitle}</p>
                  ) : null}
                  {report.reviewContent ? (
                    <p className="text-sm text-muted-foreground">{report.reviewContent}</p>
                  ) : null}
                </blockquote>
              ) : null}

              {report.description ? (
                <p className="mt-3 text-sm text-foreground">
                  <span className="font-medium">Reporter: </span>
                  {report.description}
                </p>
              ) : null}

              {report.status === 'active' ? (
                <div className="mt-4 space-y-3">
                  <div className="space-y-1">
                    <label
                      htmlFor={`review-report-outcome-${report.id}`}
                      className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"
                    >
                      Resolution outcome
                    </label>

                    <input
                      id={`review-report-outcome-${report.id}`}
                      type="text"
                      value={outcomes[report.id] ?? ''}
                      onChange={event =>
                        setOutcomes(current => ({ ...current, [report.id]: event.target.value }))
                      }
                      maxLength={1000}
                      disabled={isPending}
                      placeholder="What was decided about this review?"
                      className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => resolve(report.id)}
                      disabled={isPending}
                      className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}
                    >
                      Resolve report
                    </button>

                    {canRemove && reviewId && !report.reviewRemoved ? (
                      <button
                        type="button"
                        onClick={() => remove(reviewId)}
                        disabled={isPending}
                        className={cn(buttonVariants({ variant: 'destructive', size: 'sm' }))}
                      >
                        Remove the review permanently
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
        </ul>
      )}
    </div>
  );
}
