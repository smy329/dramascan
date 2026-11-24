import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Play } from 'lucide-react';

import { getContentViewCount } from '@/modules/analytics';
import { resolveActor } from '@/modules/authorization';
import {
  getPublicDramaDetail,
  publicDramaHref,
  publicEpisodeHref,
  resolvePublicContentSlug,
  type PublicEpisodeSummary,
} from '@/modules/content';
import {
  getRatingSummary,
  getUserRating,
  getUserReview,
  listReviews,
  recalculateDramaReviewSummary,
  reviewSortSchema,
  type ReviewSort,
} from '@/modules/reviews';
import { getDramaResumePoint, isBookmarked } from '@/modules/users';

import { BookmarkButton } from '@/components/public/bookmark-button';
import { ContentCard } from '@/components/public/ContentCard';
import { ContentHero } from '@/components/public/content-hero';
import { ContinueWatching } from '@/components/public/continue-watching';
import { EpisodeNavigation } from '@/components/public/episode-navigation';
import { RatingWidget } from '@/components/public/rating-widget';
import { ReviewsSection } from '@/components/public/reviews-section';
import { ShareButton } from '@/components/public/share-button';
import { ReportForm } from '@/components/public/report-form';
import { PublicPageLayout } from '@/components/public/Layout';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { readStringParam, type PublicSearchParams } from '@/lib/discovery-params';

/**
 * The public drama details page.
 *
 * Everything on this page comes from the content module's public read models.
 * A drama that is not discoverable — not published, in the Trash, or hidden
 * until it has a playable episode — is a 404, so a guessed URL never reveals
 * it. The episode list contains only publicly playable episodes, which is why
 * an unpublished episode cannot appear here.
 *
 * The page is a Server Component: it reads the database directly, resolves the
 * viewer's session on the server, and renders plain HTML.
 */

export const dynamic = 'force-dynamic';

type DramaDetailPageProps = {
  params: Promise<{ dramaId: string; slug: string }>;
  searchParams: Promise<PublicSearchParams>;
};

