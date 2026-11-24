import 'server-only';

import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { db } from '@/db/client';

import { notHiddenWhileEmpty, playableEpisodeExists } from './public-dramas';
import { publicDramaHref } from './public-dramas.shared';
import {
  dramaStatus,
  escapeLikeTerm,
  type DiscoveryContentType,
} from './public-discovery.shared';
import { publicMovieHref } from './public-movies.shared';
import {
  categories,
  drama_categories as dramaCategories,
  drama_platforms as dramaPlatforms,
  dramas,
  movie_categories as movieCategories,
  movie_platforms as moviePlatforms,
  movies,
  platforms,
} from './schema';

/**
 * Public discovery read models owned by `content`.
 *
 * Every public list on the site — the homepage carousels, the category and
 * platform browse pages, the search suggestions, and the hero — is built from
 * the reads in this file or from the cross-module reporting read models in
 * `analytics/read-models/`. One module owns the rule that decides whether an
 * item may be shown, so a page cannot accidentally widen it.
 *
 * The availability predicates are the same ones the detail pages use:
 *
 *   drama: published, not in Trash, and either not hidden while it has no
 *          playable episode or it has one. A season-based drama requires a
 *          published, non-deleted season.
 *   movie: published, not in Trash, and it has a stored source.
 *
 * The queries are always bounded. A discovery page never loads the whole
 * catalogue into memory.
 */

/** The content kinds the public site shows. */
export type { DiscoveryContentType } from './public-discovery.shared';

/** One content item as a discovery card shows it. */
export type DiscoveryCard = {
  type: DiscoveryContentType;
  id: string;
  title: string;
  description: string | null;
  poster: string | null;
  banner: string | null;
  href: string;
  /** `ongoing` / `completed` for a drama; movies are standalone features. */
  status: 'ongoing' | 'completed' | null;
  /**
   * Whether the item is listed before it can be played.
   *
   * A drama is "coming soon" when it is public but has no playable episode: it
   * has a poster and a page, but nothing to watch yet. A movie is always
   * available, because a public movie carries a source.
   */
  comingSoon: boolean;
  /** The real publication time, used by "Recently Added". */
  publishedAt: string | null;
};

/**
 * The SQL predicate that decides whether a drama may appear in public
 * discovery.
 *
 * It is exported so the cross-module reporting read models apply exactly the
 * same rule instead of approximating it.
 */
export function publicDramaAvailability(): SQL {
  return and(
    isNull(dramas.deleted_at),
    eq(dramas.publication_status, 'published'),
    or(notHiddenWhileEmpty(), playableEpisodeExists())
  ) as SQL;
}

/**
 * The SQL predicate that decides whether a movie may appear in public
 * discovery.
 */
export function publicMovieAvailability(): SQL {
  return and(
    isNull(movies.deleted_at),
    eq(movies.publication_status, 'published'),
    isNotNull(movies.video_source),
    sql`btrim(${movies.video_source}) <> ''`
  ) as SQL;
}

/** The drama's lifecycle status, normalized to the two public values. */
export { dramaStatus } from './public-discovery.shared';

/** Escape the LIKE wildcards so a search term is matched literally. */
export { escapeLikeTerm } from './public-discovery.shared';

/**
 * Recently added content.
 *
 * The order is the real publication time: `published_at` is stamped by the
 * publication workflow the first time an item is published and is never
 * overwritten, so it cannot be edited into a fake date. Drafts, unpublished
 * items, and trashed items are excluded by the availability predicate.
 */
