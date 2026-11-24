import 'server-only';

import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { serverConfig } from '@/platform/config';

import { notHiddenWhileEmpty, playableEpisodeExists } from './public-dramas';
import {
  evaluatePublicDramaDiscovery,
  publicDramaHref,
  toPublicDramaSummary,
  type PublicDramaRow,
  type PublicDramaSummary,
} from './public-dramas.shared';
import { listPublicDramaEpisodes } from './public-episodes';
import type { PublicEpisodeSummary } from './public-episodes.shared';
import { publicEpisodeHref } from './public-episodes.shared';
import {
  isPubliclyPlayableMovie,
  publicMovieHref,
  publicMovieWatchHref,
} from './public-movies.shared';
import { evaluatePublicAvailability, normalizePublicationStatus } from './publication';

import {
  categories,
  drama_categories as dramaCategories,
  drama_platforms as dramaPlatforms,
  dramas,
  episodes,
  movie_categories as movieCategories,
  movie_platforms as moviePlatforms,
  movies,
  platforms,
  seasons,
  similar_dramas as similarDramas,
} from './schema';

/**
 * Public detail-page composition.
 *
 * The page needs the item's own metadata, its taxonomy, its playable episode
 * hierarchy, and its recommendations. The availability decision is never
 * re-implemented here: the drama uses `evaluatePublicDramaDiscovery` and the
 * episode list comes from the single public episode service, so a guessed URL
 * cannot reach an unpublished or trashed item.
 */

export type PublicTaxonomyRef = {
  id: string;
  name: string;
  slug: string;
};

export type PublicSeasonGroup = {
  id: string;
  title: string;
  position: number | null;
  episodes: PublicEpisodeSummary[];
};

export type PublicDramaDetail = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  poster: string | null;
  banner: string | null;
  status: 'ongoing' | 'completed' | null;
  comingSoon: boolean;
  href: string;
  structureType: 'flat' | 'season_based';
  categories: PublicTaxonomyRef[];
  platforms: PublicTaxonomyRef[];
  episodes: PublicEpisodeSummary[];
  seasons: PublicSeasonGroup[];
  flatEpisodes: PublicEpisodeSummary[];
  similarDramas: PublicDramaSummary[];
};

export type PublicMovieDetail = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  poster: string | null;
  banner: string | null;
  href: string;
  /** The canonical watch route; a reachable movie always has one. */
  watchHref: string;
  categories: PublicTaxonomyRef[];
  platforms: PublicTaxonomyRef[];
};

async function listDramaCategories(dramaId: string): Promise<PublicTaxonomyRef[]> {
  return db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(dramaCategories)
    .innerJoin(categories, eq(categories.id, dramaCategories.category_id))
    .where(
      and(
        eq(dramaCategories.drama_id, dramaId),
        isNull(categories.deleted_at),
        sql`${categories.visibility} is distinct from 'hidden'`
      )
    )
    .orderBy(asc(categories.position), asc(categories.name), asc(categories.id));
}

async function listDramaPlatforms(dramaId: string): Promise<PublicTaxonomyRef[]> {
  return db
    .select({ id: platforms.id, name: platforms.name, slug: platforms.slug })
    .from(dramaPlatforms)
    .innerJoin(platforms, eq(platforms.id, dramaPlatforms.platform_id))
    .where(and(eq(dramaPlatforms.drama_id, dramaId), isNull(platforms.deleted_at)))
    .orderBy(asc(platforms.position), asc(platforms.name), asc(platforms.id));
}

async function listMovieCategories(movieId: string): Promise<PublicTaxonomyRef[]> {
  return db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(movieCategories)
    .innerJoin(categories, eq(categories.id, movieCategories.category_id))
    .where(
      and(
        eq(movieCategories.movie_id, movieId),
        isNull(categories.deleted_at),
        sql`${categories.visibility} is distinct from 'hidden'`
      )
    )
    .orderBy(asc(categories.position), asc(categories.name), asc(categories.id));
}

