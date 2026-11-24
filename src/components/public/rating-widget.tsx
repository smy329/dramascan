'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Star } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { submitRatingAction } from '@/workflows/reviews/actions';

/**
 * The rating control on a details page.
 *
 * The action is a Server Action, so the viewer is resolved from the session on
 * the server: the control cannot rate on somebody else's behalf, and the
 * reviews module re-checks that the item is publicly available and that the
 * score is a whole number between one and five before the row is written.
 *
 * An anonymous viewer is offered a sign-in link instead of a control that
 * cannot work.
 */
export type RatingWidgetProps = {
  /** The kind of content being rated. */
  type: 'drama' | 'movie';
  /** The id of the content item. */
  contentId: string;
  /** The viewer's own active rating, or `null` when they have not rated. */
  initialRating: number | null;
  /** The public average, or `null` when nobody has rated the item. */
  average: number | null;
  /** How many active ratings the average is based on. */
  count: number;
  /** Whether the viewer is signed in. */
  signedIn: boolean;
};

/** Format a count compactly: `1.2K`, `3.4M`. */
export function formatCompactCount(value: number): string {
  if (value < 1000) {
    return String(value);
  }

  if (value < 1_000_000) {
    const thousands = value / 1000;

    return `${thousands >= 10 ? Math.round(thousands) : Number(thousands.toFixed(1))}K`;
  }

  const millions = value / 1_000_000;

  return `${millions >= 10 ? Math.round(millions) : Number(millions.toFixed(1))}M`;
}

export function RatingWidget({
  type,
  contentId,
  initialRating,
  average,
  count,
  signedIn,
}: Readonly<RatingWidgetProps>): React.JSX.Element {
  const [rating, setRating] = useState<number | null>(initialRating);
  const [currentAverage, setCurrentAverage] = useState<number | null>(average);
  const [currentCount, setCurrentCount] = useState(count);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!signedIn) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {average === null
            ? 'No ratings yet.'
            : `Rated ${average.toFixed(1)} out of 5 by ${formatCompactCount(count)} viewers.`}
        </p>

        <Link
          href="/auth/signin"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-2')}
        >
          <Star className="size-4" aria-hidden="true" />
          Sign in to rate
        </Link>
      </div>
    );
  }

  function rate(value: number) {
    setError(null);

    startTransition(async () => {
      const result = await submitRatingAction({ type, contentId, value });

      if (result.ok) {
        setRating(value);
        setCurrentAverage(result.data.rating);
        setCurrentCount(result.data.count);

        return;
      }

      setError(result.error.message);
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {currentAverage === null ?
          'No ratings yet.'
         : (
          <>
            Rated{' '}
            <span className="font-medium text-foreground">
              {currentAverage.toFixed(1)}
            </span>{' '}
            out of 5 by{' '}
            <span className="font-medium text-foreground">
              {formatCompactCount(currentCount)}
            </span>{' '}
            viewers
          </>
        )}
      </p>

      <div
        role="radiogroup"
        aria-label="Your rating"
        className="flex items-center gap-1"
      >
        {[1, 2, 3, 4, 5].map(value => {
          const filled = rating !== null && value <= rating;

          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={rating === value}
              aria-label={`${value} star${value === 1 ? '' : 's'}`}
              disabled={isPending}
              onClick={() => rate(value)}
              className="rounded p-1 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <Star
                className={cn(
                  'size-6 transition-colors',
                  filled ? 'fill-primary text-primary' : 'text-muted-foreground'
                )}
                aria-hidden="true"
              />
            </button>
          );
        })}

        {rating !== null ? (
          <span className="ml-2 text-xs text-muted-foreground">
            Your rating: {rating}/5
          </span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
