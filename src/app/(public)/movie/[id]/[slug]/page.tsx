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
import {
  getRatingSummary,
  getUserRating,
  getUserReview,
  listReviews,
  recalculateMovieReviewSummary,
  reviewSortSchema,
  type ReviewSort,
} from '@/modules/reviews';
import { getMoviePlaybackState, isBookmarked } from '@/modules/users';

import { ViewTracker } from '@/components/analytics/view-tracker';
import { BookmarkButton } from '@/components/public/bookmark-button';
import { ContentHero } from '@/components/public/content-hero';
import { ContinueWatching } from '@/components/public/continue-watching';
import { RatingWidget } from '@/components/public/rating-widget';
import { ReviewsSection } from '@/components/public/reviews-section';
import { ShareButton } from '@/components/public/share-button';
import { ReportForm } from '@/components/public/report-form';
import { PublicPageLayout } from '@/components/public/Layout';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { readStringParam, type PublicSearchParams } from '@/lib/discovery-params';

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
  searchParams: Promise<PublicSearchParams>;
};

export async function generateMetadata({ params }: MovieDetailPageProps): Promise<Metadata> {
  const { id, slug } = await params;
  const movie = await getPublicMovieDetail(id, slug);

  if (!movie) {
    return { title: 'Movie not found' };
  }

  // Only generate metadata for published content; unpublished content gets
  // a 404 rather than exposed metadata (per the approved requirements).
  return {
    title: movie.title,
    description: movie.description ?? undefined,
    // Use the canonical movie URL as the og:url
    openGraph: {
      title: movie.title,
      description: movie.description ?? undefined,
      images: movie.poster ? [
        {
          url: movie.poster,
          width: 1200,
          height: 630,
          alt: movie.title,
        },
      ] : undefined,
      url: `/movie/${id}/${slug}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: movie.title,
      description: movie.description,
      images: movie.poster ? [movie.poster] : undefined,
    },
  };
}

/**
 * Read the requested review order.
 *
 * The parameter arrives from the URL, so it is untrusted: an unknown value
 * falls back to the newest-first order instead of reaching the read model.
 */
function readReviewSort(params: PublicSearchParams): ReviewSort {
  const parsed = reviewSortSchema.safeParse(readStringParam(params, 'reviewSort', 'newest'));

  return parsed.success ? parsed.data : 'newest';
}

export default async function MovieDetailPage({
  params,
  searchParams,
}: MovieDetailPageProps) {
  const { id, slug } = await params;
  const rawParams = await searchParams;

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
  const reviewSort = readReviewSort(rawParams);

  const [rating, viewCount, bookmarked, playbackState] = await Promise.all([
    getRatingSummary('movie', movie.id),
    getContentViewCount('movie', movie.id),
    isBookmarked(actor, { type: 'movie', id: movie.id }),
    getMoviePlaybackState(actor.userId, movie.id),
  ]);

  const [reviews, userRating, userReview, reviewSummary] = await Promise.all([
    listReviews('movie', movie.id, { sort: reviewSort, viewerId: actor.userId }),
    getUserRating(actor.userId, 'movie', movie.id),
    getUserReview(actor.userId, 'movie', movie.id),
    recalculateMovieReviewSummary(movie.id),
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

      <ShareButton href={publicMovieHref(movie.id, movie.slug)} title={movie.title} />

      {actor.userId !== null && (
        <ReportForm
          contentType="movie"
          contentId={movie.id}
          title={movie.title}
        />
      )}

    </>
  );

  return (
    <PublicPageLayout title={movie.title}>
      <ViewTracker type="movie" contentId={movie.id} />
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

        <section aria-labelledby="ratings-heading" className="space-y-4">
          <h2 id="ratings-heading" className="text-xl font-semibold tracking-tight text-foreground">
            Your rating
          </h2>

          <RatingWidget
            type="movie"
            contentId={movie.id}
            initialRating={userRating}
            average={rating?.average ?? null}
            count={rating?.count ?? 0}
            signedIn={actor.userId !== null}
          />
        </section>

        <ReviewsSection
          type="movie"
          contentId={movie.id}
          basePath={`/movie/${movie.id}/${movie.slug}`}
          params={rawParams}
          reviews={reviews}
          total={reviewSummary?.count ?? 0}
          sort={reviewSort}
          viewerId={actor.userId}
          userReview={userReview}
        />
      </div>
    </PublicPageLayout>
  );
}
