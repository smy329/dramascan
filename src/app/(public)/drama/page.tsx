import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Clapperboard } from 'lucide-react';

import { EmptyState, PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { buttonVariants } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { listPublicDramas, PUBLIC_DRAMA_PAGE_SIZE_DEFAULT } from '@/modules/content';
import { ValidationError } from '@/platform/errors';

/**
 * Public drama catalogue.
 *
 * Reads the public query service directly. Visibility is decided in the content
 * module, not by a request parameter or a separate HTTP round trip, and the
 * page is dynamic because it reads `searchParams` and live catalogue data.
 */

type DramasPageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function DramasPage({ searchParams }: DramasPageProps) {
  const { page } = await searchParams;

  let result;

  try {
    result = await listPublicDramas({ page, pageSize: PUBLIC_DRAMA_PAGE_SIZE_DEFAULT });
  } catch (error) {
    // A malformed page number is a bad URL, not a server failure.
    if (error instanceof ValidationError) {
      notFound();
    }

    throw error;
  }

  // A page beyond the end would otherwise render a misleading empty catalogue.
  if (result.total > 0 && result.page > result.totalPages) {
    notFound();
  }

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
            {result.items.length === 0 ? (
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
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {result.items.map(drama => (
                    <div key={drama.id} className="group rounded-xl overflow-hidden">
                      <Link
                        href={drama.href}
                        className="w-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        <div className="relative">
                          <img
                            src={drama.poster ?? '/placeholder-drama.svg'}
                            alt={drama.title}
                            className="w-full h-48 object-cover"
                          />
                          {drama.comingSoon && (
                            <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/85 px-2 py-1 text-[11px] font-medium text-foreground backdrop-blur">
                              <span
                                aria-hidden="true"
                                className="size-1.5 rounded-full bg-primary/20 text-primary"
                              />
                              Coming Soon
                            </span>
                          )}
                        </div>
                        <div className="p-4 flex flex-col gap-2">
                          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                            {drama.title}
                          </h3>
                          {drama.description ? (
                            <p className="line-clamp-2 text-xs text-muted-foreground">
                              {drama.description}
                            </p>
                          ) : null}
                          <p className="text-xs text-muted-foreground">
                            {drama.comingSoon ? 'Coming soon' : 'Available now'}
                          </p>
                        </div>
                      </Link>
                    </div>
                  ))}
                </div>

                {result.totalPages > 1 && (
                  <nav
                    aria-label="Catalogue pages"
                    className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-6"
                  >
                    <p className="text-sm text-muted-foreground">
                      Page {result.page} of {result.totalPages}
                    </p>
                    <div className="flex items-center gap-2">
                      {result.hasPreviousPage ? (
                        <Link
                          href={`/drama?page=${result.page - 1}`}
                          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                          rel="prev"
                        >
                          Previous
                        </Link>
                      ) : null}
                      {result.hasNextPage ? (
                        <Link
                          href={`/drama?page=${result.page + 1}`}
                          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                          rel="next"
                        >
                          Next
                        </Link>
                      ) : null}
                    </div>
                  </nav>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="complete" className="pt-6">
            {result.total === 0 ? (
              <EmptyState
                icon={Clapperboard}
                title="No complete series yet"
                description="A series is listed here once every episode of every season is available."
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {result.total} drama{result.total > 1 ? 's' : ''} listed
              </p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PublicPageLayout>
  );
}
