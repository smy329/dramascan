import 'server-only';

import { db } from '@/db/client';
import { eq } from 'drizzle-orm';

import { movies } from '@/modules/content/schema';

export default async function MovieDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // 1. Fetch the movie row from the database.
  const [movieRow] = await db
    .select()
    .from(movies)
    .where(eq(movies.id, id))
    .limit(1);

  if (!movieRow) {
    return <div className="min-h-screen bg-text p-8 text-muted-foreground">Movie not found.</div>;
  }

  return (
    <main className="max-w-7xl mx-auto py-8">
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {/* Left column: poster and essential info */}
        <div className="space-y-4">
          {/* Poster/Banner */}
          <div className="rounded-lg border border-border bg-background overflow-hidden">
            {movieRow.banner ? (
              <img
                src={movieRow.banner}
                alt={movieRow.title}
                className="h-48 w-full object-cover"
              />
            ) : null}
            {movieRow.poster ? (
              <img
                src={movieRow.poster}
                alt={movieRow.title}
                className="h-48 w-full object-contain"
              />
            ) : null}
          </div>

          <div className="text-lg">
            <h1 className="text-2xl font-bold">{movieRow.title}</h1>
            <p className="text-muted-foreground line-clamp-3">{movieRow.description || ''}</p>
          </div>

          {/* Status badge */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {movieRow.publication_status === 'published' && (
              <span className="inline-flex items-center gap-1">
                <span className="px-2 py-1 rounded bg-primary/10 text-primary">Available</span>
              </span>
            )}
          </div>
        </div>

        {/* Right column: metadata and actions */}
        <div className="space-y-4">
          {/* Publication status */}
          <div>
            <p className="text-sm font-medium text-muted-foreground">Status</p>
            <p className="mt-1">{movieRow.publication_status === 'published' ? 'Published' : 'Not published'}</p>
          </div>

          {/* View count (placeholder) */}
          <div>
            <p className="text-sm font-medium text-muted-foreground">View count</p>
            <p className="mt-1">—</p>
          </div>

          {/* Bookmark and Play/Continue actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Bookmark button */}
            <button className="flex-1 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted-focus">
              Bookmark
            </button>

            {/* Play / Continue button */}
            <button className="flex-1 rounded-md border border-border bg-primary text-primary px-4 py-2 text-sm font-medium transition-colors">
              Play
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