export async function listRecentlyAddedContent(
  options: { type?: 'all' | DiscoveryContentType; limit?: number } = {}
): Promise<DiscoveryCard[]> {
  const type = options.type ?? 'all';
  const limit = Math.max(1, Math.min(options.limit ?? 12, 50));

  const [dramaRows, movieRows] = await Promise.all([
    type === 'movie'
      ? Promise.resolve([])
      : db
          .select({
            id: dramas.id,
            title: dramas.title,
            description: dramas.description,
            poster: dramas.poster,
            banner: dramas.banner,
            slug: dramas.slug,
            status: dramas.status,
            hasPlayableEpisode: sql<boolean>`${playableEpisodeExists()}`,
            publishedAt: dramas.published_at,
          })
          .from(dramas)
          .where(publicDramaAvailability())
          .orderBy(desc(dramas.published_at), asc(dramas.title), asc(dramas.id))
          .limit(limit),
    type === 'drama'
      ? Promise.resolve([])
      : db
          .select({
            id: movies.id,
            title: movies.title,
            description: movies.description,
            poster: movies.poster,
            banner: movies.banner,
            slug: movies.slug,
            hasPlayableEpisode: sql<boolean>`true`,
            publishedAt: movies.published_at,
          })
          .from(movies)
          .where(publicMovieAvailability())
          .orderBy(desc(movies.published_at), asc(movies.title), asc(movies.id))
          .limit(limit),
  ]);

  const items: DiscoveryCard[] = [
    ...dramaRows.map(row => ({
      type: 'drama' as const,
      id: row.id,
      title: row.title,
      description: row.description,
      poster: row.poster,
      banner: row.banner,
      href: publicDramaHref(row.id, row.slug),
      status: dramaStatus(row.status),
      comingSoon: !row.hasPlayableEpisode,
      publishedAt: row.publishedAt?.toISOString() ?? null,
    })),
    ...movieRows.map(row => ({
      type: 'movie' as const,
      id: row.id,
      title: row.title,
      description: row.description,
      poster: row.poster,
      banner: row.banner,
      href: publicMovieHref(row.id, row.slug),
      status: null,
      comingSoon: false,
      publishedAt: row.publishedAt?.toISOString() ?? null,
    })),
  ];

  items.sort((left, right) => {
    const leftTime = left.publishedAt ?? '';
    const rightTime = right.publishedAt ?? '';

    if (leftTime !== rightTime) {
      return rightTime.localeCompare(leftTime);
    }

    const byTitle = left.title.localeCompare(right.title);

    return byTitle !== 0 ? byTitle : left.id.localeCompare(right.id);
  });

  return items.slice(0, limit);
}

/** One public taxonomy entry. */
export type PublicTaxonomy = {
  id: string;
  name: string;
  slug: string;
  /** How many published items use the taxonomy. */
  contentCount: number;
  href: string;
};

/**
 * The public category list, in the administrator's order.
 *
 * A category with no published content is not listed: an empty category is a
 * dead end, not a destination.
 */
export async function listPublicCategories(): Promise<PublicTaxonomy[]> {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
    })
    .from(categories)
    .where(isNull(categories.deleted_at))
    .orderBy(asc(categories.position), asc(categories.name));

  const published = await listPublicTaxonomyCounts('category');

  return rows
    .map(row => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      contentCount: published.get(row.id) ?? 0,
      href: `/categories?category=${encodeURIComponent(row.slug)}`,
    }))
    .filter(row => row.contentCount > 0);
}

/**
 * The public platform list, in the administrator's order.
 */
export async function listPublicPlatforms(): Promise<PublicTaxonomy[]> {
  const rows = await db
    .select({
      id: platforms.id,
      name: platforms.name,
      slug: platforms.slug,
    })
    .from(platforms)
    .where(isNull(platforms.deleted_at))
    .orderBy(asc(platforms.position), asc(platforms.name));

  const published = await listPublicTaxonomyCounts('platform');

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    contentCount: published.get(row.id) ?? 0,
    href: `/platforms?platform=${encodeURIComponent(row.slug)}`,
  }));
}

/**
 * How many published items use each taxonomy entry.
 *
 * The count is computed from the published rows only, so a taxonomy entry
 * never advertises content the public cannot open.
 */
