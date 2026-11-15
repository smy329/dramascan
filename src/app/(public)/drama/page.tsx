import Link from 'next/link';
import { Clapperboard } from 'lucide-react';

import { EmptyState, PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { buttonVariants } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export default async function DramasPage() {
  const response = await fetch('/api/public/dramas', {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return (
      <PublicPageLayout title="Dramas">
        <div className="space-y-10">
          <PageHeader
            eyebrow="Browse"
            title="Drama series"
            description="Error loading dramas. Please try again."
          />
          <p className="text-sm text-muted-foreground">Failed to load drama series.</p>
        </div>
      </PublicPageLayout>
    );
  }

  const { data: dramas } = (await response.json()) as {
    data: Array<{
      id: string;
      title: string;
      slug: string;
      description: string | null;
      poster: string | null;
      banner: string | null;
      publication_status: string;
      visibility: string;
      created_at: string;
      updated_at: string;
    }>;
  };

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
            {dramas.length === 0 ? (
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
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {dramas.map((drama) => (
                  <div key={drama.id} className="group rounded-xl overflow-hidden">
                    <Link
                      href={`/drama/${drama.slug}`}
                      className={cn(
                        'w-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                        'group'
                      )}
                    >
                      <div className="relative">
                        <img
                          src={drama.poster ?? '/placeholder-drama.svg'}
                          alt={drama.title}
                          className="w-full h-48 object-cover"
                        />
                        {drama.visibility === 'coming_soon' && (
                          <span
                            className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/85 px-2 py-1 text-[11px] font-medium text-foreground backdrop-blur"
                          >
                            <span
                              aria-hidden="true"
                              className="size-1.5 rounded-full bg-primary/20 text-primary"
                            />
                            Coming Soon
                          </span>
                        )}
                        {drama.visibility === 'hidden' && (
                          <span
                            className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/85 px-2 py-1 text-[11px] font-medium text-foreground backdrop-blur"
                          >
                            <span
                              aria-hidden="true"
                              className="size-1.5 rounded-full bg-muted-foreground/20 text-muted-foreground"
                            />
                            Hidden
                          </span>
                        )}
                      </div>
                      <div className="p-4 flex flex-col gap-2">
                        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                          {drama.title}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          {drama.publication_status === 'published' ? 'Available now' : 'Not yet published'}
                        </p>
                        {drama.publication_status === 'published' && drama.visibility !== 'hidden' && (
                          <a
                            href="#"
                            className="text-primary hover:text-primary/90 text-xs"
                          >
                            Watch trailer
                          </a>
                        )}
                      </div>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="complete" className="pt-6">
            {dramas.length === 0 ? (
              <EmptyState
                icon={Clapperboard}
                title="No complete series yet"
                description="A series is listed here once every episode of every season is available."
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {dramas.length} drama{dramas.length > 1 ? 's' : ''} listed
              </p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PublicPageLayout>
  );
}