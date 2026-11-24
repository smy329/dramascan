import type { JSX } from 'react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * The filter bar of a discovery page.
 *
 * The filters are links: every combination is a real URL, so a filtered list
 * can be shared, bookmarked, and rendered on the server. A client component
 * would add JavaScript without adding a capability the page needs.
 */

/** One filter group: a label and the choices it offers. */
export type DiscoveryFilterGroup = {
  /** The label of the group. */
  label: string;
  /** The name of the query parameter the group writes. */
  param: string;
  /** The available choices. */
  options: ReadonlyArray<{ value: string; label: string }>;
  /** The value that is currently selected. */
  value: string;
  /** Build the href for one choice. */
  hrefFor: (_value: string) => string;
};

export type DiscoveryFiltersProps = Readonly<{
  groups: readonly DiscoveryFilterGroup[];
}>;

/** The filter bar. */
export function DiscoveryFilters({ groups }: DiscoveryFiltersProps): JSX.Element | null {
  const visible = groups.filter(group => group.options.length > 0);

  if (visible.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {visible.map(group => (
        <div key={group.param} className="flex flex-wrap items-center gap-2">
          <span className="w-24 shrink-0 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {group.label}
          </span>

          <ul className="flex flex-wrap gap-2">
            {group.options.map(option => {
              const selected = option.value === group.value;

              return (
                <li key={option.value}>
                  <Link
                    href={group.hrefFor(option.value)}
                    aria-current={selected ? 'page' : undefined}
                    className={cn(
                      'inline-flex items-center rounded-full border px-3 py-1 text-sm transition-colors',
                      selected
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                    )}
                  >
                    {option.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Build a discovery URL from the current query parameters.
 *
 * The page resets the pager whenever a filter changes: a filter that keeps
 * the old page number would land the viewer on an empty page. A URL that
 * explicitly sets `page` keeps it, because that is the pager.
 */
export function buildDiscoveryHref(
  basePath: string,
  params: Readonly<Record<string, string | string[] | undefined>>,
  changes: Readonly<Record<string, string | undefined>>
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }

    const first = Array.isArray(value) ? value[0] : value;

    if (first === undefined || first === '') {
      continue;
    }

    search.set(key, first);
  }

  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === '') {
      search.delete(key);
    } else {
      search.set(key, value);
    }
  }

  if (!('page' in changes)) {
    search.delete('page');
  }

  const query = search.toString();

  return query.length > 0 ? `${basePath}?${query}` : basePath;
}