async function listPublicTaxonomyCounts(
  kind: 'category' | 'platform'
): Promise<Map<string, number>> {
  if (kind === 'category') {
    const rows = await db
      .select({ id: categories.id, total: count() })
      .from(categories)
      .innerJoin(dramaCategories, eq(dramaCategories.category_id, categories.id))
      .innerJoin(dramas, eq(dramas.id, dramaCategories.drama_id))
      .where(and(isNull(categories.deleted_at), publicDramaAvailability()))
      .groupBy(categories.id);

    const counts = new Map(rows.map(row => [row.id, Number(row.total ?? 0)]));

    const movieRows = await db
      .select({ id: categories.id, total: count() })
      .from(categories)
      .innerJoin(movieCategories, eq(movieCategories.category_id, categories.id))
      .innerJoin(movies, eq(movies.id, movieCategories.movie_id))
      .where(and(isNull(categories.deleted_at), publicMovieAvailability()))
      .groupBy(categories.id);

    for (const row of movieRows) {
      counts.set(row.id, (counts.get(row.id) ?? 0) + Number(row.total ?? 0));
    }

    return counts;
  }

  const rows = await db
    .select({ id: platforms.id, total: count() })
    .from(platforms)
    .innerJoin(dramaPlatforms, eq(dramaPlatforms.platform_id, platforms.id))
    .innerJoin(dramas, eq(dramas.id, dramaPlatforms.drama_id))
    .where(and(isNull(platforms.deleted_at), publicDramaAvailability()))
    .groupBy(platforms.id);

  const counts = new Map(rows.map(row => [row.id, Number(row.total ?? 0)]));

  const movieRows = await db
    .select({ id: platforms.id, total: count() })
    .from(platforms)
    .innerJoin(moviePlatforms, eq(moviePlatforms.platform_id, platforms.id))
    .innerJoin(movies, eq(movies.id, moviePlatforms.movie_id))
    .where(and(isNull(platforms.deleted_at), publicMovieAvailability()))
    .groupBy(platforms.id);

  for (const row of movieRows) {
    counts.set(row.id, (counts.get(row.id) ?? 0) + Number(row.total ?? 0));
  }

  return counts;
}

/** One category section of the homepage. */
export type CategorySection = {
  id: string;
  name: string;
  slug: string;
  href: string;
  items: DiscoveryCard[];
};

/**
 * The homepage category carousels.
 *
 * A section is only rendered when it has content: an empty carousel is noise.
 * The order is the administrator's category order.
 */
export async function listCategorySections(
  options: { limit?: number } = {}
): Promise<CategorySection[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 12, 24));

  const taxonomy = await listPublicCategories();
  const sections: CategorySection[] = [];

  for (const category of taxonomy) {
    const items = await listContentByCategorySlug(category.slug, limit);

    if (items.length === 0) {
      continue;
    }

    sections.push({
      id: category.id,
      name: category.name,
      slug: category.slug,
      href: category.href,
      items,
    });
  }

  return sections;
}

/**
 * The published content of one category.
 *
 * The category is addressed by its slug, which is the public identifier. An
 * unknown slug yields an empty list rather than an error: a browse page has
 * to survive a stale link.
 */
export async function listContentByCategorySlug(
  categorySlug: string,
  limit = 24
): Promise<DiscoveryCard[]> {
  const bounded = Math.max(1, Math.min(limit, 100));

  const [categoryRow] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.slug, categorySlug), isNull(categories.deleted_at)))
    .limit(1);

  if (!categoryRow) {
    return [];
  }

  const [dramaRows, movieRows] = await Promise.all([
    db
      .select({
        id: dramas.id,
        title: dramas.title,
        description: dramas.description,
        poster: dramas.poster,
        banner: dramas.banner,
        slug: dramas.slug,
        status: dramas.status,
        hasPlayableEpisode: sql<boolean>`${playableEpisodeExists()}`,
        publishedAt: dramas.published_at,
      })
      .from(dramas)
      .innerJoin(dramaCategories, eq(dramaCategories.drama_id, dramas.id))
      .where(and(publicDramaAvailability(), eq(dramaCategories.category_id, categoryRow.id)))
      .orderBy(desc(dramas.published_at), asc(dramas.title), asc(dramas.id))
      .limit(bounded),
    db
      .select({
        id: movies.id,
        title: movies.title,
        description: movies.description,
        poster: movies.poster,
        banner: movies.banner,
        slug: movies.slug,
        hasPlayableEpisode: sql<boolean>`true`,
        publishedAt: movies.published_at,
      })
      .from(movies)
      .innerJoin(movieCategories, eq(movieCategories.movie_id, movies.id))
      .where(and(publicMovieAvailability(), eq(movieCategories.category_id, categoryRow.id)))
      .orderBy(desc(movies.published_at), asc(movies.title), asc(movies.id))
      .limit(bounded),
  ]);

  return mergeDiscoveryCards(dramaRows, movieRows).slice(0, bounded);
}

