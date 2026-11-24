import type { JSX } from 'react';
import { Sparkles } from 'lucide-react';

import { PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { RankedDiscoveryView } from '@/components/public/ranked-discovery-view';
import {
  readContentTypeParam,
  readPageParam,
  type PublicSearchParams,
} from '@/lib/discovery-params';
import { listRankedContent } from '@/modules/analytics';

/**
 * The Recently Added page.
 *
 * The order is the real publication time: `published_at` is stamped the first
 * time an item is published and is never overwritten, so it cannot be edited
 * into a fake date. Drafts, unpublished items, and trashed items never
 * appear here.
 */

export const dynamic = 'force-dynamic';

type RecentlyAddedPageProps = {
  searchParams: Promise<PublicSearchParams>;
};

export default async function RecentlyAddedPage({
  searchParams,
}: RecentlyAddedPageProps): Promise<JSX.Element> {
  const params = await searchParams;
  const type = readContentTypeParam(params);
  const page = readPageParam(params);

  const result = await listRankedContent({
    type,
    sort: 'newest',
    page,
    pageSize: 24,
  });

  return (
    <PublicPageLayout title="Recently added">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Discover"
          title="Recently added"
          description="The newest published dramas and films, ordered by the moment they were actually published."
        />

        <RankedDiscoveryView
          basePath="/recently-added"
          params={params}
          result={result}
          emptyIcon={Sparkles}
          emptyTitle="Nothing has been published yet"
          emptyDescription="As soon as a drama or a film is published, it appears here in the order it was released."
          emptyHref="/categories"
          emptyHrefLabel="Browse the categories"
        />
      </div>
    </PublicPageLayout>
  );
}
