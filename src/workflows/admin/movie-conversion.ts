import 'server-only';

import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import { ConflictError, NotFoundError, ValidationError } from '@/platform/errors';

import {
  categories,
  content_assets as contentAssets,
  content_seo as contentSeo,
  content_slug_history as contentSlugHistory,
  drama_categories as dramaCategories,
  drama_platforms as dramaPlatforms,
  dramas,
  episodes,
  movie_categories as movieCategories,
  movie_platforms as moviePlatforms,
  movies,
  platforms,
  seasons,
} from '@/modules/content/schema';
import {
  buildMovieConversionPlan,
  computeMovieConversionFingerprint,
  episodeCountConflictMessage,
  resolveMoviePublicationStatus,
  type MovieConversionApplyResult,
  type MovieConversionAssociation,
  type MovieConversionPlan,
  type MovieConversionRelationshipCounts,
  type MovieConversionState,
} from '@/modules/content/movie-conversion';
import { parseMovieConversionRequest, parseOrThrow } from '@/modules/content/validation';
import {
  countContentReferences as countAnalyticsReferences,
  moveContentReferences as moveAnalyticsReferences,
} from '@/modules/analytics/content-ownership';
import {
  countContentReferences as countNotificationReferences,
  moveContentReferences as moveNotificationReferences,
} from '@/modules/notifications/content-ownership';
import {
  countContentReferences as countReviewReferences,
  moveContentReferences as moveReviewReferences,
} from '@/modules/reviews/content-ownership';
import {
  countContentReferences as countUserReferences,
  moveContentReferences as moveUserReferences,
} from '@/modules/users/content-ownership';

/**
 * Drama → standalone movie conversion.
 *
 * Preview and apply share the same domain plan and fingerprint. Apply runs in a
 * serializable transaction, locks the drama and its episodes, revalidates every
 * eligibility rule, and moves related records through their owning module
 * services. Nothing is written until all checks pass.
 */

/** Permission key for drama administration. */
const MANAGE_PERMISSION = 'drama.manage';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = Tx | typeof db;

type DramaRow = typeof dramas.$inferSelect;
type EpisodeRow = typeof episodes.$inferSelect;

export type MovieConversionSlugConflict = {
  movieId: string;
  title: string;
  slug: string;
};

export type MovieConversionExistingMovie = {
  id: string;
  title: string;
  slug: string;
};

export type MovieConversionEpisodeSummary = {
  id: string;
  title: string;
  episodeNumber: number | null;
  position: number | null;
  seasonId: string | null;
  videoSource: string | null;
};

/** Everything the admin page needs to explain eligibility before previewing. */
export type MovieConversionContext = {
  drama: {
    id: string;
    title: string;
    slug: string;
    description: string | null;
    poster: string | null;
    banner: string | null;
    publicationStatus: string | null;
    createdAt: string;
    structureType: string;
  };
  activeEpisodes: MovieConversionEpisodeSummary[];
  eligible: boolean;
  ineligibilityReason: string | null;
  slugConflict: MovieConversionSlugConflict | null;
  existingMovie: MovieConversionExistingMovie | null;
};

// ----- read helpers ---------------------------------------------------------

async function readDrama(dramaId: string): Promise<DramaRow> {
  const [row] = await db
    .select()
    .from(dramas)
    .where(and(eq(dramas.id, dramaId), isNull(dramas.deleted_at)));

  if (!row) {
    throw new NotFoundError('Drama not found.');
  }

  return row;
}

async function readActiveEpisodeRows(dramaId: string): Promise<EpisodeRow[]> {
  return db
    .select()
    .from(episodes)
    .where(and(eq(episodes.drama_id, dramaId), isNull(episodes.deleted_at)))
    .orderBy(asc(episodes.position), asc(episodes.episode_number), asc(episodes.created_at));
}