/**
 * The published content of one platform.
 *
 * The platform is addressed by its slug, which is the public identifier.
 */
export async function listContentByPlatformSlug(
  platformSlug: string,
  limit = 24
): Promise<DiscoveryCard[]> {
  const bounded = Math.max(1, Math.min(limit, 100));

  const [platformRow] = await db
    .select({ id: platforms.id })
    .from(platforms)
    .where(and(eq(platforms.slug, platformSlug), isNull(platforms.deleted_at)))
    .limit(1);

  if (!platformRow) {
    return [];
  }

  const [dramaRows, movieRows] = await Promise.all([
    db
      .select({
        id: dramas.id,
        title: dramas.title,
        description: dramas.description,
        poster: dramas.poster,
        banner: dramas.banner,
        slug: dramas.slug,
        status: dramas.status,
        hasPlayableEpisode: sql<boolean>`${playableEpisodeExists()}`,
        publishedAt: dramas.published_at,
      })
      .from(dramas)
      .innerJoin(dramaPlatforms, eq(dramaPlatforms.drama_id, dramas.id))
      .where(and(publicDramaAvailability(), eq(dramaPlatforms.platform_id, platformRow.id)))
      .orderBy(desc(dramas.published_at), asc(dramas.title), asc(dramas.id))
      .limit(bounded),
    db
      .select({
        id: movies.id,
        title: movies.title,
        description: movies.description,
        poster: movies.poster,
        banner: movies.banner,
        slug: movies.slug,
        hasPlayableEpisode: sql<boolean>`true`,
        publishedAt: movies.published_at,
      })
      .from(movies)
      .innerJoin(moviePlatforms, eq(moviePlatforms.movie_id, movies.id))
      .where(and(publicMovieAvailability(), eq(moviePlatforms.platform_id, platformRow.id)))
      .orderBy(desc(movies.published_at), asc(movies.title), asc(movies.id))
      .limit(bounded),
  ]);

  return mergeDiscoveryCards(dramaRows, movieRows).slice(0, bounded);
}

/** The shared shape of the drama and movie discovery rows. */
type DiscoveryRow = {
  id: string;
  title: string;
  description: string | null;
  poster: string | null;
  banner: string | null;
  slug: string;
  status?: string | null;
  /**
   * Whether the item can be played now.
   *
   * A drama is "coming soon" when it is public but has no playable episode; a
   * movie always carries a source, so it is always available.
   */
  hasPlayableEpisode: boolean;
  publishedAt: Date | null;
};

/** Merge the drama and movie rows into one newest-first list. */
function mergeDiscoveryCards(
  dramaRows: readonly DiscoveryRow[],
  movieRows: readonly DiscoveryRow[]
): DiscoveryCard[] {
  const items: DiscoveryCard[] = [
    ...dramaRows.map(row => ({
      type: 'drama' as const,
      id: row.id,
      title: row.title,
      description: row.description,
      poster: row.poster,
      banner: row.banner,
      href: publicDramaHref(row.id, row.slug),
      status: dramaStatus(row.status ?? null),
      comingSoon: !row.hasPlayableEpisode,
      publishedAt: row.publishedAt?.toISOString() ?? null,
    })),
    ...movieRows.map(row => ({
      type: 'movie' as const,
      id: row.id,
      title: row.title,
      description: row.description,
      poster: row.poster,
      banner: row.banner,
      href: publicMovieHref(row.id, row.slug),
      status: null,
      comingSoon: false,
      publishedAt: row.publishedAt?.toISOString() ?? null,
    })),
  ];

  items.sort((left, right) => {
    const leftTime = left.publishedAt ?? '';
    const rightTime = right.publishedAt ?? '';

    if (leftTime !== rightTime) {
      return rightTime.localeCompare(leftTime);
    }

    const byTitle = left.title.localeCompare(right.title);

    return byTitle !== 0 ? byTitle : left.id.localeCompare(right.id);
  });

  return items;
}

