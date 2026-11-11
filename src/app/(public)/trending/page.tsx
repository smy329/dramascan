import Link from 'next/link';
import { Flame } from 'lucide-react';

import { EmptyState, PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function TrendingPage() {
  return (
    <PublicPageLayout title="Trending">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Discover"
          title="Trending"
          description="What people are watching most this week. The list is based on real playback activity, so it stays empty until there is something to measure."
        />

        <EmptyState
          icon={Flame}
          title="Nothing is trending yet"
          description="Once the catalogue is live, this page will show the titles with the most watch activity over the past seven days."
        >
          <Link
            href="/drama"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            Browse drama series
          </Link>
        </EmptyState>
      </div>
    </PublicPageLayout>
  );
}