async function listMoviePlatforms(movieId: string): Promise<PublicTaxonomyRef[]> {
  return db
    .select({ id: platforms.id, name: platforms.name, slug: platforms.slug })
    .from(moviePlatforms)
    .innerJoin(platforms, eq(platforms.id, moviePlatforms.platform_id))
    .where(and(eq(moviePlatforms.movie_id, movieId), isNull(platforms.deleted_at)))
    .orderBy(asc(platforms.position), asc(platforms.name), asc(platforms.id));
}

/**
 * Read the public recommendations of a drama.
 *
 * The same discovery predicate as the catalogue is applied, so a recommendation
 * can never reveal a draft, trashed, or hidden-until-available drama.
 */
export async function listPublicSimilarDramas(
  dramaId: string,
  limit = 6
): Promise<PublicDramaSummary[]> {
  const rows = await db
    .select({
      id: dramas.id,
      title: dramas.title,
      slug: dramas.slug,
      description: dramas.description,
      poster: dramas.poster,
      banner: dramas.banner,
      status: dramas.status,
      visibility: dramas.visibility,
      publicationStatus: dramas.publication_status,
      deleted: sql<boolean>`${dramas.deleted_at} is not null`,
      hasPlayableEpisode: sql<boolean>`${playableEpisodeExists()}`,
      createdAt: dramas.created_at,
      updatedAt: dramas.updated_at,
    })
    .from(similarDramas)
    .innerJoin(dramas, eq(dramas.id, similarDramas.similar_drama_id))
    .where(
      and(
        eq(similarDramas.drama_id, dramaId),
        isNull(dramas.deleted_at),
        eq(dramas.publication_status, 'published'),
        or(notHiddenWhileEmpty(), playableEpisodeExists())
      )
    )
    .orderBy(
      asc(similarDramas.position),
      asc(dramas.title),
      asc(dramas.id)
    )
    .limit(limit);

  return rows.map(row =>
    toPublicDramaSummary(row as PublicDramaRow, {
      emptyDramaVisibility: serverConfig.emptyDramaVisibility,
    })
  );
}