/** The kinds of thing a search suggestion can point at. */
export type SearchSuggestionType = DiscoveryContentType | 'category' | 'platform';

/** One search suggestion. */
export type SearchSuggestion = {
  type: SearchSuggestionType;
  id: string;
  title: string;
  poster: string | null;
  href: string;
};

/**
 * Live search suggestions.
 *
 * The suggestions cover content titles, category names, and platform names,
 * exactly like the results page. They never expose an unpublished item.
 */
export async function listSearchSuggestions(
  rawQuery: string,
  options: { limit?: number } = {}
): Promise<SearchSuggestion[]> {
  const term = rawQuery.trim();

  if (term.length < 2) {
    return [];
  }

  const limit = Math.max(1, Math.min(options.limit ?? 8, 20));
  const like = `%${escapeLikeTerm(term)}%`;

  const [dramaRows, movieRows, categoryRows, platformRows] = await Promise.all([
    db
      .select({
        id: dramas.id,
        title: dramas.title,
        poster: dramas.poster,
        slug: dramas.slug,
      })
      .from(dramas)
      .where(and(publicDramaAvailability(), ilike(dramas.title, like)))
      .orderBy(asc(dramas.title))
      .limit(limit),
    db
      .select({
        id: movies.id,
        title: movies.title,
        poster: movies.poster,
        slug: movies.slug,
      })
      .from(movies)
      .where(and(publicMovieAvailability(), ilike(movies.title, like)))
      .orderBy(asc(movies.title))
      .limit(limit),
    db
      .select({ id: categories.id, name: categories.name, slug: categories.slug })
      .from(categories)
      .where(and(isNull(categories.deleted_at), ilike(categories.name, like)))
      .orderBy(asc(categories.name))
      .limit(limit),
    db
      .select({ id: platforms.id, name: platforms.name, slug: platforms.slug })
      .from(platforms)
      .where(and(isNull(platforms.deleted_at), ilike(platforms.name, like)))
      .orderBy(asc(platforms.name))
      .limit(limit),
  ]);

  const suggestions: SearchSuggestion[] = [
    ...dramaRows.map(row => ({
      type: 'drama' as const,
      id: row.id,
      title: row.title,
      poster: row.poster,
      href: publicDramaHref(row.id, row.slug),
    })),
    ...movieRows.map(row => ({
      type: 'movie' as const,
      id: row.id,
      title: row.title,
      poster: row.poster,
      href: publicMovieHref(row.id, row.slug),
    })),
    ...categoryRows.map(row => ({
      type: 'category' as const,
      id: row.id,
      title: row.name,
      poster: null,
      href: `/categories?category=${encodeURIComponent(row.slug)}`,
    })),
    ...platformRows.map(row => ({
      type: 'platform' as const,
      id: row.id,
      title: row.name,
      poster: null,
      href: `/platforms?platform=${encodeURIComponent(row.slug)}`,
    })),
  ];

  return suggestions.slice(0, limit);
}

/** The categories and platforms a query term matches, with their content. */
export type SearchTaxonomyMatch = {
  kind: 'category' | 'platform';
  id: string;
  name: string;
  slug: string;
  href: string;
  items: DiscoveryCard[];
};

/**
 * The content behind the categories and platforms a search term matched.
 *
 * A search for "romance" must find the dramas filed under Romance, not only
 * the dramas with "romance" in the title.
 */