async function readAssociations(
  dramaId: string
): Promise<{ categories: MovieConversionAssociation[]; platforms: MovieConversionAssociation[] }> {
  const [categoryRows, platformRows] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name })
      .from(dramaCategories)
      .innerJoin(categories, eq(dramaCategories.category_id, categories.id))
      .where(eq(dramaCategories.drama_id, dramaId)),
    db
      .select({ id: platforms.id, name: platforms.name })
      .from(dramaPlatforms)
      .innerJoin(platforms, eq(dramaPlatforms.platform_id, platforms.id))
      .where(eq(dramaPlatforms.drama_id, dramaId)),
  ]);

  return { categories: categoryRows, platforms: platformRows };
}

async function readSlugConflict(
  slug: string
): Promise<MovieConversionSlugConflict | null> {
  const [row] = await db
    .select({ movieId: movies.id, title: movies.title, slug: movies.slug })
    .from(movies)
    .where(and(eq(movies.slug, slug), isNull(movies.deleted_at)));

  return row ?? null;
}

async function readExistingMovie(dramaId: string): Promise<MovieConversionExistingMovie | null> {
  const [row] = await db
    .select({ id: movies.id, title: movies.title, slug: movies.slug })
    .from(movies)
    .where(eq(movies.converted_from_drama_id, dramaId));

  return row ?? null;
}

async function countContentMetadata(
  tx: DbOrTx,
  dramaId: string
): Promise<{ slugHistory: number; seo: number; assets: number }> {
  const [[slugRow], [seoRow], [assetRow]] = await Promise.all([
    tx
      .select({ total: count() })
      .from(contentSlugHistory)
      .where(
        and(
          eq(contentSlugHistory.content_type, 'drama'),
          eq(contentSlugHistory.content_id, dramaId)
        )
      ),
    tx
      .select({ total: count() })
      .from(contentSeo)
      .where(and(eq(contentSeo.content_type, 'drama'), eq(contentSeo.content_id, dramaId))),
    tx
      .select({ total: count() })
      .from(contentAssets)
      .where(and(eq(contentAssets.content_type, 'drama'), eq(contentAssets.content_id, dramaId))),
  ]);

  return {
    slugHistory: Number(slugRow?.total ?? 0),
    seo: Number(seoRow?.total ?? 0),
    assets: Number(assetRow?.total ?? 0),
  };
}

async function collectRelationshipCounts(
  tx: DbOrTx,
  dramaId: string,
  associations: { categories: unknown[]; platforms: unknown[] }
): Promise<MovieConversionRelationshipCounts> {
  const [users, reviews, notifications, analytics, metadata] = await Promise.all([
    countUserReferences(tx, 'drama', dramaId),
    countReviewReferences(tx, dramaId),
    countNotificationReferences(tx, dramaId),
    countAnalyticsReferences(tx, dramaId),
    countContentMetadata(tx, dramaId),
  ]);

  return {
    ratings: reviews.ratings,
    reviews: reviews.reviews,
    bookmarks: users.bookmarks,
    playbackProgress: users.playbackProgress,
    watchedState: users.watchedState,
    watchHistory: users.watchHistory,
    categories: associations.categories.length,
    platforms: associations.platforms.length,
    slugHistory: metadata.slugHistory,
    seo: metadata.seo,
    assets: metadata.assets,
    notifications: notifications.notifications,
    adminNotifications: notifications.adminNotifications,
    analyticsEvents:
      analytics.contentViewEvents +
      analytics.playbackEvents +
      analytics.dailyAggregates,
  };
}

function toState(
  drama: DramaRow,
  episode: EpisodeRow,
  associations: { categories: MovieConversionAssociation[]; platforms: MovieConversionAssociation[] }
): MovieConversionState {
  return {
    dramaId: drama.id,
    title: drama.title,
    slug: drama.slug,
    description: drama.description,
    poster: drama.poster,
    banner: drama.banner,
    publicationStatus: drama.publication_status,
    episode: {
      id: episode.id,
      title: episode.title,
      episodeNumber: episode.episode_number,
      position: episode.position,
      seasonId: episode.season_id,
      videoSource: episode.video_source,
    },
    categories: associations.categories,
    platforms: associations.platforms,
  };
}

// ----- context for the admin page ------------------------------------------

