'use client';

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Film, Plus, Search, Sparkles } from 'lucide-react';

import { AdminTablePagination } from '@/components/admin/data-table/data-table-pagination';
import { AdminTableToolbar } from '@/components/admin/data-table/data-table-toolbar';
import { EmptyState } from '@/components/states/empty-state';
import { RetryState } from '@/components/states/retry-state';
import { RetryButton } from '@/components/states/retry-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { buildTableHref, type TableQueryState } from '@/lib/contracts/table';
import type { SimilarDramaSuggestion, SimilarDramaSummary } from '@/lib/contracts/similar-dramas';

export type SimilarDramaManagerProps = Readonly<{
  drama: { id: string; title: string };
  initialItems: SimilarDramaSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  state: TableQueryState;
}>;

function errorMessage(body: unknown): string {
  if (body && typeof body === 'object') {
    const candidate = body as {
      error?: { message?: unknown };
      message?: unknown;
    };

    if (typeof candidate.error?.message === 'string') return candidate.error.message;
    if (typeof candidate.message === 'string') return candidate.message;
  }

  return 'The request failed.';
}

async function readFailure(response: Response): Promise<string> {
  try {
    return errorMessage(await response.json());
  } catch {
    return 'The request failed.';
  }
}

/**
 * Administrator surface for one drama's recommendations.
 *
 * The server page owns authorization and the initial read; this island owns
 * only the interactions: filter links, search for a target, add, remove, and
 * reorder. Every mutation refreshes the server data instead of mutating the
 * cached list in place.
 */