export async function listSearchTaxonomyMatches(
  rawQuery: string,
  options: { limit?: number } = {}
): Promise<SearchTaxonomyMatch[]> {
  const term = rawQuery.trim();

  if (term.length < 2) {
    return [];
  }

  const limit = Math.max(1, Math.min(options.limit ?? 4, 12));
  const like = `%${escapeLikeTerm(term)}%`;

  const [categoryRows, platformRows] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name, slug: categories.slug })
      .from(categories)
      .where(and(isNull(categories.deleted_at), ilike(categories.name, like)))
      .orderBy(asc(categories.name))
      .limit(limit),
    db
      .select({ id: platforms.id, name: platforms.name, slug: platforms.slug })
      .from(platforms)
      .where(and(isNull(platforms.deleted_at), ilike(platforms.name, like)))
      .orderBy(asc(platforms.name))
      .limit(limit),
  ]);

  const matches: SearchTaxonomyMatch[] = [];

  for (const category of categoryRows) {
    const items = await listContentByCategorySlug(category.slug, limit);

    if (items.length === 0) {
      continue;
    }

    matches.push({
      kind: 'category',
      id: category.id,
      name: category.name,
      slug: category.slug,
      href: `/categories?category=${encodeURIComponent(category.slug)}`,
      items,
    });
  }

  for (const platform of platformRows) {
    const items = await listContentByPlatformSlug(platform.slug, limit);

    if (items.length === 0) {
      continue;
    }

    matches.push({
      kind: 'platform',
      id: platform.id,
      name: platform.name,
      slug: platform.slug,
      href: `/platforms?platform=${encodeURIComponent(platform.slug)}`,
      items,
    });
  }

  return matches;
}

/**
 * The homepage hero candidates.
 *
 * The administrator picks the hero from these items, so the list only
 * contains content the public can actually open. The order is deterministic:
 * the most recently published first, then the title.
 */
export async function listPublicHeroCandidates(limit = 12): Promise<DiscoveryCard[]> {
  const bounded = Math.max(1, Math.min(limit, 24));

  const [dramaRows, movieRows] = await Promise.all([
    db
      .select({
        id: dramas.id,
        title: dramas.title,
        description: dramas.description,
        poster: dramas.poster,
        banner: dramas.banner,
        slug: dramas.slug,
        status: dramas.status,
        hasPlayableEpisode: sql<boolean>`${playableEpisodeExists()}`,
        publishedAt: dramas.published_at,
      })
      .from(dramas)
      .where(publicDramaAvailability())
      .orderBy(desc(dramas.published_at), asc(dramas.title), asc(dramas.id))
      .limit(bounded),
    db
      .select({
        id: movies.id,
        title: movies.title,
        description: movies.description,
        poster: movies.poster,
        banner: movies.banner,
        slug: movies.slug,
        hasPlayableEpisode: sql<boolean>`true`,
        publishedAt: movies.published_at,
      })
      .from(movies)
      .where(publicMovieAvailability())
      .orderBy(desc(movies.published_at), asc(movies.title), asc(movies.id))
      .limit(bounded),
  ]);

  return mergeDiscoveryCards(dramaRows, movieRows).slice(0, bounded);
}

/**
 * The hero item the administrator selected, when it is still available.
 *
 * `null` means the selection is missing or the selected item is no longer
 * public; the caller then uses the automatic fallback.
 */
