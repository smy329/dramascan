import { PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { db } from '@/db/client';
import { movies, platforms, movie_platforms } from '@/modules/content/schema';
import { eq, sql, desc, inArray } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export default async function PlatformsPage() {
  const platforms = await db
    .select({
      id: platforms.id,
      name: platforms.name,
      slug: platforms.slug,
    })
    .from(platforms)
    .where(sql`${platforms.deleted_at} IS NULL`)
    .orderBy(asc(platforms.position), asc(platforms.name));

  // Get movies for each platform
  const platformMoviesMap = new Map<string, Array<{ id: string; title: string; poster: string }>>();

  for (const platform of platforms) {
    const platformAssociations = await db
      .select({
        movieId: movie_platforms.movie_id,
      })
      .from(movie_platforms)
      .where(eq(movie_platforms.platform_id, platform.id));

    const movieIds = platformAssociations.map(a => a.movieId).filter((id): id is string => id !== null);

    const moviesInPlatform = await db
      .select({
        id: movies.id,
        title: movies.title,
        poster: movies.poster,
      })
      .from(movies)
      .where(
        and(
          eq(movies.isActive, true),
          sql`${movies.publication_status} = 'published'`,
          inArray(movies.id, movieIds as string[])
        )
      )
      .orderBy(desc(movies.position), desc(movies.created_at))
      .limit(8);

    if (moviesInPlatform.length > 0) {
      platformMoviesMap.set(platform.id, moviesInPlatform);
    }
  }

  return (
    <PublicPageLayout title="Platforms">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Discover"
          title="Platforms"
          description="DramaScan does not host video itself. Where a title is available elsewhere, its page will link you to the platform that carries it."
        />

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {platforms.map((platform) => {
            const movies = platformMoviesMap.get(platform.id) || [];
            return (
              <li key={platform.id} className="rounded-xl border border-border bg-card p-5">
                <p className="text-sm font-medium text-foreground">{platform.name}</p>
                {movies.length > 0 ? (
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {movies} movies
                  </p>
                ) : (
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    No movies
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Platform availability depends on your region and changes without notice. Nothing on this
          page guarantees that a title can be streamed in your country.
        </p>
      </div>
    </PublicPageLayout>
  );
}
