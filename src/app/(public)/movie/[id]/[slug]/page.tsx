import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Play } from 'lucide-react';

import { getContentViewCount } from '@/modules/analytics';
import { resolveActor } from '@/modules/authorization';
import {
  getPublicMovieDetail,
  publicMovieHref,
  resolvePublicContentSlug,
} from '@/modules/content';
import { getRatingSummary } from '@/modules/reviews';
import { getMoviePlaybackState, isBookmarked } from '@/modules/users';

import { BookmarkButton } from '@/components/public/bookmark-button';
import { ContentHero } from '@/components/public/content-hero';
import { ContinueWatching } from '@/components/public/continue-watching';
import { PublicPageLayout } from '@/components/public/Layout';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The public standalone-movie details page.
 *
 * A movie is an independent content item: there is no drama, no season, and
 * no episode navigation, so none is rendered. Everything else — poster, banner,
 * title, description, categories, platforms, rating, view count, the bookmark
 * action, and the Play/Continue action — is the same shared hero the drama
 * page uses.
 *
 * A movie that is not published, is in the Trash, or has no playable source is
 * a 404, so a guessed URL never reveals it.
 */

export const dynamic = 'force-dynamic';

type MovieDetailPageProps = {
  params: Promise<{ id: string; slug: string }>;
};

export async function generateMetadata({ params }: MovieDetailPageProps): Promise<Metadata> {
  const { id, slug } = await params;
  const movie = await getPublicMovieDetail(id, slug);

  if (!movie) {
    return { title: 'Movie not found' };
  }

  return {
    title: movie.title,
    description: movie.description ?? undefined,
  };
}

export default async function MovieDetailPage({ params }: MovieDetailPageProps) {
  const { id, slug } = await params;

  const movie = await getPublicMovieDetail(id, slug);

  if (!movie) {
    // A slug the movie used before is redirected to the canonical URL; a
    // guessed slug is a 404.
    const canonicalSlug = await resolvePublicContentSlug('movie', id, slug);

    if (canonicalSlug !== null) {
      redirect(publicMovieHref(id, canonicalSlug));
    }

    notFound();
  }

  const actor = await resolveActor();

  const [rating, viewCount, bookmarked, playbackState] = await Promise.all([
    getRatingSummary('movie', movie.id),
    getContentViewCount('movie', movie.id),
    isBookmarked(actor, { type: 'movie', id: movie.id }),
    getMoviePlaybackState(actor.userId, movie.id),
  ]);

  const hasProgress =
    playbackState !== null &&
    !playbackState.watched &&
    playbackState.positionSeconds > 0 &&
    playbackState.durationSeconds > playbackState.positionSeconds;

  const playAction = hasProgress ? (
    <ContinueWatching
      href={movie.watchHref}
      label="this film"
      positionSeconds={playbackState?.positionSeconds ?? 0}
      durationSeconds={playbackState?.durationSeconds ?? 0}
    />
  ) : (
    <Link
      href={movie.watchHref}
      className={cn(buttonVariants({ variant: 'default', size: 'lg' }), 'gap-2')}
    >
      <Play className="size-4" aria-hidden="true" />
      Play
    </Link>
  );

  const actions = (
    <>
      {playAction}

      <BookmarkButton
        type="movie"
        id={movie.id}
        initialBookmarked={bookmarked}
        signedIn={actor.userId !== null}
      />
    </>
  );

  return (
    <PublicPageLayout title={movie.title}>
      <div className="space-y-12">
        <ContentHero
          eyebrow="Movie"
          title={movie.title}
          description={movie.description}
          poster={movie.poster}
          banner={movie.banner}
          rating={rating}
          viewCount={viewCount}
          categories={movie.categories}
          platforms={movie.platforms}
          actions={actions}
        />
      </div>
    </PublicPageLayout>
  );
}