/** Read one public drama detail page, or `null` when it is not discoverable. */
export async function getPublicDramaDetail(
  dramaId: string,
  slug: string
): Promise<PublicDramaDetail | null> {
  const [row] = await db
    .select({
      id: dramas.id,
      title: dramas.title,
      slug: dramas.slug,
      description: dramas.description,
      poster: dramas.poster,
      banner: dramas.banner,
      status: dramas.status,
      publicationStatus: dramas.publication_status,
      deleted: dramas.deleted_at,
      visibility: dramas.visibility,
      structureType: dramas.structure_type,
    })
    .from(dramas)
    .where(and(eq(dramas.id, dramaId), eq(dramas.slug, slug)))
    .limit(1);

  if (!row) {
    return null;
  }

  const episodes = await listPublicDramaEpisodes(row.id);

  const discovery = evaluatePublicDramaDiscovery({
    publicationStatus: row.publicationStatus,
    deleted: row.deleted !== null,
    visibility: row.visibility,
    hasPlayableEpisode: episodes.length > 0,
    emptyDramaVisibility: serverConfig.emptyDramaVisibility,
  });

  if (!discovery.discoverable) {
    return null;
  }

  const [dramaCategoriesResult, dramaPlatformsResult, similarDramasResult] = await Promise.all([
    listDramaCategories(row.id),
    listDramaPlatforms(row.id),
    listPublicSimilarDramas(row.id),
  ]);

  const seasonMap = new Map<string, PublicSeasonGroup>();

  for (const episode of episodes) {
    if (episode.seasonId === null) {
      continue;
    }

    const existing = seasonMap.get(episode.seasonId);

    if (existing) {
      existing.episodes.push(episode);
      continue;
    }

    seasonMap.set(episode.seasonId, {
      id: episode.seasonId,
      title: episode.seasonTitle ?? 'Season',
      position: episode.seasonPosition,
      episodes: [episode],
    });
  }

  const seasons = [...seasonMap.values()].sort((a, b) => {
    const positionA = a.position ?? Number.MAX_SAFE_INTEGER;
    const positionB = b.position ?? Number.MAX_SAFE_INTEGER;
    return positionA - positionB || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    poster: row.poster,
    banner: row.banner,
    status:
      row.status === 'ongoing' || row.status === 'completed' ? row.status : null,
    comingSoon: discovery.comingSoon,
    href: publicDramaHref(row.id, row.slug),
    structureType: row.structureType === 'flat' ? 'flat' : 'season_based',
    categories: dramaCategoriesResult,
    platforms: dramaPlatformsResult,
    episodes,
    seasons,
    flatEpisodes: row.structureType === 'flat' ? episodes : [],
    similarDramas: similarDramasResult,
  };
}

/** Read one public standalone-movie detail page, or `null` when it is unavailable. */
export async function getPublicMovieDetail(
  movieId: string,
  slug: string
): Promise<PublicMovieDetail | null> {
  const [row] = await db
    .select({
      id: movies.id,
      title: movies.title,
      slug: movies.slug,
      description: movies.description,
      poster: movies.poster,
      banner: movies.banner,
      publicationStatus: movies.publication_status,
      deleted: movies.deleted_at,
      videoSource: movies.video_source,
    })
    .from(movies)
    .where(and(eq(movies.id, movieId), eq(movies.slug, slug)))
    .limit(1);

  if (!row) {
    return null;
  }

  const hasSource = typeof row.videoSource === 'string' && row.videoSource.trim().length > 0;

  // The detail page, the watch route, and the bookmark write all answer the
  // same question — may the public watch this movie right now? — and they all
  // use the same rule. A published movie without a source is not reachable
  // through any of them, so the page does not show a "Coming soon" state that
  // leads nowhere.
  const playable = isPubliclyPlayableMovie({
    publicationStatus: row.publicationStatus,
    deleted: row.deleted !== null,
    hasSource,
  });

  if (!playable) {
    return null;
  }

  const [movieCategoriesResult, moviePlatformsResult] = await Promise.all([
    listMovieCategories(row.id),
    listMoviePlatforms(row.id),
  ]);

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    poster: row.poster,
    banner: row.banner,
    href: publicMovieHref(row.id, row.slug),
    watchHref: publicMovieWatchHref(row.id, row.slug),
    categories: movieCategoriesResult,
    platforms: moviePlatformsResult,
  };
}

/** A content item a signed-in viewer is allowed to bookmark. */
export type BookmarkableContentTarget = {
  type: 'drama' | 'movie';
  id: string;
};

/**
 * Validate a bookmark target against the public availability rules.
 *
 * Bookmarking an unavailable item would create a personal record that can
 * never be opened, so the same rules the detail page applies are applied here.
 */
export async function getBookmarkableContentTarget(
  type: 'drama' | 'movie',
  id: string
): Promise<BookmarkableContentTarget | null> {
  if (type === 'movie') {
    const [row] = await db
      .select({
        publicationStatus: movies.publication_status,
        deleted: movies.deleted_at,
        videoSource: movies.video_source,
      })
      .from(movies)
      .where(eq(movies.id, id))
      .limit(1);

    if (!row) {
      return null;
    }

    const hasSource = typeof row.videoSource === 'string' && row.videoSource.trim().length > 0;

    return isPubliclyPlayableMovie({
      publicationStatus: row.publicationStatus,
      deleted: row.deleted !== null,
      hasSource,
    })
      ? { type, id }
      : null;
  }

  const [row] = await db
    .select({
      publicationStatus: dramas.publication_status,
      deleted: dramas.deleted_at,
      visibility: dramas.visibility,
    })
    .from(dramas)
    .where(eq(dramas.id, id))
    .limit(1);

  if (!row) {
    return null;
  }

  const episodes = await listPublicDramaEpisodes(id);

  const discovery = evaluatePublicDramaDiscovery({
    publicationStatus: row.publicationStatus,
    deleted: row.deleted !== null,
    visibility: row.visibility,
    hasPlayableEpisode: episodes.length > 0,
    emptyDramaVisibility: serverConfig.emptyDramaVisibility,
  });

  return discovery.discoverable ? { type, id } : null;
}

