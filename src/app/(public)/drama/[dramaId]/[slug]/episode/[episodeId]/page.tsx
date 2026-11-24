import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { resolveActor } from '@/modules/authorization';
import {
  getPublicDramaDetail,
  getPublicEpisodePlayback,
  nextPublicEpisode,
  previousPublicEpisode,
  publicEpisodeHref,
  resolvePublicContentSlug,
} from '@/modules/content';
import { listPublicSubtitleTracks } from '@/modules/playback';
import { getEpisodePlaybackState } from '@/modules/users';

import { EpisodeNavigation } from '@/components/public/episode-navigation';
import { PublicPageLayout } from '@/components/public/Layout';
import { WatchedToggle } from '@/components/public/watched-toggle';
import { PlaybackResetProvider } from '@/components/player/playback-reset';
import { VidstackPlayer } from '@/components/player/vidstack-player';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { serverConfig } from '@/platform/config';

/**
 * The watch page.
 *
 * The page renders the administrator-supplied, direct HTTPS MP4 URL in the
 * viewer's browser. The application server never fetches, proxies, relays, or
 * rehosts the media: it stores the URL and hands it to the browser, which
 * requests the file directly from the external host.
 *
 * Availability is decided by the content module. An episode that is not
 * publicly playable — a draft episode, an episode under an unpublished season,
 * a trashed episode — is a 404, not a page with a broken player. The slug in
 * the URL has to match the drama's stored slug, because the canonical URL
 * carries it.
 *
 * The navigation follows the published content order. The next episode is the
 * one that really follows this episode, and it is only ever a publicly
 * playable episode, so the automatic next-episode flow cannot enter content
 * the viewer may not see.
 */

export const dynamic = 'force-dynamic';

type EpisodePageProps = {
  params: Promise<{ dramaId: string; slug: string; episodeId: string }>;
  searchParams?: Promise<{ autoplay?: string | string[] }>;
};

export async function generateMetadata({ params }: EpisodePageProps): Promise<Metadata> {
  const { dramaId, episodeId } = await params;
  const episode = await getPublicEpisodePlayback(dramaId, episodeId);

  if (!episode) {
    return { title: 'Episode not found' };
  }

  return {
    title: `${episode.title} — ${episode.dramaTitle}`,
    description: episode.description ?? undefined,
  };
}

export default async function EpisodePage({ params, searchParams }: EpisodePageProps) {
  const { dramaId, slug, episodeId } = await params;

  const [drama, episode] = await Promise.all([
    getPublicDramaDetail(dramaId, slug),
    getPublicEpisodePlayback(dramaId, episodeId),
  ]);

  if (!episode) {
    notFound();
  }

  if (!drama || episode.dramaSlug !== slug) {
    // A slug the drama used before is redirected to the canonical URL; a
    // guessed slug is a 404.
    const canonicalSlug = await resolvePublicContentSlug('drama', dramaId, slug);

    if (canonicalSlug !== null) {
      redirect(publicEpisodeHref(dramaId, canonicalSlug, episodeId));
    }

    notFound();
  }

  // The automatic next-episode flow arrives with `autoplay=1`: the next
  // episode starts playing without another click.
  const resolvedSearchParams = await (searchParams ?? Promise.resolve<{ autoplay?: string | string[] }>({}));
  const autoplayParam = resolvedSearchParams.autoplay;
  const autoPlay = (Array.isArray(autoplayParam) ? autoplayParam[0] : autoplayParam) === '1';

  const subtitleTracks = await listPublicSubtitleTracks(episode.id);

  // Only a signed-in viewer has a progress record. The completion threshold
  // comes from the server configuration, so the player and the server apply
  // the same rule.
  const actor = await resolveActor();
  const playbackState = await getEpisodePlaybackState(actor.userId, episode.id);

  // A stored position at the very end of the episode is not a resume point:
  // the viewer already finished it. The same is true for an episode the
  // completion threshold has already marked as watched — it is complete, not
  // unfinished.
  const resumePositionSeconds =
    playbackState !== null &&
    !playbackState.watched &&
    playbackState.durationSeconds > 0 &&
    playbackState.positionSeconds > 0 &&
    playbackState.positionSeconds < playbackState.durationSeconds
      ? playbackState.positionSeconds
      : 0;

  const nextEpisode = nextPublicEpisode(drama.episodes, episode.id);
  const previousEpisode = previousPublicEpisode(drama.episodes, episode.id);
  const nextHref = nextEpisode
    ? publicEpisodeHref(drama.id, drama.slug, nextEpisode.id)
    : null;

  const episodeHeading = [
    episode.seasonTitle,
    episode.episodeNumber !== null ? `Episode ${episode.episodeNumber}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <PublicPageLayout title={episode.title}>
      {/* The provider gives the player and the watched toggle one shared
          "start over" signal: marking the episode unwatched has to move the
          media to the beginning as well as the stored position. */}
      <PlaybackResetProvider>
        <div className="space-y-6">
          <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
            <Link href="/drama" className="hover:text-foreground">
              Dramas
            </Link>
            <span aria-hidden="true" className="px-1.5">
              /
            </span>
            <Link
              href={`/drama/${episode.dramaId}/${episode.dramaSlug}`}
              className="hover:text-foreground"
            >
              {episode.dramaTitle}
            </Link>
          </nav>

          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{episode.title}</h1>
            <p className="text-sm text-muted-foreground">
              {episode.dramaTitle}
              {episodeHeading ? ` · ${episodeHeading}` : ''}
            </p>
          </div>

          <VidstackPlayer
            episodeId={episode.id}
            dramaId={episode.dramaId}
            title={episode.title}
            source={episode.videoSource}
            sourceVersion={episode.sourceVersion}
            subtitleTracks={subtitleTracks}
            signedIn={actor.userId !== null}
            completionThresholdPercent={serverConfig.playbackCompletionThresholdPercent}
            resumePositionSeconds={resumePositionSeconds}
            nextHref={nextHref}
            autoPlay={autoPlay}
          />

          <div className="flex flex-wrap items-center gap-3">
            {previousEpisode ? (
              <Link
                href={publicEpisodeHref(drama.id, drama.slug, previousEpisode.id)}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1')}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                Previous episode
              </Link>
            ) : null}

            {nextEpisode ? (
              <Link
                href={publicEpisodeHref(drama.id, drama.slug, nextEpisode.id)}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1')}
              >
                Next episode
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            ) : (
              <span className="rounded-lg border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                End of the published episodes
              </span>
            )}

            <WatchedToggle
              episodeId={episode.id}
              initialWatched={playbackState?.watched ?? false}
              signedIn={actor.userId !== null}
            />
          </div>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              {episode.description ? (
                <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
                  {episode.description}
                </p>
              ) : null}

              <p className="text-xs text-muted-foreground">
                This episode is streamed directly from its external host. DramaScan does not download,
                proxy, or rehost the video.
              </p>

              <Link
                href={`/drama/${episode.dramaId}/${episode.dramaSlug}`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                Back to {episode.dramaTitle}
              </Link>
            </div>

            <aside className="space-y-4 lg:border-l lg:border-border lg:pl-6">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">Episodes</h2>

              <EpisodeNavigation
                episodes={drama.episodes}
                currentEpisodeId={episode.id}
                structureType={drama.structureType}
              />
            </aside>
          </div>
        </div>
      </PlaybackResetProvider>
    </PublicPageLayout>
  );
}
