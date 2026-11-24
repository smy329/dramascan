'use client';

import { useState, useTransition } from 'react';
import { Check, Star } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  clearFeaturedContentAction,
  updateFeaturedContentAction,
} from '@/workflows/admin/homepage-settings';

/**
 * The administrator's choice of the homepage hero.
 *
 * The candidate list comes from the server and contains only items the public
 * can already open, so the picker cannot offer an unpublished title. The
 * write goes through a Server Action that re-checks the item and the
 * permission.
 */

/** One candidate item. */
export type FeaturedCandidate = {
  type: 'drama' | 'movie';
  id: string;
  title: string;
  poster: string | null;
};

export type FeaturedContentPickerProps = Readonly<{
  /** The items the administrator may choose from. */
  candidates: readonly FeaturedCandidate[];
  /** The current selection, or `null` when the automatic fallback is used. */
  selected: { type: 'drama' | 'movie'; id: string } | null;
}>;

export function FeaturedContentPicker({
  candidates,
  selected,
}: FeaturedContentPickerProps): React.JSX.Element {
  const [current, setCurrent] = useState(selected);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function choose(candidate: FeaturedCandidate) {
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const result = await updateFeaturedContentAction({
        type: candidate.type,
        id: candidate.id,
      });

      if (result.ok) {
        setCurrent({ type: result.data.type, id: result.data.id });
        setMessage(`${candidate.title} is now the featured item.`);

        return;
      }

      setError(result.error.message);
    });
  }

  function clear() {
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const result = await clearFeaturedContentAction();

      if (result.ok) {
        setCurrent(null);
        setMessage('The featured item was cleared. The homepage uses its automatic fallback.');

        return;
      }

      setError(result.error.message);
    });
  }

  return (
    <div className="space-y-4">
      {candidates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
          No published content is available to feature yet.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {candidates.map(candidate => {
            const isSelected =
              current !== null &&
              current.id === candidate.id &&
              current.type === candidate.type;

            return (
              <li
                key={`${candidate.type}-${candidate.id}`}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 transition-colors',
                  isSelected ? 'border-primary bg-primary/5' : 'border-border bg-card/40'
                )}
              >
                {candidate.poster ? (
                  <img
                    src={candidate.poster}
                    alt=""
                    aria-hidden="true"
                    className="h-16 w-11 shrink-0 rounded border border-border object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-16 w-11 shrink-0 items-center justify-center rounded border border-dashed border-border text-[9px] uppercase text-muted-foreground"
                  >
                    No poster
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {candidate.title}
                  </span>
                  <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                    {candidate.type}
                  </span>
                </span>

                <button
                  type="button"
                  disabled={isPending || isSelected}
                  onClick={() => choose(candidate)}
                  className={cn(buttonVariants({ variant: isSelected ? 'secondary' : 'outline', size: 'xs' }), 'gap-1')}
                >
                  {isSelected ? (
                    <>
                      <Check className="size-4" aria-hidden="true" />
                      Featured
                    </>
                  ) : (
                    <>
                      <Star className="size-4" aria-hidden="true" />
                      Feature
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={clear}
          disabled={isPending || current === null}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
        >
          Clear the featured item
        </button>

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
      </div>
    </div>
  );
}
