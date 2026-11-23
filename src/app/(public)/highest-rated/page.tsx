import Link from 'next/link';
import { Star } from 'lucide-react';

import { EmptyState, PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getRatingSummary } from '@/modules/reviews';

export default function HighestRatedPage() {
  return (
    <PublicPageLayout title="Highest Rated">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Discover"
          title="Highest Rated"
          description="The most genuinely well-rated dramas and movies in the catalogue. Ratings are based on a 5-point scale from real viewer feedback."
        />

        <EmptyState
          icon={Star}
          title="No ratings yet"
          description="Once viewers start rating titles, this page will show the highest-rated dramas and movies."
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