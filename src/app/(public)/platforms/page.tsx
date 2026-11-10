import { PublicPageLayout } from '@/components/public/Layout';
import { Tabs } from '@/components/ui/tabs';
import { Tab } from '@/components/ui/tab';
import { Card } from '@/components/ui/card';

export default function PlatformsPage() {
  return (
    <PublicPageLayout title="Platforms">
      <div className="space-y-12">
        <h1 className="text-4xl font-bold text-white dark:text-gray-900">
          Streaming Platforms
        </h1>

        <p className="text-lg text-gray-400 dark:text-gray-500 max-w-2xl">
          DramaScan partners with leading streaming platforms to bring you the best
          international drama and movie content. Discover where your favorite stories
          are available.
        </p>

        <Tabs defaultValue="available" className="w-full">
          <Tab value="available">
            <Card className="p-6 bg-gray-900/50 dark:bg-gray-900/50 backdrop-blur">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Currently Available</h3>
              <ul className="grid grid-cols-2 gap-2 text-sm">
                <li className="hover:text-primary dark:hover:text-primary/60">Viki</li>
                <li className="hover:text-primary dark:hover:text-primary/60">Netflix</li>
                <li className="hover:text-primary dark:hover:text-primary/60">Amazon Prime</li>
                <li className="hover:text-primary dark:hover:text-primary/60">Disney+</li>
              </ul>
            </Card>
          </Tab>
          <Tab value="partners">
            <Card className="p-6 bg-gray-900/50 dark:bg-gray-900/50 backdrop-blur">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Partner Platforms</h3>
              <ul className="grid grid-cols-2 gap-2 text-sm">
                <li className="hover:text-primary dark:hover:text-primary/60">iQIYI</li>
                <li className="hover:text-primary dark:hover:text-primary/60">TVBAnywhere+</li>
                <li className="hover:text-primary dark:hover:text-primary/60">Kocowa</li>
                <li className="hover:text-primary dark:hover:text-primary/60">Seezn</li>
              </ul>
            </Card>
          </Tab>
        </Tabs>
      </div>
    </PublicPageLayout>
  );
}