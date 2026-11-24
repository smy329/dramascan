'use client';

import { useState, useTransition } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { updateTrendingPinsAction } from '@/workflows/admin/homepage-settings';

import { trendingPinsMessage } from './homepage-messages';

/**
 * The administrator's Trending pins.
 *
 * A pinned item is placed at the head of the Trending ranking. The pins never
 * change the underlying activity score: they only decide which eligible item
 * is shown first.
 */

/** One candidate item. */
export type TrendingPinCandidate = {
  type: 'drama' | 'movie';
  id: string;
  title: string;
};

export type TrendingPinsEditorProps = Readonly<{
  /** The items that are currently pinned. */
  items: ReadonlyArray<{ type: 'drama' | 'movie'; id: string }>;
  /** The items the administrator may choose from. */
  candidates: readonly TrendingPinCandidate[];
}>;

/** The key of one item. */
function keyOf(item: { type: string; id: string }): string {
  return `${item.type}:${item.id}`;
}

export function TrendingPinsEditor({
  items,
  candidates,
}: TrendingPinsEditorProps): React.JSX.Element {
  const [selected, setSelected] = useState<string[]>(items.map(keyOf));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(key: string) {
    setSelected(current =>
      (current.includes(key) ? current.filter(item => item !== key) : [...current, key])
    );
  }

  function save() {
    setError(null);
    setMessage(null);

    const chosen = selected
      .map(key => {
        const separator = key.indexOf(':');
        const type = key.slice(0, separator);
        const id = key.slice(separator + 1);

        return { type, id };
      })
      .filter(
        (item): item is { type: 'drama' | 'movie'; id: string } =>
          (item.type === 'drama' || item.type === 'movie') && item.id.length > 0
      );

    startTransition(async () => {
      const result = await updateTrendingPinsAction({ items: chosen });

      if (result.ok) {
        setMessage(trendingPinsMessage(result.data.itemCount));

        return;
      }

      setError(result.error.message);
    });
  }

  return (
    <div className="space-y-4">
      {candidates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
          No published content is available to pin yet.
        </p>
      ) : (
        <fieldset disabled={isPending} className="space-y-2">
          <legend className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Pinned items
          </legend>

          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {candidates.map(candidate => {
              const key = keyOf(candidate);
              const checked = selected.includes(key);

              return (
                <li key={key}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm transition-colors',
                      checked
                        ? 'border-primary bg-primary/5 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(key)}
                      className="size-4 rounded border-border"
                    />
                    <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      {candidate.type}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}
        >
          {isPending ? 'Saving...' : 'Save pins'}
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