/** A content item that is publicly available. */
export type PublicContentTarget = {
  type: 'drama' | 'movie';
  id: string;
  /** The title, so a caller can name the item in a message or an audit record. */
  title: string;
};

/**
 * Validate that a content item is publicly available.
 *
 * The rule is deliberately narrower than the bookmark rule: a rating, a
 * review, or a report may describe a published item that is not playable yet
 * (a wrong description, a missing episode), so only the item's own publication
 * state and its Trash state are required. The decision still comes from
 * `evaluatePublicAvailability` rather than a single-column comparison.
 */
export async function getPublicContentTarget(
  type: 'drama' | 'movie',
  id: string
): Promise<PublicContentTarget | null> {
  const row =
    type === 'movie'
      ? (
          await db
            .select({
              title: movies.title,
              publicationStatus: movies.publication_status,
              deleted: movies.deleted_at,
            })
            .from(movies)
            .where(eq(movies.id, id))
            .limit(1)
        )[0]
      : (
          await db
            .select({
              title: dramas.title,
              publicationStatus: dramas.publication_status,
              deleted: dramas.deleted_at,
            })
            .from(dramas)
            .where(eq(dramas.id, id))
            .limit(1)
        )[0];

  if (!row) {
    return null;
  }

  const availability = evaluatePublicAvailability({
    contentType: type,
    publicationStatus: normalizePublicationStatus(row.publicationStatus),
    deleted: row.deleted !== null,
  });

  return availability.publiclyAvailable ? { type, id, title: row.title } : null;
}

/** A content item a signed-in viewer is allowed to report. */
export type ReportableContentTarget = PublicContentTarget;

/**
 * Validate a report target against the public availability rules.
 */
export async function getReportableContentTarget(
  type: 'drama' | 'movie',
  id: string
): Promise<ReportableContentTarget | null> {
  return getPublicContentTarget(type, id);
}

/** The public card data of one discoverable content item. */
export type PublicContentCard = {
  type: 'drama' | 'movie';
  id: string;
  title: string;
  poster: string | null;
  href: string;
};

/** The public card data of one publicly playable episode. */
export type PublicEpisodeTarget = {
  dramaId: string;
  dramaSlug: string;
  episodeId: string;
  title: string;
  href: string;
};

/**
 * Resolve a batch of episodes to their public watch route.
 *
 * Only episodes that are publicly playable appear in the result, so a resume
 * link never points at an episode a viewer cannot open. Season-based dramas
 * require a published, non-deleted season; flat dramas do not.
 */
export async function listPublicEpisodeTargets(
  episodeIds: string[]
): Promise<PublicEpisodeTarget[]> {
  if (episodeIds.length === 0) {
    return [];
  }

  const rows = await db
    .select({
      episodeId: episodes.id,
      episodeTitle: episodes.title,
      dramaId: dramas.id,
      dramaSlug: dramas.slug,
      dramaStructureType: dramas.structure_type,
    })
    .from(episodes)
    .innerJoin(dramas, eq(dramas.id, episodes.drama_id))
    .leftJoin(seasons, eq(seasons.id, episodes.season_id))
    .where(
      and(
        inArray(episodes.id, episodeIds),
        eq(episodes.publication_status, 'published'),
        isNull(episodes.deleted_at),
        isNotNull(episodes.video_source),
        sql`btrim(${episodes.video_source}) <> ''`,
        eq(dramas.publication_status, 'published'),
        isNull(dramas.deleted_at),
        or(
          eq(dramas.structure_type, 'flat'),
          and(
            isNotNull(episodes.season_id),
            eq(seasons.publication_status, 'published'),
            isNull(seasons.deleted_at)
          )
        )
      )
    );

  return rows.map(row => ({
    dramaId: row.dramaId,
    dramaSlug: row.dramaSlug,
    episodeId: row.episodeId,
    title: row.episodeTitle,
    href: publicEpisodeHref(row.dramaId, row.dramaSlug, row.episodeId),
  }));
}

