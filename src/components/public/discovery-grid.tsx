import type { JSX } from 'react';
import Link from 'next/link';

import { ContentCard } from '@/components/public/ContentCard';
import type { ContentKind, ContentLifecycleStatus, ContentRating } from '@/components/public/content-card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The shared discovery grid and its pagination.
 *
 * The discovery pages — Trending, Popular, Recently Added, Highest Rated,
 * Categories, Platforms, and Search — all show the same thing: a grid of
 * content cards and a pager. They differ only in the query they run and the
 * filters they offer, so the presentation lives here and the pages stay
 * thin.
 */

/** One card of the grid. */
export type DiscoveryGridItem = {
  kind: ContentKind;
  title: string;
  poster?: string | null;
  href: string;
  rating?: ContentRating | null;
  status?: ContentLifecycleStatus | null;
  /** Whether the item is listed before it can be played. */
  comingSoon?: boolean;
};

export type DiscoveryGridProps = Readonly<{
  items: readonly DiscoveryGridItem[];
}>;

/** The discovery grid. */
export function DiscoveryGrid({ items }: DiscoveryGridProps): JSX.Element {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {items.map(item => (
        <li key={`${item.kind}-${item.href}`}>
          <ContentCard
            kind={item.kind}
            title={item.title}
            poster={item.poster ?? null}
            rating={item.rating ?? null}
            status={item.status ?? null}
            comingSoon={item.comingSoon}
            href={item.href}
          />
        </li>
      ))}
    </ul>
  );
}

export type DiscoveryPaginationProps = Readonly<{
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  /** The URL of the previous page, when there is one. */
  previousHref?: string | null;
  /** The URL of the next page, when there is one. */
  nextHref?: string | null;
}>;

/**
 * The pager.
 *
 * The pager is a set of links rather than a client component: the page it
 * links to is a server-rendered page, and a link works without JavaScript.
 */
export function DiscoveryPagination({
  page,
  totalPages,
  hasNextPage,
  hasPreviousPage,
  previousHref,
  nextHref,
}: DiscoveryPaginationProps): JSX.Element | null {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4">
      {hasPreviousPage && previousHref ? (
        <Link
          href={previousHref}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          rel="prev"
        >
          Previous
        </Link>
      ) : (
        <span />
      )}

      <p className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </p>

      {hasNextPage && nextHref ? (
        <Link
          href={nextHref}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          rel="next"
        >
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
