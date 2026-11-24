import type { JSX } from 'react';
import { Trophy } from 'lucide-react';

import { PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { RankedDiscoveryView } from '@/components/public/ranked-discovery-view';
import {
  readContentTypeParam,
  readPageParam,
  type PublicSearchParams,
} from '@/lib/discovery-params';
import { listPopularContent } from '@/modules/analytics';

/**
 * The Popular page.
 *
 * Popular is not Trending under another name: it sums the whole history
 * without decay, so an old favourite keeps its place long after it has left
 * the Trending list.
 */

export const dynamic = 'force-dynamic';

type PopularPageProps = {
  searchParams: Promise<PublicSearchParams>;
};

export default async function PopularPage({
  searchParams,
}: PopularPageProps): Promise<JSX.Element> {
  const params = await searchParams;
  const type = readContentTypeParam(params);
  const page = readPageParam(params);

  const result = await listPopularContent({ type, page, pageSize: 24 });

  return (
    <PublicPageLayout title="Popular">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Discover"
          title="Popular"
          description="The all-time favourites of the catalogue. The ranking sums the whole history of unique viewers, views, and watch time without any recency decay."
        />

        <RankedDiscoveryView
          basePath="/popular"
          params={params}
          result={result}
          emptyIcon={Trophy}
          emptyTitle="Nothing is popular yet"
          emptyDescription="Once the catalogue has been watched, this page will show the titles with the strongest long-term audience."
          emptyHref="/categories"
          emptyHrefLabel="Browse the categories"
        />
      </div>
    </PublicPageLayout>
  );
}
