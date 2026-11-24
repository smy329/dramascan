'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Smile } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toggleReviewReactionAction } from '@/workflows/reviews/actions';

/**
 * The "Enjoying" reaction on one review.
 *
 * The reaction is a Server Action, so the viewer is resolved from the session
 * on the server. The reviews module toggles the row: reacting twice removes
 * the reaction again, and the unique index makes a concurrent double-tap
 * idempotent rather than an error.
 */
export type ReviewReactionButtonProps = {
  /** The review being reacted to. */
  reviewId: string;
  /** How many viewers currently enjoy the review. */
  initialCount: number;
  /** Whether the signed-in viewer already reacted. */
  initialReacted: boolean;
  /** Whether the viewer is signed in. */
  signedIn: boolean;
};

export function ReviewReactionButton({
  reviewId,
  initialCount,
  initialReacted,
  signedIn,
}: Readonly<ReviewReactionButtonProps>): React.JSX.Element {
  const [count, setCount] = useState(initialCount);
  const [reacted, setReacted] = useState(initialReacted);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!signedIn) {
    return (
      <Link
        href="/auth/signin"
        className={cn(buttonVariants({ variant: 'ghost', size: 'xs' }), 'gap-1.5 text-muted-foreground')}
      >
        <Smile className="size-4" aria-hidden="true" />
        Enjoying {count}
      </Link>
    );
  }

  function toggle() {
    setError(null);

    startTransition(async () => {
      const result = await toggleReviewReactionAction({ reviewId });

      if (result.ok) {
        setReacted(result.data.enjoying);
        setCount(result.data.count);

        return;
      }

      setError(result.error.message);
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={isPending}
        aria-pressed={reacted}
        className={cn(
          buttonVariants({ variant: reacted ? 'secondary' : 'ghost', size: 'xs' }),
          'gap-1.5',
          reacted ? 'text-primary' : 'text-muted-foreground'
        )}
      >
        <Smile className="size-4" aria-hidden="true" />
        Enjoying {count}
      </button>

      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
