'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Flag } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { REVIEW_REPORT_REASONS, type ReviewReportReason } from '@/modules/reviews/report-reasons';
import { submitReviewReportAction } from '@/workflows/reviews/actions';

/**
 * The "report this review" control.
 *
 * A report opens a moderation case; it does not hide the review, so the
 * control says exactly that. The reasons are the approved catalog, and the
 * report is filed through a Server Action that resolves the reporter from the
 * session on the server.
 */
export type ReviewReportButtonProps = {
  /** The review being reported. */
  reviewId: string;
  /** Whether the viewer is signed in. */
  signedIn: boolean;
};

export function ReviewReportButton({
  reviewId,
  signedIn,
}: Readonly<ReviewReportButtonProps>): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReviewReportReason>('spam_advertising');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!signedIn) {
    return (
      <Link
        href="/auth/signin"
        className={cn(buttonVariants({ variant: 'ghost', size: 'xs' }), 'gap-1.5 text-muted-foreground')}
      >
        <Flag className="size-4" aria-hidden="true" />
        Report
      </Link>
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const result = await submitReviewReportAction({
        reviewId,
        reason,
        description: description.trim(),
      });

      if (result.ok) {
        setSubmitted(true);
        setMessage('Thanks. A moderator will look at this review.');

        return;
      }

      setError(result.error.message);
    });
  }

  if (submitted) {
    return (
      <span role="status" className="text-xs text-muted-foreground">
        Reported
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(buttonVariants({ variant: 'ghost', size: 'xs' }), 'gap-1.5 text-muted-foreground')}
      >
        <Flag className="size-4" aria-hidden="true" />
        Report
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="w-full space-y-3 rounded-lg border border-border bg-card/60 p-4">
      <p className="text-sm font-medium text-foreground">Report this review</p>

      <p className="text-xs text-muted-foreground">
        The review stays visible while a moderator looks at it.
      </p>

      <fieldset disabled={isPending} className="space-y-2">
        <legend className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Reason
        </legend>

        <div className="grid gap-1.5 sm:grid-cols-2">
          {REVIEW_REPORT_REASONS.map(option => {
            const selected = reason === option.value;

            return (
              <label
                key={option.value}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded border px-2.5 py-1.5 text-sm transition-colors',
                  selected
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                <input
                  type="radio"
                  name="review-report-reason"
                  value={option.value}
                  checked={selected}
                  onChange={() => setReason(option.value)}
                  className="sr-only"
                />
                {option.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-1">
        <label
          htmlFor={`review-report-description-${reviewId}`}
          className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"
        >
          Description (optional)
        </label>

        <textarea
          id={`review-report-description-${reviewId}`}
          name="description"
          value={description}
          onChange={event => setDescription(event.target.value)}
          maxLength={1000}
          rows={3}
          disabled={isPending}
          className="w-full resize-none rounded border border-border bg-background p-2 text-sm text-foreground outline-none focus:border-primary"
        />
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {message ? (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}
        >
          {isPending ? 'Sending...' : 'Send report'}
        </button>

        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={isPending}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
