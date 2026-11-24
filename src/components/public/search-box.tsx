'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { normalizeSafeUrl } from '@/components/public/content-card';

/**
 * The search box with live autocomplete.
 *
 * The box is a client island; the results page is a server page. The box
 * offers three things the requirements ask for:
 *
 *   - live autocomplete with poster thumbnails,
 *   - the viewer's recent searches, kept in the browser,
 *   - popular suggestions, chosen by the server.
 *
 * Recent searches never leave the browser: they are a convenience for the
 * viewer, not a record the platform keeps.
 */

/** One live suggestion. */
export type SearchSuggestionItem = {
  type: 'drama' | 'movie' | 'category' | 'platform';
  id: string;
  title: string;
  poster: string | null;
  href: string;
};

/** The key the recent searches are stored under. */
const RECENT_SEARCHES_KEY = 'dramascan.recent-searches';

/** How many recent searches are kept. */
const MAX_RECENT_SEARCHES = 6;

/** How long the client waits before asking for suggestions. */
const SUGGESTION_DEBOUNCE_MS = 250;

export type SearchBoxProps = Readonly<{
  /** The term the results page was rendered for. */
  initialQuery: string;
  /** The suggestions the server offers when the box is empty. */
  popularSuggestions: readonly SearchSuggestionItem[];
}>;

export function SearchBox({
  initialQuery,
  popularSuggestions,
}: SearchBoxProps): React.JSX.Element {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<SearchSuggestionItem[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // The recent searches are read once, after the component mounts: reading
  // `localStorage` during render would break server rendering.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(RECENT_SEARCHES_KEY);

      if (!stored) {
        return;
      }

      const parsed: unknown = JSON.parse(stored);

      if (Array.isArray(parsed)) {
        setRecent(
          parsed.filter((entry): entry is string => typeof entry === 'string').slice(0, MAX_RECENT_SEARCHES)
        );
      }
    } catch {
      // A browser with storage disabled still gets a working search box.
    }
  }, []);

  // The live suggestions are requested after the viewer stops typing.
  useEffect(() => {
    const term = value.trim();

    if (term.length < 2) {
      setSuggestions([]);

      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search/suggestions?q=${encodeURIComponent(term)}`, {
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          data?: { suggestions?: SearchSuggestionItem[] };
        };

        if (!cancelled) {
          setSuggestions(payload.data?.suggestions ?? []);
        }
      } catch {
        // A failed suggestion request must not break the search box.
      }
    }, SUGGESTION_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value]);

  // Clicking outside the box closes the suggestion panel.
  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);

    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const rememberSearch = useCallback((term: string) => {
    const trimmed = term.trim();

    if (trimmed.length === 0) {
      return;
    }

    setRecent(current => {
      const next = [trimmed, ...current.filter(entry => entry !== trimmed)].slice(
        0,
        MAX_RECENT_SEARCHES
      );

      try {
        window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      } catch {
        // Storage is optional; the search still works without it.
      }

      return next;
    });
  }, []);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const term = value.trim();

    rememberSearch(term);
    setOpen(false);

    router.push(term.length > 0 ? `/search?q=${encodeURIComponent(term)}` : '/search');
  }

  const showPanel = open && (suggestions.length > 0 || recent.length > 0 || popularSuggestions.length > 0);

  return (
    <div ref={containerRef} className="relative">
      <form onSubmit={submit} role="search" className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />

          <input
            type="search"
            name="q"
            value={value}
            onChange={event => {
              setValue(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search dramas, movies, categories, platforms"
            aria-label="Search"
            autoComplete="off"
            className="h-11 w-full rounded-lg border border-border bg-background pl-9 pr-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
          />

          {value.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setValue('');
                setSuggestions([]);
              }}
              aria-label="Clear the search"
              className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <button type="submit" className={cn(buttonVariants({ variant: 'default' }), 'h-11')}>
          Search
        </button>
      </form>

      {showPanel ? (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          {suggestions.length > 0 ? (
            <div className="border-b border-border/60 p-2">
              <p className="px-2 py-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Suggestions
              </p>

              <ul>
                {suggestions.map(suggestion => (
                  <li key={`${suggestion.type}-${suggestion.id}`}>
                    <a
                      href={suggestion.href}
                      onClick={() => {
                        rememberSearch(value);
                        setOpen(false);
                      }}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
                    >
                      {suggestion.poster ? (
                        <img
                          src={normalizeSafeUrl(suggestion.poster) ?? ''}
                          alt=""
                          aria-hidden="true"
                          className="h-12 w-8 shrink-0 rounded border border-border object-cover"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex h-12 w-8 shrink-0 items-center justify-center rounded border border-dashed border-border bg-background/60 text-[9px] uppercase text-muted-foreground"
                        >
                          {suggestion.type.slice(0, 4)}
                        </span>
                      )}

                      <span className="min-w-0 flex-1 truncate">{suggestion.title}</span>

                      <span className="shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                        {suggestion.type}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {recent.length > 0 ? (
            <div className="border-b border-border/60 p-2">
              <p className="px-2 py-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Recent searches
              </p>

              <ul>
                {recent.map(term => (
                  <li key={term}>
                    <button
                      type="button"
                      onClick={() => {
                        setValue(term);
                        rememberSearch(term);
                        setOpen(false);
                        router.push(`/search?q=${encodeURIComponent(term)}`);
                      }}
                      className="block w-full rounded-lg px-2 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
                    >
                      {term}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {popularSuggestions.length > 0 ? (
            <div className="p-2">
              <p className="px-2 py-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Popular searches
              </p>

              <ul>
                {popularSuggestions.map(suggestion => (
                  <li key={`popular-${suggestion.type}-${suggestion.id}`}>
                    <a
                      href={suggestion.href}
                      onClick={() => {
                        rememberSearch(suggestion.title);
                        setOpen(false);
                      }}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
                    >
                      {suggestion.poster ? (
                        <img
                          src={normalizeSafeUrl(suggestion.poster) ?? ''}
                          alt=""
                          aria-hidden="true"
                          className="h-12 w-8 shrink-0 rounded border border-border object-cover"
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="flex h-12 w-8 shrink-0 items-center justify-center rounded border border-dashed border-border bg-background/60 text-[9px] uppercase text-muted-foreground"
                        >
                          {suggestion.type.slice(0, 4)}
                        </span>
                      )}

                      <span className="min-w-0 flex-1 truncate">{suggestion.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
