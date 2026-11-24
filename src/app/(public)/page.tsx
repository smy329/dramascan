import type { JSX } from 'react';
import Link from 'next/link';

import { ContentRail, type RailItem } from '@/components/public/content-rail';
import { HomeHero } from '@/components/public/home-hero';
import { HomeHeroRotator, type HeroSlide } from '@/components/public/home-hero-rotator';
import { PublicPageLayout } from '@/components/public/Layout';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  getFeaturedContentSetting,
  getHeroRotationSetting,
  getTrendingPinsSetting,
} from '@/modules/administration';
import {
  listPopularContent,
  listTrendingContent,
  type RankedContent,
} from '@/modules/analytics';
import { resolveActor } from '@/modules/authorization';
import {
  getPublicFeaturedContent,
  listCategorySections,
  listPublicContentTargets,
  listPublicEpisodeTargets,
  listPublicHeroCandidates,
  listRecentlyAddedContent,
  type DiscoveryCard,
} from '@/modules/content';
import { listContinueWatchingItems } from '@/modules/users';

/**
 * The public homepage.
 *
 * The page composes the sections the requirements ask for: a hero, Trending,
 * Popular, Recently Added, Continue Watching for a signed-in viewer, and one
 * carousel per category.
 *
 * Every read comes from a module read model that applies the public
 * availability rules, so an unpublished or trashed item cannot appear here.
 * A guest never receives another viewer's Continue Watching items: the
 * section is built from the resolved actor, and an anonymous actor has no
 * user id to read them with.
 */

export const dynamic = 'force-dynamic';

/** Convert a ranked item into the card shape a rail renders. */
function toRailItem(item: RankedContent): RailItem {
  return {
    kind: item.type,
    title: item.title,
    poster: item.poster,
    href: item.href,
    rating:
      item.ratingAverage !== null && item.ratingCount > 0
        ? { average: item.ratingAverage, count: item.ratingCount }
        : null,
    status: item.status,
    comingSoon: item.comingSoon,
  };
}

/** Convert a discovery card into the card shape a rail renders. */
function toDiscoveryRailItem(card: DiscoveryCard): RailItem {
  return {
    kind: card.type,
    title: card.title,
    poster: card.poster,
    href: card.href,
    rating: null,
    status: card.status,
    comingSoon: card.comingSoon,
  };
}

/** The hero item shape the hero components take. */
function toHeroItem(card: DiscoveryCard): HeroSlide {
  return {
    id: card.id,
    type: card.type,
    title: card.title,
    description: card.description,
    poster: card.poster,
    banner: card.banner,
    href: card.href,
    status: card.status,
  };
}

