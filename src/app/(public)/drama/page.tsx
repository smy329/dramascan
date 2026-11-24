import type { JSX } from 'react';
import { Clapperboard } from 'lucide-react';

import { PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { RankedDiscoveryView } from '@/components/public/ranked-discovery-view';
import {
  readPageParam,
  readSortParam,
  readStatusParam,
  type PublicSearchParams,
} from '@/lib/discovery-params';
import { listRankedContent } from '@/modules/analytics';

/**
 * The public drama catalogue.
 *
 * The page is a server-rendered discovery grid, the same surface as Trending,
 * Popular, Recently Added, and Highest Rated. It reads the shared ranked
 * read model, so the public availability rule is decided in one place: a
 * draft, a trashed drama, and a drama that is hidden until it has a playable
 * episode never reach the page.
 *
 * The status filter is what the old tab pair pretended to offer. "Complete
 * series" used to report the number of *all* dramas; it now filters the
 * catalogue to the dramas whose lifecycle status is `completed`, and the
 * count is the count of those dramas.
 */

export const dynamic = 'force-dynamic';

type DramasPageProps = {
  searchParams: Promise<PublicSearchParams>;
};

export default async function DramasPage({
  searchParams,
}: DramasPageProps): Promise<JSX.Element> {
  const params = await searchParams;
  const status = readStatusParam(params);
  const sort = readSortParam(params);
  const page = readPageParam(params);

  const result = await listRankedContent({
    type: 'drama',
    status,
    sort,
    page,
    pageSize: 24,
  });

  return (
    <PublicPageLayout title="Dramas">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Browse"
          title="Drama series"
          description="Series from Korea, Japan, China, Thailand, and beyond. Browse what is available now, or see which shows are complete."
        />

        <RankedDiscoveryView
          basePath="/drama"
          params={params}
          result={result}
          showContentType={false}
          showStatus
          showSort
          defaultSort={sort}
          emptyIcon={Clapperboard}
          emptyTitle="No series published yet"
          emptyDescription="The catalogue is still being prepared. Series will appear here as soon as they are added."
          emptyHref="/categories"
          emptyHrefLabel="Browse the categories"
        />
      </div>
    </PublicPageLayout>
  );
}