/**
 * Load the page context without applying anything. Ineligible dramas are
 * returned with a reason instead of throwing, so the page can explain why the
 * conversion is unavailable.
 */
export async function loadMovieConversionContext(
  actor: ActorContext,
  dramaId: string
): Promise<MovieConversionContext> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedId = parseOrThrow(z.uuid(), dramaId);
  const drama = await readDrama(parsedId);
  const [episodeRows, slugConflict, existingMovie] = await Promise.all([
    readActiveEpisodeRows(drama.id),
    readSlugConflict(drama.slug),
    readExistingMovie(drama.id),
  ]);

  let ineligibilityReason: string | null = null;

  if (existingMovie) {
    ineligibilityReason = `This drama was already converted to the movie "${existingMovie.title}".`;
  } else if (episodeRows.length !== 1) {
    ineligibilityReason = episodeCountConflictMessage(episodeRows.length);
  } else if (slugConflict) {
    ineligibilityReason = `The slug "${drama.slug}" is already used by the movie "${slugConflict.title}". Resolve the slug conflict before converting.`;
  }

  return {
    drama: {
      id: drama.id,
      title: drama.title,
      slug: drama.slug,
      description: drama.description,
      poster: drama.poster,
      banner: drama.banner,
      publicationStatus: drama.publication_status,
      createdAt: drama.created_at.toISOString(),
      structureType: drama.structure_type,
    },
    activeEpisodes: episodeRows.map(episode => ({
      id: episode.id,
      title: episode.title,
      episodeNumber: episode.episode_number,
      position: episode.position,
      seasonId: episode.season_id,
      videoSource: episode.video_source,
    })),
    eligible: ineligibilityReason === null,
    ineligibilityReason,
    slugConflict,
    existingMovie,
  };
}

// ----- preview --------------------------------------------------------------

async function buildPlanForDrama(drama: DramaRow): Promise<MovieConversionPlan> {
  const [episodeRows, associations] = await Promise.all([
    readActiveEpisodeRows(drama.id),
    readAssociations(drama.id),
  ]);

  if (episodeRows.length !== 1) {
    throw new ConflictError(episodeCountConflictMessage(episodeRows.length));
  }

  const existingMovie = await readExistingMovie(drama.id);

  if (existingMovie) {
    throw new ConflictError(
      `This drama was already converted to the movie "${existingMovie.title}".`
    );
  }

  const slugConflict = await readSlugConflict(drama.slug);

  if (slugConflict) {
    throw new ConflictError(
      `The slug "${drama.slug}" is already used by the movie "${slugConflict.title}". Resolve the slug conflict before converting.`
    );
  }

  const episode = episodeRows[0];

  if (!episode) {
    throw new ConflictError(episodeCountConflictMessage(0));
  }

  const state = toState(drama, episode, associations);
  const relationships = await collectRelationshipCounts(db, drama.id, associations);

  return buildMovieConversionPlan(state, relationships);
}

/** Preview the conversion without writing anything. */
export async function previewMovieConversion(
  actor: ActorContext,
  input: unknown
): Promise<MovieConversionPlan> {
  requirePermission(actor, MANAGE_PERMISSION);

  const request = parseMovieConversionRequest(input);

  if (request.mode !== 'preview') {
    throw new ValidationError('Preview requires mode "preview".');
  }

  const drama = await readDrama(request.dramaId);
  return buildPlanForDrama(drama);
}

// ----- apply ----------------------------------------------------------------

function postgresCode(error: unknown): string | null {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === 'object' && current !== null && 'code' in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string') {
        return code;
      }
    }

    current =
      typeof current === 'object' && current !== null
        ? (current as { cause?: unknown }).cause
        : undefined;
  }

  return null;
}

function postgresConstraint(error: unknown): string | null {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === 'object' && current !== null && 'constraint' in current) {
      const constraint = (current as { constraint?: unknown }).constraint;
      if (typeof constraint === 'string') {
        return constraint;
      }
    }

    current =
      typeof current === 'object' && current !== null
        ? (current as { cause?: unknown }).cause
        : undefined;
  }

  return null;
}

