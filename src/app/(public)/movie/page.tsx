import Link from 'next/link';
import { Film } from 'lucide-react';

import { EmptyState, PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { buttonVariants } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export default function MoviesPage() {
  return (
    <PublicPageLayout title="Movies">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Browse"
          title="Feature films"
          description="A curated selection of international film — festival favourites, independent cinema, and widely loved releases."
        />

        <Tabs defaultValue="recent" className="w-full">
          <TabsList>
            <TabsTrigger value="recent">Recent releases</TabsTrigger>
            <TabsTrigger value="classic">Classic films</TabsTrigger>
          </TabsList>

          <TabsContent value="recent" className="pt-6">
            <EmptyState
              icon={Film}
              title="No films published yet"
              description="The film catalogue is still being prepared. Recent releases will appear here first."
            >
              <Link
                href="/platforms"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                Where to watch
              </Link>
            </EmptyState>
          </TabsContent>

          <TabsContent value="classic" className="pt-6">
            <EmptyState
              icon={Film}
              title="No classic films yet"
              description="Older titles are added after their sources are verified for browser playback."
            />
          </TabsContent>
        </Tabs>
      </div>
    </PublicPageLayout>
  );
}
