'use client';

import { useState, useTransition } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { updateHeroRotationAction } from '@/workflows/admin/homepage-settings';

import { heroRotationMessage } from './homepage-messages';

/**
 * The hero rotation settings.
 *
 * The rotation is a small client island: the server decides which items are
 * eligible and hands them over, and the client only records the choice. When
 * the rotation is off, the homepage keeps the selected hero stable.
 */

/** One candidate item. */
export type RotationCandidate = {
  type: 'drama' | 'movie';
  id: string;
  title: string;
};

export type HeroRotationEditorProps = Readonly<{
  /** Whether the rotation is currently on. */
  enabled: boolean;
  /** The items the rotation currently moves through. */
  items: ReadonlyArray<{ type: 'drama' | 'movie'; id: string }>;
  /** The items the administrator may choose from. */
  candidates: readonly RotationCandidate[];
}>;

/** The key of one item. */
function keyOf(item: { type: string; id: string }): string {
  return `${item.type}:${item.id}`;
}

export function HeroRotationEditor({
  enabled,
  items,
  candidates,
}: HeroRotationEditorProps): React.JSX.Element {
  const [rotationEnabled, setRotationEnabled] = useState(enabled);
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
      const result = await updateHeroRotationAction({ enabled: rotationEnabled, items: chosen });

      if (result.ok) {
        setMessage(heroRotationMessage(result.data.enabled, result.data.itemCount));

        return;
      }

      setError(result.error.message);
    });
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={rotationEnabled}
          onChange={event => setRotationEnabled(event.target.checked)}
          disabled={isPending}
          className="size-4 rounded border-border"
        />
        Rotate the homepage hero
      </label>

      {candidates.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-8 text-center text-sm text-muted-foreground">
          No published content is available to rotate through yet.
        </p>
      ) : (
        <fieldset disabled={isPending} className="space-y-2">
          <legend className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Rotation items
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
          {isPending ? 'Saving...' : 'Save rotation settings'}
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
