import type { JSX } from 'react';
import { Flame } from 'lucide-react';

import { PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { RankedDiscoveryView } from '@/components/public/ranked-discovery-view';
import {
  readContentTypeParam,
  readPageParam,
  type PublicSearchParams,
} from '@/lib/discovery-params';
import { listTrendingContent } from '@/modules/analytics';
import { getTrendingPinsSetting } from '@/modules/administration';

/**
 * The Trending page.
 *
 * The page uses the same ranking service as the homepage Trending section, so
 * the two can never disagree. The ranking is computed from stored daily
 * aggregates, so refreshing the page cannot inflate it.
 */

export const dynamic = 'force-dynamic';

type TrendingPageProps = {
  searchParams: Promise<PublicSearchParams>;
};

export default async function TrendingPage({
  searchParams,
}: TrendingPageProps): Promise<JSX.Element> {
  const params = await searchParams;
  const type = readContentTypeParam(params);
  const page = readPageParam(params);

  const pins = await getTrendingPinsSetting();

  const result = await listTrendingContent({
    type,
    page,
    pageSize: 24,
    pinnedIds: pins.map(pin => pin.id),
  });

  return (
    <PublicPageLayout title="Trending">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Discover"
          title="Trending"
          description="What people are watching right now. The ranking weighs unique viewers, watch time, and how recent the activity is, so a refresh never changes the order."
        />

        <RankedDiscoveryView
          basePath="/trending"
          params={params}
          result={result}
          emptyIcon={Flame}
          emptyTitle="Nothing is trending yet"
          emptyDescription="Once the catalogue is live, this page will show the titles with the most watch activity over the past two weeks."
          emptyHref="/categories"
          emptyHrefLabel="Browse the categories"
        />
      </div>
    </PublicPageLayout>
  );
}
