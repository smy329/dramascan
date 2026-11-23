import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { resolveActor } from '@/modules/authorization';
import {
  getPublicMoviePlayback,
  publicMovieWatchHref,
  resolvePublicContentSlug,
} from '@/modules/content';
import { getMoviePlaybackState } from '@/modules/users';

import { PublicPageLayout } from '@/components/public/Layout';
import { VidstackPlayer } from '@/components/player/vidstack-player';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { serverConfig } from '@/platform/config';

/**
 * The public movie watch page.
 *
 * The movie is played by the browser directly from the administrator-supplied
 * HTTPS source; the application server never fetches, proxies, relays, or
 * rehosts it.
 *
 * A movie that is not published, is in the Trash, or has no playable source is
 * a 404. The slug in the URL has to match the stored slug as well: the
 * canonical URL carries the slug, and a stale or guessed slug must not serve a
 * different page.
 */

export const dynamic = 'force-dynamic';

type MovieWatchPageProps = {
  params: Promise<{ id: string; slug: string }>;
};

export async function generateMetadata({ params }: MovieWatchPageProps): Promise<Metadata> {
  const { id } = await params;
  const movie = await getPublicMoviePlayback(id);

  if (!movie) {
    return { title: 'Movie not found' };
  }

  return {
    title: `${movie.title} — Watch`,
    description: movie.description ?? undefined,
  };
}

export default async function MovieWatchPage({ params }: MovieWatchPageProps) {
  const { id, slug } = await params;

  const movie = await getPublicMoviePlayback(id);

  if (!movie) {
    notFound();
  }

  if (movie.slug !== slug) {
    // A slug the movie used before is redirected to the canonical URL; a
    // guessed slug is a 404.
    const canonicalSlug = await resolvePublicContentSlug('movie', id, slug);

    if (canonicalSlug !== null) {
      redirect(publicMovieWatchHref(id, canonicalSlug));
    }

    notFound();
  }

  const actor = await resolveActor();
  const playbackState = await getMoviePlaybackState(actor.userId, movie.id);

  // A stored position at the very end of the film is not a resume point: the
  // viewer already finished it. The same is true for a film the completion
  // threshold has already marked as watched — it is complete, not unfinished.
  const resumePositionSeconds =
    playbackState !== null &&
    !playbackState.watched &&
    playbackState.durationSeconds > 0 &&
    playbackState.positionSeconds > 0 &&
    playbackState.positionSeconds < playbackState.durationSeconds
      ? playbackState.positionSeconds
      : 0;

  return (
    <PublicPageLayout title={movie.title}>
      <div className="space-y-6">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <Link href="/movie" className="hover:text-foreground">
            Movies
          </Link>
          <span aria-hidden="true" className="px-1.5">
            /
          </span>
          <Link href={`/movie/${movie.id}/${movie.slug}`} className="hover:text-foreground">
            {movie.title}
          </Link>
        </nav>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{movie.title}</h1>
          <p className="text-sm text-muted-foreground">Movie</p>
        </div>

        <VidstackPlayer
          movieId={movie.id}
          title={movie.title}
          source={movie.videoSource}
          subtitleTracks={[]}
          signedIn={actor.userId !== null}
          completionThresholdPercent={serverConfig.playbackCompletionThresholdPercent}
          resumePositionSeconds={resumePositionSeconds}
          mediaLabel="movie"
        />

        {movie.description ? (
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {movie.description}
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          This film is streamed directly from its external host. DramaScan does not download,
          proxy, or rehost the video.
        </p>

        <Link
          href={`/movie/${movie.id}/${movie.slug}`}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          Back to {movie.title}
        </Link>
      </div>
    </PublicPageLayout>
  );
}
