import type { JSX } from 'react';
import Link from 'next/link';

import { DiscoveryFilters, buildDiscoveryHref } from '@/components/public/discovery-filters';
import { DiscoveryGrid, DiscoveryPagination } from '@/components/public/discovery-grid';
import { EmptyState } from '@/components/public/Layout';
import type { RankedContentPage } from '@/modules/analytics';
import type { LucideIcon } from 'lucide-react';

/**
 * The shared body of a ranked discovery page.
 *
 * Trending, Popular, Recently Added, Highest Rated, Categories, Platforms, and
 * Search all show the same thing: a filter bar, a grid of cards, and a pager.
 * The page supplies the result and the filters it wants; this component
 * renders them.
 */

/** The content-type choices every discovery page offers. */
export const CONTENT_TYPE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'drama', label: 'Dramas' },
  { value: 'movie', label: 'Movies' },
] as const;

/** The lifecycle-status choices. */
export const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
] as const;

/** The sort choices. */
export const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'trending', label: 'Trending' },
  { value: 'popular', label: 'Popular' },
  { value: 'highest-rated', label: 'Highest rated' },
  { value: 'most-viewed', label: 'Most viewed' },
] as const;

/**
 * The sort choices of a search page.
 *
 * A search is ordered by relevance unless the viewer asks for something else:
 * the title they typed has to be the first result, not the newest of the
 * titles that merely resemble it.
 */
export const SEARCH_SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  ...SORT_OPTIONS,
] as const;

export type RankedDiscoveryViewProps = Readonly<{
  /** The path of the page, used to build the filter and pager URLs. */
  basePath: string;
  /** The current query parameters. */
  params: Readonly<Record<string, string | string[] | undefined>>;
  /** The result the page read. */
  result: RankedContentPage;
  /** The extra filter groups the page offers. */
  extraGroups?: ReadonlyArray<{
    label: string;
    param: string;
    options: ReadonlyArray<{ value: string; label: string }>;
    value: string;
    /** Overrides the default URL builder, for a multi-select group. */
    hrefFor?: (_value: string) => string;
  }>;
  /** Whether the page offers the content-type filter. */
  showContentType?: boolean;
  /** Whether the page offers the status filter. */
  showStatus?: boolean;
  /** Whether the page offers the sort filter. */
  showSort?: boolean;
  /** The sort choices the page offers. */
  sortOptions?: ReadonlyArray<{ value: string; label: string }>;
  /** The sort order in force when the URL does not name one. */
  defaultSort?: string;
  /** The icon of the empty state. */
  emptyIcon: LucideIcon;
  /** The heading of the empty state. */
  emptyTitle: string;
  /** The explanation of the empty state. */
  emptyDescription: string;
  /** The link of the empty state. */
  emptyHref: string;
  /** The label of the empty-state link. */
  emptyHrefLabel: string;
}>;

export function RankedDiscoveryView({
  basePath,
  params,
  result,
  extraGroups = [],
  showContentType = true,
  showStatus = false,
  showSort = false,
  sortOptions = SORT_OPTIONS,
  defaultSort = 'newest',
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyHref,
  emptyHrefLabel,
}: RankedDiscoveryViewProps): JSX.Element {
  const readParam = (name: string): string => {
    const value = params[name];
    const first = Array.isArray(value) ? value[0] : value;

    return first ?? '';
  };

  const groups = [
    ...showContentType
      ? [
          {
            label: 'Type',
            param: 'type',
            options: CONTENT_TYPE_OPTIONS.map(option => ({ ...option })),
            value: readParam('type') || 'all',
            hrefFor: (value: string) => buildDiscoveryHref(basePath, params, { type: value }),
          },
        ]
      : [],
    ...showStatus
      ? [
          {
            label: 'Status',
            param: 'status',
            options: STATUS_OPTIONS.map(option => ({ ...option })),
            value: readParam('status') || 'all',
            hrefFor: (value: string) => buildDiscoveryHref(basePath, params, { status: value }),
          },
        ]
      : [],
    ...showSort
      ? [
          {
            label: 'Sort',
            param: 'sort',
            options: sortOptions.map(option => ({ ...option })),
            value: readParam('sort') || defaultSort,
            hrefFor: (value: string) => buildDiscoveryHref(basePath, params, { sort: value }),
          },
        ]
      : [],
    ...extraGroups.map(group => ({
      label: group.label,
      param: group.param,
      options: group.options,
      value: group.value,
      hrefFor:
        group.hrefFor ??
        ((value: string) => buildDiscoveryHref(basePath, params, { [group.param]: value })),
    })),
  ];

  if (result.items.length === 0) {
    return (
      <div className="space-y-8">
        <DiscoveryFilters groups={groups} />

        <EmptyState
          icon={emptyIcon}
          title={emptyTitle}
          description={emptyDescription}
        >
          <Link
            href={emptyHref}
            className="inline-flex items-center rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40"
          >
            {emptyHrefLabel}
          </Link>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <DiscoveryFilters groups={groups} />

      <DiscoveryGrid
        items={result.items.map(item => ({
          kind: item.type,
          title: item.title,
          poster: item.poster,
          href: item.href,
          rating:
            item.ratingAverage !== null && item.ratingCount > 0
              ? { average: item.ratingAverage, count: item.ratingCount }
              : null,
          status: item.status,
          comingSoon: item.comingSoon,
        }))}
      />

      <DiscoveryPagination
        page={result.page}
        totalPages={result.totalPages}
        hasNextPage={result.hasNextPage}
        hasPreviousPage={result.hasPreviousPage}
        previousHref={
          result.hasPreviousPage
            ? buildDiscoveryHref(basePath, params, { page: String(result.page - 1) })
            : null
        }
        nextHref={
          result.hasNextPage
            ? buildDiscoveryHref(basePath, params, { page: String(result.page + 1) })
            : null
        }
      />
    </div>
  );
}
