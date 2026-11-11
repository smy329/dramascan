import Link from 'next/link';
import { Clapperboard } from 'lucide-react';

import { EmptyState, PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { buttonVariants } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export default function DramasPage() {
  return (
    <PublicPageLayout title="Dramas">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Browse"
          title="Drama series"
          description="Series from Korea, Japan, China, Thailand, and beyond. Browse what is available now, or see which shows are complete."
        />

        <Tabs defaultValue="trending" className="w-full">
          <TabsList>
            <TabsTrigger value="trending">Trending now</TabsTrigger>
            <TabsTrigger value="complete">Complete series</TabsTrigger>
          </TabsList>

          <TabsContent value="trending" className="pt-6">
            <EmptyState
              icon={Clapperboard}
              title="No series published yet"
              description="The catalogue is still being prepared. Trending series will appear here as soon as they are added."
            >
              <Link
                href="/categories"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                Browse categories
              </Link>
            </EmptyState>
          </TabsContent>

          <TabsContent value="complete" className="pt-6">
            <EmptyState
              icon={Clapperboard}
              title="No complete series yet"
              description="A series is listed here once every episode of every season is available."
            />
          </TabsContent>
        </Tabs>
      </div>
    </PublicPageLayout>
  );
}