function slugConflictError(slug: string, title: string | null): ConflictError {
  return new ConflictError(
    title
      ? `The slug "${slug}" is already used by the movie "${title}". Resolve the slug conflict before converting.`
      : `The slug "${slug}" is already used by another movie. Resolve the slug conflict before converting.`
  );
}

function alreadyConvertedError(): ConflictError {
  return new ConflictError('This drama was already converted to a movie.');
}

function concurrentChangeError(): ConflictError {
  return new ConflictError(
    'The drama changed while the conversion was being applied. Request a new preview.'
  );
}

async function readLockedDrama(tx: Tx, dramaId: string): Promise<DramaRow> {
  const [row] = await tx.select().from(dramas).where(eq(dramas.id, dramaId)).for('update');

  if (!row) {
    throw new NotFoundError('Drama not found.');
  }

  return row;
}

async function readLockedEpisodes(tx: Tx, dramaId: string): Promise<EpisodeRow[]> {
  return tx
    .select()
    .from(episodes)
    .where(and(eq(episodes.drama_id, dramaId), isNull(episodes.deleted_at)))
    .orderBy(asc(episodes.position), asc(episodes.episode_number), asc(episodes.created_at))
    .for('update');
}

async function readLockedAssociations(
  tx: Tx,
  dramaId: string
): Promise<{ categories: MovieConversionAssociation[]; platforms: MovieConversionAssociation[] }> {
  const [categoryRows, platformRows] = await Promise.all([
    tx
      .select({ id: categories.id, name: categories.name })
      .from(dramaCategories)
      .innerJoin(categories, eq(dramaCategories.category_id, categories.id))
      .where(eq(dramaCategories.drama_id, dramaId)),
    tx
      .select({ id: platforms.id, name: platforms.name })
      .from(dramaPlatforms)
      .innerJoin(platforms, eq(dramaPlatforms.platform_id, platforms.id))
      .where(eq(dramaPlatforms.drama_id, dramaId)),
  ]);

  return { categories: categoryRows, platforms: platformRows };
}

async function moveContentMetadata(
  tx: Tx,
  dramaId: string,
  movieId: string
): Promise<void> {
  await tx
    .update(contentSlugHistory)
    .set({ content_type: 'movie', content_id: movieId })
    .where(
      and(
        eq(contentSlugHistory.content_type, 'drama'),
        eq(contentSlugHistory.content_id, dramaId)
      )
    );

  await tx
    .update(contentSeo)
    .set({ content_type: 'movie', content_id: movieId })
    .where(and(eq(contentSeo.content_type, 'drama'), eq(contentSeo.content_id, dramaId)));

  await tx
    .update(contentAssets)
    .set({ content_type: 'movie', content_id: movieId })
    .where(and(eq(contentAssets.content_type, 'drama'), eq(contentAssets.content_id, dramaId)));
}

/**
 * Apply a confirmed drama → movie conversion.
 *
 * Everything happens in one serializable transaction after the drama row is
 * locked. The fingerprint is verified against the locked state before any
 * write, so a preview computed against an edited drama is rejected.
 */
