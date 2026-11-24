import type { JSX } from 'react';
import { MonitorPlay } from 'lucide-react';

import { PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { RankedDiscoveryView } from '@/components/public/ranked-discovery-view';
import {
  readContentTypeParam,
  readPageParam,
  readSortParam,
  readStringParam,
  type PublicSearchParams,
} from '@/lib/discovery-params';
import { listRankedContent } from '@/modules/analytics';
import { listPublicPlatforms } from '@/modules/content';

/**
 * The platform browse page.
 *
 * The structure is the same as the category browse: filters, a grid of cards,
 * and a pager.
 */

export const dynamic = 'force-dynamic';

type PlatformsPageProps = {
  searchParams: Promise<PublicSearchParams>;
};

export default async function PlatformsPage({
  searchParams,
}: PlatformsPageProps): Promise<JSX.Element> {
  const params = await searchParams;
  const type = readContentTypeParam(params);
  const sort = readSortParam(params);
  const page = readPageParam(params);
  const selectedSlug = readStringParam(params, 'platform');

  const [platforms, result] = await Promise.all([
    listPublicPlatforms(),
    listRankedContent({
      type,
      sort,
      page,
      pageSize: 24,
      platformSlug: selectedSlug || undefined,
    }),
  ]);

  return (
    <PublicPageLayout title="Platforms">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Browse"
          title="Platforms"
          description="Find the dramas and films that are available on the platform you use."
        />

        <RankedDiscoveryView
          basePath="/platforms"
          params={params}
          result={result}
          showContentType
          showSort
          extraGroups={[
            {
              label: 'Platform',
              param: 'platform',
              options: platforms.map(platform => ({
                value: platform.slug,
                label: `${platform.name} (${platform.contentCount})`,
              })),
              value: selectedSlug,
            },
          ]}
          emptyIcon={MonitorPlay}
          emptyTitle="Nothing in this selection"
          emptyDescription="No published drama or film matches the platform you picked. Try another platform, or clear the selection."
          emptyHref="/platforms"
          emptyHrefLabel="Show every platform"
        />
      </div>
    </PublicPageLayout>
  );
}
