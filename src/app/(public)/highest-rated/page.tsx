import type { JSX } from 'react';
import { Star } from 'lucide-react';

import { PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { RankedDiscoveryView } from '@/components/public/ranked-discovery-view';
import {
  readContentTypeParam,
  readPageParam,
  type PublicSearchParams,
} from '@/lib/discovery-params';
import { listHighestRatedContent } from '@/modules/analytics';

/**
 * The Highest Rated page.
 *
 * The average is computed from the active ratings only. An item nobody rated
 * has no average and is not listed, and no minimum rating count is imposed:
 * one honest rating is a real rating. There is no Lowest Rated page.
 */

export const dynamic = 'force-dynamic';

type HighestRatedPageProps = {
  searchParams: Promise<PublicSearchParams>;
};

export default async function HighestRatedPage({
  searchParams,
}: HighestRatedPageProps): Promise<JSX.Element> {
  const params = await searchParams;
  const type = readContentTypeParam(params);
  const page = readPageParam(params);

  const result = await listHighestRatedContent({ type, page, pageSize: 24 });

  return (
    <PublicPageLayout title="Highest rated">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Discover"
          title="Highest rated"
          description="The most genuinely well-rated dramas and movies in the catalogue. Ratings are based on a 5-point scale from real viewer feedback."
        />

        <RankedDiscoveryView
          basePath="/highest-rated"
          params={params}
          result={result}
          emptyIcon={Star}
          emptyTitle="No ratings yet"
          emptyDescription="Once viewers start rating titles, this page will show the highest-rated dramas and movies."
          emptyHref="/categories"
          emptyHrefLabel="Browse the categories"
        />
      </div>
    </PublicPageLayout>
  );
}