export async function getPublicFeaturedContent(
  type: DiscoveryContentType,
  id: string
): Promise<DiscoveryCard | null> {
  if (type === 'movie') {
    const [row] = await db
      .select({
        id: movies.id,
        title: movies.title,
        description: movies.description,
        poster: movies.poster,
        banner: movies.banner,
        slug: movies.slug,
        hasPlayableEpisode: sql<boolean>`true`,
        publishedAt: movies.published_at,
      })
      .from(movies)
      .where(and(eq(movies.id, id), publicMovieAvailability()))
      .limit(1);

    if (!row) {
      return null;
    }

    return {
      type: 'movie',
      id: row.id,
      title: row.title,
      description: row.description,
      poster: row.poster,
      banner: row.banner,
      href: publicMovieHref(row.id, row.slug),
      status: null,
      comingSoon: false,
      publishedAt: row.publishedAt?.toISOString() ?? null,
    };
  }

  const [row] = await db
    .select({
      id: dramas.id,
      title: dramas.title,
      description: dramas.description,
      poster: dramas.poster,
      banner: dramas.banner,
      slug: dramas.slug,
      status: dramas.status,
      hasPlayableEpisode: sql<boolean>`${playableEpisodeExists()}`,
      publishedAt: dramas.published_at,
    })
    .from(dramas)
    .where(and(eq(dramas.id, id), publicDramaAvailability()))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    type: 'drama',
    id: row.id,
    title: row.title,
    description: row.description,
    poster: row.poster,
    banner: row.banner,
    href: publicDramaHref(row.id, row.slug),
    status: dramaStatus(row.status),
    comingSoon: !row.hasPlayableEpisode,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

/**
 * The number of published dramas and movies.
 *
 * The homepage uses it to explain an empty catalogue honestly instead of
 * rendering an empty carousel.
 */
export async function countPublicContent(): Promise<{ dramas: number; movies: number }> {
  const [dramaRow, movieRow] = await Promise.all([
    db.select({ total: count() }).from(dramas).where(publicDramaAvailability()),
    db.select({ total: count() }).from(movies).where(publicMovieAvailability()),
  ]);

  return {
    dramas: Number(dramaRow[0]?.total ?? 0),
    movies: Number(movieRow[0]?.total ?? 0),
  };
}

/**
 * The ids of the published dramas that have a playable episode.
 *
 * Used by the reporting read models to keep their joins aligned with the
 * public availability rule.
 */
export async function listPublishedDramaIds(limit = 500): Promise<string[]> {
  const bounded = Math.max(1, Math.min(limit, 5000));

  const rows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(publicDramaAvailability())
    .orderBy(asc(dramas.id))
    .limit(bounded);

  return rows.map(row => row.id);
}

/**
 * The ids of the published movies that carry a source.
 */
export async function listPublishedMovieIds(limit = 500): Promise<string[]> {
  const bounded = Math.max(1, Math.min(limit, 5000));

  const rows = await db
    .select({ id: movies.id })
    .from(movies)
    .where(publicMovieAvailability())
    .orderBy(asc(movies.id))
    .limit(bounded);

  return rows.map(row => row.id);
}

/**
 * The published content of a set of categories.
 *
 * Used by the category browse page, where several categories may be selected
 * at once.
 */
export async function listContentByCategorySlugs(
  categorySlugs: readonly string[],
  limit = 48
): Promise<DiscoveryCard[]> {
  const slugs = categorySlugs.map(slug => slug.trim()).filter(slug => slug.length > 0);

  if (slugs.length === 0) {
    return [];
  }

  const bounded = Math.max(1, Math.min(limit, 200));

  const categoryRows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(inArray(categories.slug, slugs), isNull(categories.deleted_at)));

  if (categoryRows.length === 0) {
    return [];
  }

  const categoryIds = categoryRows.map(row => row.id);

  const [dramaRows, movieRows] = await Promise.all([
    db
      .select({
        id: dramas.id,
        title: dramas.title,
        description: dramas.description,
        poster: dramas.poster,
        banner: dramas.banner,
        slug: dramas.slug,
        status: dramas.status,
        hasPlayableEpisode: sql<boolean>`${playableEpisodeExists()}`,
        publishedAt: dramas.published_at,
      })
      .from(dramas)
      .innerJoin(dramaCategories, eq(dramaCategories.drama_id, dramas.id))
      .where(and(publicDramaAvailability(), inArray(dramaCategories.category_id, categoryIds)))
      .orderBy(desc(dramas.published_at), asc(dramas.title), asc(dramas.id))
      .limit(bounded),
    db
      .select({
        id: movies.id,
        title: movies.title,
        description: movies.description,
        poster: movies.poster,
        banner: movies.banner,
        slug: movies.slug,
        hasPlayableEpisode: sql<boolean>`true`,
        publishedAt: movies.published_at,
      })
      .from(movies)
      .innerJoin(movieCategories, eq(movieCategories.movie_id, movies.id))
      .where(and(publicMovieAvailability(), inArray(movieCategories.category_id, categoryIds)))
      .orderBy(desc(movies.published_at), asc(movies.title), asc(movies.id))
      .limit(bounded),
  ]);

  return mergeDiscoveryCards(dramaRows, movieRows).slice(0, bounded);
}
