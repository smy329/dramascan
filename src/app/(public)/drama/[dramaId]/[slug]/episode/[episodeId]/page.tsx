import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PublicPageLayout } from '@/components/public/Layout';
import { VidstackPlayer } from '@/components/player/vidstack-player';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { resolveActor } from '@/modules/authorization';
import { getPublicEpisodePlayback } from '@/modules/content';
import { listPublicSubtitleTracks } from '@/modules/playback';
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
 * a trashed episode — is a 404, not a page with a broken player.
 */

type EpisodePageProps = {
  params: Promise<{ dramaId: string; slug: string; episodeId: string }>;
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

export default async function EpisodePage({ params }: EpisodePageProps) {
  const { dramaId, episodeId } = await params;

  const episode = await getPublicEpisodePlayback(dramaId, episodeId);

  if (!episode) {
    notFound();
  }

  const subtitleTracks = await listPublicSubtitleTracks(episode.id);

  // Only a signed-in viewer has a progress record. The completion threshold
  // comes from the server configuration, so the player and the server apply
  // the same rule.
  const actor = await resolveActor();

  return (
    <PublicPageLayout title={episode.title}>
      <div className="space-y-6">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <Link href="/drama" className="hover:text-foreground">
            Dramas
          </Link>
          <span aria-hidden="true" className="px-1.5">
            /
          </span>
          <Link href={`/drama/${episode.dramaId}/${episode.dramaSlug}`} className="hover:text-foreground">
            {episode.dramaTitle}
          </Link>
        </nav>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{episode.title}</h1>
          <p className="text-sm text-muted-foreground">
            {episode.dramaTitle}
            {episode.episodeNumber !== null ? ` · Episode ${episode.episodeNumber}` : null}
          </p>
        </div>

        <VidstackPlayer
          episodeId={episode.id}
          title={episode.title}
          source={episode.videoSource}
          subtitleTracks={subtitleTracks}
          signedIn={actor.userId !== null}
          completionThresholdPercent={serverConfig.playbackCompletionThresholdPercent}
        />

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
    </PublicPageLayout>
  );
}