/**
 * Resolve a batch of content targets to their public card data.
 *
 * A viewer's personal list names many items at once, so resolving them one by
 * one would issue one query per row. The batch is read in two queries - one
 * per content type - and the availability decision still comes from
 * `evaluatePublicAvailability`, so a batch answer and a single answer can never
 * disagree. A target that is not publicly available is simply absent from the
 * result.
 */
export async function listPublicContentTargets(
  targets: ReadonlyArray<{ type: 'drama' | 'movie'; id: string }>
): Promise<PublicContentCard[]> {
  const dramaIds = targets.filter(target => target.type === 'drama').map(target => target.id);
  const movieIds = targets.filter(target => target.type === 'movie').map(target => target.id);

  const results: PublicContentCard[] = [];

  if (dramaIds.length > 0) {
    const rows = await db
      .select({
        id: dramas.id,
        title: dramas.title,
        slug: dramas.slug,
        poster: dramas.poster,
        publicationStatus: dramas.publication_status,
        deleted: dramas.deleted_at,
        visibility: dramas.visibility,
      })
      .from(dramas)
      .where(inArray(dramas.id, dramaIds));

    const playable = await listPublicDramaEpisodesForIds(dramaIds);
    const dramaIdsWithPlayableEpisode = new Set(playable);

    for (const row of rows) {
      const availability = evaluatePublicAvailability({
        contentType: 'drama',
        publicationStatus: normalizePublicationStatus(row.publicationStatus),
        deleted: row.deleted !== null,
      });

      if (!availability.publiclyAvailable) {
        continue;
      }

      const discovery = evaluatePublicDramaDiscovery({
        publicationStatus: row.publicationStatus,
        deleted: row.deleted !== null,
        visibility: row.visibility,
        hasPlayableEpisode: dramaIdsWithPlayableEpisode.has(row.id),
        emptyDramaVisibility: serverConfig.emptyDramaVisibility,
      });

      if (!discovery.discoverable) {
        continue;
      }

      results.push({
        type: 'drama',
        id: row.id,
        title: row.title,
        poster: row.poster,
        href: publicDramaHref(row.id, row.slug),
      });
    }
  }

  if (movieIds.length > 0) {
    const rows = await db
      .select({
        id: movies.id,
        title: movies.title,
        slug: movies.slug,
        poster: movies.poster,
        publicationStatus: movies.publication_status,
        deleted: movies.deleted_at,
        videoSource: movies.video_source,
      })
      .from(movies)
      .where(inArray(movies.id, movieIds));

    for (const row of rows) {
      const hasSource = typeof row.videoSource === 'string' && row.videoSource.trim().length > 0;

      if (
        !isPubliclyPlayableMovie({
          publicationStatus: row.publicationStatus,
          deleted: row.deleted !== null,
          hasSource,
        })
      ) {
        continue;
      }

      results.push({
        type: 'movie',
        id: row.id,
        title: row.title,
        poster: row.poster,
        href: publicMovieHref(row.id, row.slug),
      });
    }
  }

  return results;
}

/** Ids of the dramas in the batch that have at least one publicly playable episode. */
async function listPublicDramaEpisodesForIds(dramaIds: string[]): Promise<string[]> {
  const rows = await db
    .selectDistinct({ dramaId: episodes.drama_id })
    .from(episodes)
    .innerJoin(dramas, eq(dramas.id, episodes.drama_id))
    .leftJoin(seasons, eq(seasons.id, episodes.season_id))
    .where(
      and(
        inArray(episodes.drama_id, dramaIds),
        eq(episodes.publication_status, 'published'),
        isNull(episodes.deleted_at),
        isNotNull(episodes.video_source),
        sql`btrim(${episodes.video_source}) <> ''`,
        or(
          eq(dramas.structure_type, 'flat'),
          and(
            isNotNull(episodes.season_id),
            eq(seasons.publication_status, 'published'),
            isNull(seasons.deleted_at)
          )
        )
      )
    );

  return rows.map(row => row.dramaId);
}
