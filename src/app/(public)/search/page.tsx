import type { JSX } from 'react';
import { Search } from 'lucide-react';

import { ContentRail } from '@/components/public/content-rail';
import { EmptyState, PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { RankedDiscoveryView, SEARCH_SORT_OPTIONS } from '@/components/public/ranked-discovery-view';
import { SearchBox } from '@/components/public/search-box';
import {
  readContentTypeParam,
  readPageParam,
  readSortParam,
  readStatusParam,
  readStringParam,
  type PublicSearchParams,
} from '@/lib/discovery-params';
import { listRankedContent, listPopularContent } from '@/modules/analytics';
import { listSearchTaxonomyMatches } from '@/modules/content';

/**
 * The search results page.
 *
 * The page searches content titles, categories, and platforms. The titles are
 * matched with PostgreSQL full-text search, trigram matching, and a plain
 * pattern; the categories and platforms are matched by name and their content
 * is shown as a section of its own.
 *
 * The page is a server component: the query runs on the server, so an
 * unpublished item can never appear in the results.
 */

export const dynamic = 'force-dynamic';

type SearchPageProps = {
  searchParams: Promise<PublicSearchParams>;
};

export default async function SearchPage({ searchParams }: SearchPageProps): Promise<JSX.Element> {
  const params = await searchParams;
  const query = readStringParam(params, 'q');
  const type = readContentTypeParam(params);
  const status = readStatusParam(params);
  // A search with a term is ordered by relevance: the title the viewer typed
  // has to be the first result, not the newest of the titles that merely
  // resemble it.
  const sort = readSortParam(params, query.length > 0 ? 'relevance' : 'newest');
  const page = readPageParam(params);

  const [result, taxonomyMatches, popular] = await Promise.all([
    listRankedContent({
      type,
      sort,
      status,
      page,
      pageSize: 24,
      query: query || undefined,
    }),
    query.length >= 2 ? listSearchTaxonomyMatches(query, { limit: 4 }) : Promise.resolve([]),
    listPopularContent({ pageSize: 6 }),
  ]);

  return (
    <PublicPageLayout title="Search">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Discover"
          title="Search"
          description="Search the catalogue by title, category, or platform."
        />

        <SearchBox
          initialQuery={query}
          popularSuggestions={popular.items.map(item => ({
            type: item.type,
            id: item.id,
            title: item.title,
            poster: item.poster,
            href: item.href,
          }))}
        />

        {query.length === 0 ? (
          <>
            <EmptyState
              icon={Search}
              title="Start typing"
              description="Type a title, a category, or a platform to find what you are looking for."
            />

            <ContentRail
              title="Popular right now"
              href="/popular"
              items={popular.items.map(item => ({
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
          </>
        ) : (
          <>
            <RankedDiscoveryView
              basePath="/search"
              params={params}
              result={result}
              showContentType
              showStatus
              showSort
              sortOptions={SEARCH_SORT_OPTIONS}
              defaultSort={sort}
              emptyIcon={Search}
              emptyTitle={`Nothing matched "${query}"`}
              emptyDescription="Try a shorter term, another spelling, or a different filter."
              emptyHref="/categories"
              emptyHrefLabel="Browse the categories"
            />

            {taxonomyMatches.map(match => (
              <ContentRail
                key={`${match.kind}-${match.id}`}
                title={`${match.name} (${match.kind})`}
                href={match.href}
                items={match.items.map(item => ({
                  kind: item.type,
                  title: item.title,
                  poster: item.poster,
                  href: item.href,
                  rating: null,
                  status: item.status,
                  comingSoon: item.comingSoon,
                }))}
              />
            ))}
          </>
        )}
      </div>
    </PublicPageLayout>
  );
}
