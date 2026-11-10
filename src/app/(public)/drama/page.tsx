import { PublicPageLayout } from '@/components/public/Layout';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { Tab } from '@/components/ui/tab';

export default function DramasPage() {
  return (
    <PublicPageLayout title="Dramas" description="Watch international drama series">
      <div className="space-y-12">
        <h1 className="text-4xl font-bold text-white dark:text-gray-900">
          Drama Series Collection
        </h1>

        <p className="text-lg text-gray-400 dark:text-gray-500 max-w-2xl">
          Discover thousands of drama series from around the world. From
          critically acclaimed masterpieces to popular favorites, find your next
          binge-worthy series.
        </p>

        <Tabs defaultValue="trending" className="w-full">
          <Tab value="trending">
            <Card className="p-6 bg-gray-900/50 dark:bg-gray-900/50 backdrop-blur">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Trending Now</h3>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground/60">
                Currently trending across all categories
              </p>
            </Card>
          </Tab>
          <Tab value="complete">
            <Card className="p-6 bg-gray-900/50 dark:bg-gray-900/50 backdrop-blur">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Complete Series</h3>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground/60">
                Full seasons available
              </p>
            </Card>
          </Tab>
        </Tabs>
      </div>
    </PublicPageLayout>
  );
}