export default async function HomePage(): Promise<JSX.Element> {
  const [actor, featuredSetting, rotationSetting, trendingPins] = await Promise.all([
    resolveActor(),
    getFeaturedContentSetting(),
    getHeroRotationSetting(),
    getTrendingPinsSetting(),
  ]);

  // The administrator's selection wins. When it is missing, or the selected
  // item is no longer publicly available, the most recently published eligible
  // item is used instead.
  const heroCandidates = await listPublicHeroCandidates(12);

  let featured = featuredSetting
    ? await getPublicFeaturedContent(featuredSetting.type, featuredSetting.id)
    : null;

  if (!featured) {
    featured = heroCandidates[0] ?? null;
  }

  const slides: HeroSlide[] = [];

  if (rotationSetting.enabled) {
    if (featured) {
      slides.push(toHeroItem(featured));
    }

    for (const reference of rotationSetting.items) {
      const card = await getPublicFeaturedContent(reference.type, reference.id);

      if (!card || slides.some(slide => slide.id === card.id)) {
        continue;
      }

      slides.push(toHeroItem(card));
    }
  }

  const pinnedIds = trendingPins.map(pin => pin.id);

  const [trending, popular, recentlyAdded, categorySections, continueItems] = await Promise.all([
    listTrendingContent({ pageSize: 12, pinnedIds }),
    listPopularContent({ pageSize: 12 }),
    listRecentlyAddedContent({ limit: 12 }),
    listCategorySections({ limit: 12 }),
    listContinueWatchingItems(actor.userId),
  ]);

  // Continue Watching needs the public card data and the episode routes. Both
  // are resolved in batches so the section costs a fixed number of queries.
  const episodeIds = continueItems
    .map(item => item.episodeId)
    .filter((id): id is string => id !== null);

  const [episodeTargets, contentTargets] = await Promise.all([
    listPublicEpisodeTargets(episodeIds),
    listPublicContentTargets(
      continueItems.map(item => ({ type: item.contentType, id: item.contentId }))
    ),
  ]);

  const contentByKey = new Map(contentTargets.map(target => [`${target.type}:${target.id}`, target]));
  const episodeById = new Map(episodeTargets.map(target => [target.episodeId, target]));

  const continueWatching: Array<{
    id: string;
    title: string;
    poster: string | null;
    href: string;
    episodeTitle: string | null;
    progress: number;
  }> = [];

  for (const item of continueItems) {
    const progress =
      item.durationSeconds > 0
        ? Math.min(100, Math.round(item.positionSeconds / item.durationSeconds * 100))
        : 0;

    const episodeTarget = item.episodeId ? episodeById.get(item.episodeId) : undefined;

    if (episodeTarget) {
      const content = contentByKey.get(`drama:${episodeTarget.dramaId}`);

      if (!content) {
        continue;
      }

      continueWatching.push({
        id: item.id,
        title: content.title,
        poster: content.poster,
        href: episodeTarget.href,
        episodeTitle: episodeTarget.title,
        progress,
      });

      continue;
    }

    const content = contentByKey.get(`${item.contentType}:${item.contentId}`);

    if (!content) {
      continue;
    }

    continueWatching.push({
      id: item.id,
      title: content.title,
      poster: content.poster,
      href: content.href,
      episodeTitle: null,
      progress,
    });
  }

  return (
    <PublicPageLayout title="Home">
      <div className="space-y-12">
        {rotationSetting.enabled && slides.length > 1 ? (
          <HomeHeroRotator slides={slides} />
        ) : featured ? (
          <HomeHero item={toHeroItem(featured)} />
        ) : (
          <section className="rounded-2xl border border-dashed border-border bg-card/40 px-6 py-14 text-center">
            <h1 className="text-2xl font-semibold text-foreground">
              The catalogue is being prepared
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
              Nothing is published yet. As soon as a drama or a film is published, it appears
              here.
            </p>
            <Link
              href="/categories"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-6')}
            >
              Browse the categories
            </Link>
          </section>
        )}

        {continueWatching.length > 0 ? (
          <section aria-labelledby="continue-watching-heading" className="space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 id="continue-watching-heading" className="text-xl font-semibold text-foreground">
                  Continue watching
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pick up exactly where you stopped.
                </p>
              </div>
              <Link
                href="/continue-watching"
                className="shrink-0 text-sm font-medium text-primary hover:underline"
              >
                See all
              </Link>
            </div>

            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {continueWatching.map(item => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex gap-4 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40"
                  >
                    {item.poster ? (
                      <img
                        src={item.poster}
                        alt=""
                        aria-hidden="true"
                        className="h-24 w-16 shrink-0 rounded-md border border-border object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-24 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-background/60 text-[10px] text-muted-foreground"
                      >
                        No poster
                      </span>
                    )}

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {item.title}
                      </span>
                      {item.episodeTitle ? (
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {item.episodeTitle}
                        </span>
                      ) : null}
                      <span
                        aria-hidden="true"
                        className="mt-3 block h-1.5 overflow-hidden rounded-full bg-secondary"
                      >
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${item.progress}%` }}
                        />
                      </span>
                      <span className="mt-1.5 block text-xs text-muted-foreground">
                        {item.progress}% watched
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <ContentRail
          title="Trending"
          description="What people are watching right now."
          href="/trending"
          items={trending.items.map(toRailItem)}
        />

        <ContentRail
          title="Popular"
          description="The all-time favourites of the catalogue."
          href="/popular"
          items={popular.items.map(toRailItem)}
        />

        <ContentRail
          title="Recently added"
          description="The newest published dramas and films."
          href="/recently-added"
          items={recentlyAdded.map(toDiscoveryRailItem)}
        />

        {categorySections.map(section => (
          <ContentRail
            key={section.id}
            title={section.name}
            href={section.href}
            items={section.items.map(toDiscoveryRailItem)}
          />
        ))}
      </div>
    </PublicPageLayout>
  );
}
