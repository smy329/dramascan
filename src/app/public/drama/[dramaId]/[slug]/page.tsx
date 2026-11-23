import 'server-only';

import { db } from '@/db/client';
import { eq, and } from 'drizzle-orm';

import { dramas } from '@/modules/content/schema';
import { evaluatePublicDramaDiscovery } from '@/modules/content/public-dramas.shared';
import { listPublicDramaEpisodes } from '@/modules/content/public-episodes';

export default async function DramaDetailPage({ params }: { params: Promise<{ dramaId: string; slug: string }> }) {
  const { dramaId, slug } = await params;

  // 1. Fetch the drama row from the database.
  const [dramaRow] = await db
    .select()
    .from(dramas)
    .where(and(eq(dramas.id, dramaId), eq(dramas.slug, slug)))
    .limit(1);

  if (!dramaRow) {
    return <div className="min-h-screen bg-text p-8 text-muted-foreground">Drama not found.</div>;
  }

  // 2. Compute the public discovery state.
  const discovery = evaluatePublicDramaDiscovery({
    publicationStatus: dramaRow.publication_status,
    deleted: dramaRow.deleted_at !== null,
    visibility: dramaRow.visibility,
    hasPlayableEpisode: false,
    emptyDramaVisibility: undefined,
  });

  // 3. Fetch publicly playable episodes for this drama.
  const playableEpisodes = await listPublicDramaEpisodes(dramaId);

  return (
    <main className="max-w-7xl mx-auto py-8">
      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {/* Left column: poster and essential info */}
        <div className="space-y-4">
          {/* Poster/Banner */}
          <div className="rounded-lg border border-border bg-background overflow-hidden">
            {dramaRow.banner ? (
              <img
                src={dramaRow.banner}
                alt={dramaRow.title}
                className="h-48 w-full object-cover"
              />
            ) : null}
            {dramaRow.poster ? (
              <img
                src={dramaRow.poster}
                alt={dramaRow.title}
                className="h-48 w-full object-contain"
              />
            ) : null}
          </div>

          <div className="text-lg">
            <h1 className="text-2xl font-bold">{dramaRow.title}</h1>
            <p className="text-muted-foreground line-clamp-3">{dramaRow.description || ''}</p>
          </div>

          {/* Status and coming-soon badge */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {discovery.reason === 'available' && (
              <span className="inline-flex items-center gap-1">
                <span className="px-2 py-1 rounded bg-primary/10 text-primary">Available</span>
              </span>
            )}
            {discovery.comingSoon && !discovery.reason.startsWith('hidden') && (
              <span className="inline-flex items-center gap-1">
                <span className="px-2 py-1 rounded bg-warning/10 text-warning">Coming Soon</span>
              </span>
            )}
            {discovery.reason === 'hidden_until_available' && (
              <span className="inline-flex items-center gap-1">
                <span className="px-2 py-1 rounded bg-destructive/10 text-destructive">Hidden Until Available</span>
              </span>
            )}
          </div>
        </div>

        {/* Right column: metadata and actions */}
        <div className="space-y-4">
          {/* Publication status */}
          <div>
            <p className="text-sm font-medium text-muted-foreground">Status</p>
            <p className="mt-1">{dramaRow.publication_status === 'published' ? dramaRow.status || '—' : 'Not published'}</p>
          </div>

          {/* Episode count */}
          <div>
            <p className="text-sm font-medium text-muted-foreground">Episodes</p>
            <p className="mt-1">{playableEpisodes.length} {playableEpisodes.length === 1 ? 'Episode' : 'Episodes'}</p>
          </div>

          {/* Seasons (for season-based dramas) */}
          {dramaRow.structure_type === 'season_based' && playableEpisodes.length > 0 && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">Seasons</p>
              <p className="mt-1">{playableEpisodes.length} episodes</p>
            </div>
          )}

          {/* Bookmark and Play/Continue actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Bookmark button */}
            <button className="flex-1 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted-focus">
              Bookmark
            </button>

            {/* Play / Continue button */}
            <button className="flex-1 rounded-md border border-border bg-primary text-primary px-4 py-2 text-sm font-medium transition-colors">
              Continue Watching
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