export async function generateMetadata({ params }: DramaDetailPageProps): Promise<Metadata> {
  const { dramaId, slug } = await params;
  const drama = await getPublicDramaDetail(dramaId, slug);

  if (!drama) {
    return { title: 'Drama not found' };
  }

  // Only generate metadata for published content; unpublished content gets
  // a 404 rather than exposed metadata (per the approved requirements).
  return {
    title: drama.title,
    description: drama.description ?? undefined,
    // Use the canonical drama URL as the og:url
    openGraph: {
      title: drama.title,
      description: drama.description ?? undefined,
      images: drama.poster ? [
        {
          url: drama.poster,
          width: 1200,
          height: 630,
          alt: drama.title,
        },
      ] : undefined,
      url: `/drama/${dramaId}/${slug}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: drama.title,
      description: drama.description,
      images: drama.poster ? [drama.poster] : undefined,
    },
  };
}

/** The label a viewer sees for one episode in the resume card. */
function episodeLabel(episode: PublicEpisodeSummary): string {
  if (episode.seasonTitle) {
    return `${episode.seasonTitle} · Episode ${episode.episodeNumber ?? episode.position ?? 1}`;
  }

  return `Episode ${episode.episodeNumber ?? episode.position ?? 1}`;
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

export default async function DramaDetailPage({
  params,
  searchParams,
}: DramaDetailPageProps) {
  const { dramaId, slug } = await params;
  const rawParams = await searchParams;

  const drama = await getPublicDramaDetail(dramaId, slug);

  if (!drama) {
    // A slug the drama used before is redirected to the canonical URL; a
    // guessed slug is a 404.
    const canonicalSlug = await resolvePublicContentSlug('drama', dramaId, slug);

    if (canonicalSlug !== null) {
      redirect(publicDramaHref(dramaId, canonicalSlug));
    }

    notFound();
  }

  const actor = await resolveActor();
  const reviewSort = readReviewSort(rawParams);

  const [rating, viewCount, bookmarked, resumePoint] = await Promise.all([
    getRatingSummary('drama', drama.id),
    getContentViewCount('drama', drama.id),
    isBookmarked(actor, { type: 'drama', id: drama.id }),
    getDramaResumePoint(actor.userId, drama.id),
  ]);

  const [reviews, userRating, userReview, reviewSummary] = await Promise.all([
    listReviews('drama', drama.id, { sort: reviewSort, viewerId: actor.userId }),
    getUserRating(actor.userId, 'drama', drama.id),
    getUserReview(actor.userId, 'drama', drama.id),
    recalculateDramaReviewSummary(drama.id),
  ]);

  // The resume point is only usable when the episode it names is still
  // publicly playable. The content module owns that decision.
  const resumeEpisode =
    resumePoint === null
      ? null
      : drama.episodes.find(episode => episode.id === resumePoint.episodeId) ?? null;

  const firstEpisode = drama.episodes[0] ?? null;

  const actions = (
      <>
        {resumeEpisode ? (
          <ContinueWatching
            href={publicEpisodeHref(drama.id, drama.slug, resumeEpisode.id)}
            label={episodeLabel(resumeEpisode)}
            positionSeconds={resumePoint?.positionSeconds ?? 0}
            durationSeconds={resumePoint?.durationSeconds ?? 0}
          />
        ) : firstEpisode ? (
          <Link
            href={publicEpisodeHref(drama.id, drama.slug, firstEpisode.id)}
            className={cn(buttonVariants({ variant: 'default', size: 'lg' }), 'gap-2')}
          >
            <Play className="size-4" aria-hidden="true" />
            {firstEpisode.episodeNumber !== null
              ? `Play episode ${firstEpisode.episodeNumber}`
              : 'Play'}
          </Link>
        ) : (
          <span className="inline-flex h-9 items-center rounded-lg border border-border bg-muted px-4 text-sm text-muted-foreground">
            Coming soon
          </span>
        )}

        <BookmarkButton
          type="drama"
          id={drama.id}
          initialBookmarked={bookmarked}
          signedIn={actor.userId !== null}
        />

        <ShareButton href={publicDramaHref(drama.id, drama.slug)} title={drama.title} />

        {actor.userId !== null && (
          <ReportForm
            contentType="drama"
            contentId={drama.id}
            title={drama.title}
          />
        )}
      </>
    );

  return (
    <PublicPageLayout title={drama.title}>
      <div className="space-y-12">
        <ContentHero
          eyebrow="Drama"
          title={drama.title}
          description={drama.description}
          poster={drama.poster}
          banner={drama.banner}
          status={drama.status}
          comingSoon={drama.comingSoon}
          rating={rating}
          viewCount={viewCount}
          categories={drama.categories}
          platforms={drama.platforms}
          actions={actions}
        >
          <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-muted-foreground">
            <div className="flex gap-2">
              <dt className="font-medium text-foreground">Episodes</dt>
              <dd>{drama.episodes.length}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="font-medium text-foreground">Seasons</dt>
              <dd>{drama.seasons.length}</dd>
            </div>
          </dl>
        </ContentHero>

        {drama.episodes.length > 0 ? (
          <section aria-labelledby="episodes-heading" className="space-y-4">
            <h2 id="episodes-heading" className="text-xl font-semibold tracking-tight text-foreground">
              Episodes
            </h2>

            <EpisodeNavigation
              episodes={drama.episodes}
              currentEpisodeId={null}
              structureType={drama.structureType}
            />
          </section>
        ) : (
          <section className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-10 text-center">
            <h2 className="text-lg font-semibold text-foreground">No episodes are available yet</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
              This drama is published, but no episode is playable at the moment. The episodes appear
              here as soon as they are published.
            </p>
          </section>
        )}

        {drama.similarDramas.length > 0 ? (
          <section aria-labelledby="similar-heading" className="space-y-4">
            <h2 id="similar-heading" className="text-xl font-semibold tracking-tight text-foreground">
              Similar dramas
            </h2>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {drama.similarDramas.map(dramaItem => (
                <ContentCard
                  key={dramaItem.id}
                  kind="drama"
                  title={dramaItem.title}
                  poster={dramaItem.poster}
                  status={dramaItem.status}
                  href={dramaItem.href}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="ratings-heading" className="space-y-4">
          <h2 id="ratings-heading" className="text-xl font-semibold tracking-tight text-foreground">
            Your rating
          </h2>

          <RatingWidget
            type="drama"
            contentId={drama.id}
            initialRating={userRating}
            average={rating?.average ?? null}
            count={rating?.count ?? 0}
            signedIn={actor.userId !== null}
          />
        </section>

        <ReviewsSection
          type="drama"
          contentId={drama.id}
          basePath={`/drama/${drama.id}/${drama.slug}`}
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