export function SimilarDramaManager({
  drama,
  initialItems,
  page,
  pageSize,
  total,
  totalPages,
  state,
}: SimilarDramaManagerProps): JSX.Element {
  const router = useRouter();
  const pathname = `/admin/dramas/${drama.id}/similar-dramas`;

  const [items, setItems] = useState(initialItems);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<(() => void) | null>(null);

  const [term, setTerm] = useState('');
  const [candidates, setCandidates] = useState<SimilarDramaSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<SimilarDramaSuggestion[] | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  function clearFailure(): void {
    setError(null);
    setRetry(null);
  }

  function fail(message: string, action?: () => void): void {
    setError(message);
    setRetry(action ? () => action : null);
  }

  async function searchCandidates(searchTerm: string): Promise<void> {
    const value = searchTerm.trim();

    if (value.length === 0) {
      setCandidates(null);
      setSearchError(null);
      return;
    }

    setSearching(true);
    setSearchError(null);

    try {
      const response = await fetch(
        `/admin/api/similar-dramas/candidates?dramaId=${encodeURIComponent(drama.id)}&search=${encodeURIComponent(value)}`,
        { headers: { Accept: 'application/json' } }
      );

      if (!response.ok) {
        throw new Error(await readFailure(response));
      }

      const body = (await response.json()) as { data?: SimilarDramaSummary[] };
      setCandidates(body.data ?? []);
    } catch (cause) {
      setSearchError(cause instanceof Error ? cause.message : 'Search failed.');
      setCandidates(null);
    } finally {
      setSearching(false);
    }
  }

  async function loadSuggestions(): Promise<void> {
    setLoadingSuggestions(true);
    setSuggestionError(null);

    try {
      const response = await fetch(
        `/admin/api/similar-dramas/suggestions?dramaId=${encodeURIComponent(drama.id)}`,
        { headers: { Accept: 'application/json' } }
      );

      if (!response.ok) {
        throw new Error(await readFailure(response));
      }

      const body = (await response.json()) as { data?: SimilarDramaSuggestion[] };
      setSuggestions(body.data ?? []);
    } catch (cause) {
      setSuggestionError(
        cause instanceof Error ? cause.message : 'Failed to load suggested dramas.'
      );
      setSuggestions(null);
    } finally {
      setLoadingSuggestions(false);
    }
  }

  async function addSuggestion(suggestion: SimilarDramaSuggestion): Promise<void> {
    setPending(`add:${suggestion.id}`);
    clearFailure();

    try {
      const response = await fetch('/admin/api/similar-dramas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dramaId: drama.id, similarDramaId: suggestion.id }),
      });

      if (!response.ok) {
        throw new Error(await readFailure(response));
      }

      setSuggestions(current => current?.filter(item => item.id !== suggestion.id) ?? null);
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to add the drama.';
      fail(message, () => void addSuggestion(suggestion));
    } finally {
      setPending(null);
    }
  }

  async function add(target: SimilarDramaSummary): Promise<void> {
    setPending(`add:${target.id}`);
    clearFailure();

    try {
      const response = await fetch('/admin/api/similar-dramas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dramaId: drama.id, similarDramaId: target.id }),
      });

      if (!response.ok) {
        throw new Error(await readFailure(response));
      }

      setCandidates(current => current?.filter(item => item.id !== target.id) ?? null);
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to add the drama.';
      fail(message, () => void add(target));
    } finally {
      setPending(null);
    }
  }

  async function remove(target: SimilarDramaSummary): Promise<void> {
    setPending(`remove:${target.id}`);
    clearFailure();

    try {
      const response = await fetch('/admin/api/similar-dramas', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dramaId: drama.id, similarDramaId: target.id }),
      });

      if (!response.ok) {
        throw new Error(await readFailure(response));
      }

      setItems(current => current.filter(item => item.id !== target.id));
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to remove the drama.';
      fail(message, () => void remove(target));
    } finally {
      setPending(null);
    }
  }

  async function move(target: SimilarDramaSummary, direction: -1 | 1): Promise<void> {
    const index = items.findIndex(item => item.id === target.id);
    const neighbour = items[index + direction];

    if (index < 0 || !neighbour) return;

    const ordered = [...items];
    ordered[index] = neighbour;
    ordered[index + direction] = target;

    setPending(`move:${target.id}`);
    clearFailure();
    setItems(ordered);

    try {
      const response = await fetch('/admin/api/similar-dramas/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dramaId: drama.id, orderedIds: ordered.map(item => item.id) }),
      });

      if (!response.ok) {
        throw new Error(await readFailure(response));
      }

      router.refresh();
    } catch (cause) {
      setItems(items);
      const message = cause instanceof Error ? cause.message : 'Failed to save the new order.';
      fail(message, () => void move(target, direction));
    } finally {
      setPending(null);
    }
  }

  function retryFailure(): void {
    retry?.();
  }

  function renderCandidate(candidate: SimilarDramaSummary): JSX.Element {
    return (
      <li
        key={candidate.id}
        className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0"
      >
        <span className="truncate text-sm text-foreground">{candidate.title}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void add(candidate)}
          disabled={pending !== null}
          aria-busy={pending === `add:${candidate.id}` ? true : undefined}
        >
          <Plus aria-hidden="true" />
          Add
        </Button>
      </li>
    );
  }

  function renderSearchResults(): JSX.Element | null {
    if (searching) {
      return (
        <p role="status" className="text-sm text-muted-foreground">
          Searching…
        </p>
      );
    }

    if (searchError) {
      return (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-destructive">{searchError}</p>
          <RetryButton onRetry={() => void searchCandidates(term)} />
        </div>
      );
    }

    if (candidates === null) return null;

    if (candidates.length === 0) {
      return <p className="text-sm text-muted-foreground">No matching dramas to add.</p>;
    }

    return <ul aria-label="Dramas available to add">{candidates.map(renderCandidate)}</ul>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Similar dramas for {drama.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose which dramas are recommended alongside this one and in what order.
        </p>
      </div>

      <section aria-labelledby="add-similar-drama-heading" className="space-y-3">
        <h2 id="add-similar-drama-heading" className="text-sm font-medium text-foreground">
          Add a similar drama
        </h2>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={event => {
            event.preventDefault();
            void searchCandidates(term);
          }}
        >
          <div className="min-w-56 flex-1">
            <label htmlFor="similar-drama-search" className="sr-only">
              Search dramas by title
            </label>
            <Input
              id="similar-drama-search"
              value={term}
              onChange={event => setTerm(event.target.value)}
              placeholder="Search dramas by title"
            />
          </div>
          <Button type="submit" variant="outline" disabled={searching}>
            <Search aria-hidden="true" />
            Search
          </Button>
        </form>
        {renderSearchResults()}
      </section>

      <section aria-labelledby="suggested-similar-dramas-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="suggested-similar-dramas-heading" className="text-sm font-medium text-foreground">
            Suggested dramas
          </h2>
          <Button
            type="button"
            variant="outline"
            onClick={() => void loadSuggestions()}
            disabled={loadingSuggestions}
            aria-busy={loadingSuggestions ? true : undefined}
          >
            <Sparkles aria-hidden="true" />
            {loadingSuggestions ? 'Loading…' : 'Show suggestions'}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Suggestions are scored from shared categories, platforms, status, and structure. Adding one is
          always your decision.
        </p>

        {suggestionError ? (
          <div className="space-y-2" role="alert">
            <p className="text-sm text-destructive">{suggestionError}</p>
            <RetryButton onRetry={() => void loadSuggestions()} />
          </div>
        ) : null}

        {suggestions !== null && suggestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No related dramas were found. Add recommendations manually using the search above.
          </p>
        ) : null}

        {suggestions !== null && suggestions.length > 0 ? (
          <ul aria-label="Suggested dramas" className="rounded-xl border border-border">
            {suggestions.map(suggestion => (
              <li
                key={suggestion.id}
                className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{suggestion.title}</p>
                  <p className="text-xs text-muted-foreground">
                    Score {suggestion.score} · {suggestion.sharedCategories} shared categories ·{' '}
                    {suggestion.sharedPlatforms} shared platforms
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void addSuggestion(suggestion)}
                  disabled={pending !== null}
                  aria-busy={pending === `add:${suggestion.id}` ? true : undefined}
                >
                  <Plus aria-hidden="true" />
                  Add
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {error ? (
        <RetryState title="The action could not be completed" description={error} headingLevel={2}>
          <div className="flex justify-center gap-2">
            <RetryButton onRetry={retryFailure} />
            <Button type="button" variant="ghost" onClick={clearFailure}>
              Dismiss
            </Button>
          </div>
        </RetryState>
      ) : null}

      <AdminTableToolbar
        pathname={pathname}
        state={state}
        searchLabel="Filter recommendations"
        searchPlaceholder="Filter by title"
        clearHref={buildTableHref(pathname, state, { page: 1, search: '' })}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Film}
          title={state.search.length > 0 ? 'No matching recommendations' : 'No similar dramas yet'}
          description={
            state.search.length > 0
              ? 'No recommendation matches this filter. Clear it to see every recommendation.'
              : 'Use the search above to add the first recommendation.'
          }
          headingLevel={2}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="hidden md:table-cell">Poster</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="text-right">Position</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={item.id}>
                  <TableCell className="hidden md:table-cell">
                    {item.poster ? (
                      <img
                        src={item.poster}
                        alt=""
                        width={32}
                        height={48}
                        className="h-12 w-8 rounded object-cover"
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-medium text-foreground">{item.title}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {index + 1}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void move(item, -1)}
                        disabled={index === 0 || pending !== null}
                        aria-label={`Move ${item.title} up`}
                      >
                        Move up
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void move(item, 1)}
                        disabled={index === items.length - 1 || pending !== null}
                        aria-label={`Move ${item.title} down`}
                      >
                        Move down
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => void remove(item)}
                        disabled={pending !== null}
                        aria-busy={pending === `remove:${item.id}` ? true : undefined}
                      >
                        Remove
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AdminTablePagination
        pathname={pathname}
        state={state}
        total={total}
        totalPages={totalPages}
        itemLabel="similar dramas"
      />

      <p className="text-xs text-muted-foreground">
        Page {page} of {Math.max(totalPages, 1)} · {pageSize} per page
      </p>
    </div>
  );
}
