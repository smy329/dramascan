import type { JSX } from 'react';
import { Film } from 'lucide-react';

import { PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { RankedDiscoveryView } from '@/components/public/ranked-discovery-view';
import {
  readPageParam,
  readSortParam,
  type PublicSearchParams,
} from '@/lib/discovery-params';
import { listRankedContent } from '@/modules/analytics';

/**
 * The public film catalogue.
 *
 * The page used to be a hardcoded pair of empty tabs: it said "No films
 * published yet" no matter what the catalogue held, and the "Recent releases"
 * and "Classic films" tabs were placeholders with no query behind them. It is
 * now a server-rendered discovery grid over the shared ranked read model, the
 * same surface as the drama catalogue.
 *
 * A movie has no lifecycle status — a film is a finished work — so the page
 * offers the content filters a film catalogue can honestly answer: the sort
 * order and the pager.
 */

export const dynamic = 'force-dynamic';

type MoviesPageProps = {
  searchParams: Promise<PublicSearchParams>;
};

export default async function MoviesPage({
  searchParams,
}: MoviesPageProps): Promise<JSX.Element> {
  const params = await searchParams;
  const sort = readSortParam(params);
  const page = readPageParam(params);

  const result = await listRankedContent({
    type: 'movie',
    sort,
    page,
    pageSize: 24,
  });

  return (
    <PublicPageLayout title="Movies">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Browse"
          title="Feature films"
          description="A curated selection of international film — festival favourites, independent cinema, and widely loved releases."
        />

        <RankedDiscoveryView
          basePath="/movie"
          params={params}
          result={result}
          showContentType={false}
          showStatus={false}
          showSort
          defaultSort={sort}
          emptyIcon={Film}
          emptyTitle="No films published yet"
          emptyDescription="The film catalogue is still being prepared. Films appear here as soon as their sources are verified for browser playback."
          emptyHref="/platforms"
          emptyHrefLabel="Where to watch"
        />
      </div>
    </PublicPageLayout>
  );
}