export async function applyMovieConversion(
  actor: ActorContext,
  input: unknown
): Promise<MovieConversionApplyResult> {
  requirePermission(actor, MANAGE_PERMISSION);

  const request = parseMovieConversionRequest(input);

  if (request.mode !== 'apply') {
    throw new ValidationError('Apply requires mode "apply".');
  }

  if (request.fingerprint === undefined) {
    throw new ValidationError('A preview fingerprint is required to apply a conversion.', {
      fingerprint: ['A preview fingerprint is required to apply a conversion.'],
    });
  }

  let attemptedSlug: string | null = null;

  try {
    return await db.transaction(
      async tx => {
        const drama = await readLockedDrama(tx, request.dramaId);
        attemptedSlug = drama.slug;

        if (drama.deleted_at !== null) {
          throw alreadyConvertedError();
        }

        const episodeRows = await readLockedEpisodes(tx, drama.id);

        if (episodeRows.length !== 1) {
          throw new ConflictError(episodeCountConflictMessage(episodeRows.length));
        }

        const [existingMovie] = await tx
          .select({ id: movies.id, title: movies.title })
          .from(movies)
          .where(eq(movies.converted_from_drama_id, drama.id));

        if (existingMovie) {
          throw alreadyConvertedError();
        }

        const [slugConflict] = await tx
          .select({ id: movies.id, title: movies.title })
          .from(movies)
          .where(and(eq(movies.slug, drama.slug), isNull(movies.deleted_at)));

        if (slugConflict) {
          throw slugConflictError(drama.slug, slugConflict.title);
        }

        const associations = await readLockedAssociations(tx, drama.id);
        const episode = episodeRows[0];

        if (!episode) {
          throw new ConflictError(episodeCountConflictMessage(0));
        }

        const state = toState(drama, episode, associations);
        const relationships = await collectRelationshipCounts(tx, drama.id, associations);
        const plan = buildMovieConversionPlan(state, relationships);

        if (request.fingerprint !== computeMovieConversionFingerprint(state)) {
          throw new ConflictError(
            'The drama changed after the preview. Request a new preview.'
          );
        }

        const publication = resolveMoviePublicationStatus(drama.publication_status);
        const now = new Date();

        const [movie] = await tx
          .insert(movies)
          .values({
            title: drama.title,
            slug: drama.slug,
            description: drama.description,
            poster: drama.poster,
            banner: drama.banner,
            publication_status: publication.status,
            video_source: episode.video_source,
            converted_from_drama_id: drama.id,
            created_at: drama.created_at,
            updated_at: now,
          })
          .returning({ id: movies.id });

        if (!movie) {
          throw new Error('Movie insert returned no row.');
        }

        const categoryIds = associations.categories.map(category => category.id);
        const platformIds = associations.platforms.map(platform => platform.id);

        if (categoryIds.length > 0) {
          await tx.insert(movieCategories).values(
            categoryIds.map(categoryId => ({
              movie_id: movie.id,
              category_id: categoryId,
            }))
          );
        }

        if (platformIds.length > 0) {
          await tx.insert(moviePlatforms).values(
            platformIds.map(platformId => ({
              movie_id: movie.id,
              platform_id: platformId,
            }))
          );
        }

        await tx.delete(dramaCategories).where(eq(dramaCategories.drama_id, drama.id));
        await tx.delete(dramaPlatforms).where(eq(dramaPlatforms.drama_id, drama.id));

        await moveReviewReferences(tx, drama.id, movie.id);
        await moveUserReferences(tx, { type: 'drama', id: drama.id }, { type: 'movie', id: movie.id });
        await moveNotificationReferences(tx, drama.id, movie.id);
        await moveAnalyticsReferences(tx, drama.id, movie.id);
        await moveContentMetadata(tx, drama.id, movie.id);

        await tx
          .update(episodes)
          .set({ deleted_at: now, updated_at: now })
          .where(and(eq(episodes.drama_id, drama.id), isNull(episodes.deleted_at)));

        await tx
          .update(seasons)
          .set({ deleted_at: now, updated_at: now })
          .where(and(eq(seasons.drama_id, drama.id), isNull(seasons.deleted_at)));

        const [trashedDrama] = await tx
          .update(dramas)
          .set({ deleted_at: now, updated_at: now })
          .where(and(eq(dramas.id, drama.id), isNull(dramas.deleted_at)))
          .returning({ id: dramas.id });

        if (!trashedDrama) {
          throw concurrentChangeError();
        }

        return { ...plan, applied: true as const, movieId: movie.id };
      },
      { isolationLevel: 'serializable' }
    );
  } catch (error) {
    const code = postgresCode(error);

    if (code === '23505') {
      const constraint = postgresConstraint(error);

      if (constraint === 'uq_movies_slug_active') {
        throw slugConflictError(attemptedSlug ?? '', null);
      }

      if (constraint === 'uq_movies_converted_from_drama_id') {
        throw alreadyConvertedError();
      }

      throw concurrentChangeError();
    }

    if (code === '40001') {
      throw concurrentChangeError();
    }

    throw error;
  }
}
