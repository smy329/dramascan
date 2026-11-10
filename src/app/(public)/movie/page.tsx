import { PublicPageLayout } from '@/components/public/Layout';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { Tab } from '@/components/ui/tab';

export default function MoviesPage() {
  return (
    <PublicPageLayout title="Movies" description="Watch international feature films">
      <div className="space-y-12">
        <h1 className="text-4xl font-bold text-white dark:text-gray-900">
          Feature Film Collection
        </h1>

        <p className="text-lg text-gray-400 dark:text-gray-500 max-w-2xl">
          Explore a curated selection of international feature films, including
          award-winning dramas, independent cinema, and popular releases.
        </p>

        <Tabs defaultValue="recent" className="w-full">
          <Tab value="recent">
            <Card className="p-6 bg-gray-900/50 dark:bg-gray-900/50 backdrop-blur">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Recent Releases</h3>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground/60">
                New films added weekly
              </p>
            </Card>
          </Tab>
          <Tab value="classic">
            <Card className="p-6 bg-gray-900/50 dark:bg-gray-900/50 backdrop-blur">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Classic Films</h3>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground/60">
                Timeless cinema
              </p>
            </Card>
          </Tab>
        </Tabs>
      </div>
    </PublicPageLayout>
  );
}