import { PublicPageLayout } from '@/components/public/Layout';
import { Tabs } from '@/components/ui/tabs';
import { Tab } from '@/components/ui/tab';
import { Card } from '@/components/ui/card';

export default function CategoriesPage() {
  return (
    <PublicPageLayout title="Categories">
      <div className="space-y-12">
        <h1 className="text-4xl font-bold text-white dark:text-gray-900">
          Browse by Category
        </h1>

        <p className="text-lg text-gray-400 dark:text-gray-500 max-w-2xl">
          Find dramas and movies organized by genre, theme, and style. Browse our
          collection to discover content that matches your taste.
        </p>

        <Tabs defaultValue="drama-categories" className="w-full">
          <Tab value="drama-categories">
            <Card className="p-6 bg-gray-900/50 dark:bg-gray-900/50 backdrop-blur">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Drama Genres</h3>
              <ul className="grid grid-cols-2 gap-2 text-sm">
                <li className="hover:text-primary dark:hover:text-primary/60">Romance</li>
                <li className="hover:text-primary dark:hover:text-primary/60">Melodrama</li>
                <li className="hover:text-primary dark:hover:text-primary/60">Historical</li>
                <li className="hover:text-primary dark:hover:text-primary/60">Political</li>
              </ul>
            </Card>
          </Tab>
          <Tab value="movie-categories">
            <Card className="p-6 bg-gray-900/50 dark:bg-gray-900/50 backdrop-blur">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Movie Categories</h3>
              <ul className="grid grid-cols-2 gap-2 text-sm">
                <li className="hover:text-primary dark:hover:text-primary/60">Action</li>
                <li className="hover:text-primary dark:hover:text-primary/60">Thriller</li>
                <li className="hover:text-primary dark:hover:text-primary/60">Documentary</li>
                <li className="hover:text-primary dark:hover:text-primary/60">Independent</li>
              </ul>
            </Card>
          </Tab>
        </Tabs>
      </div>
    </PublicPageLayout>
  );
}