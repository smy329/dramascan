import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for drama → standalone movie conversion.
 *
 * The real PostgreSQL test database and the ordered SQL migrations are used.
 * The tests cover eligibility, the preview contract, the fingerprint guard,
 * transactional apply, provenance, relationship migration, the exactly-one
 * rating/review target, authorization, duplicate/concurrent applies, and
 * rollback.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for movie conversion integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { db } from '@/db/client';
import type { ActorContext } from '@/modules/authorization';
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
  similar_dramas as similarDramas,
} from '@/modules/content/schema';
import {
  analytics_daily_aggregates as analyticsDailyAggregates,
  content_view_events as contentViewEvents,
  playback_analytics_events as playbackAnalyticsEvents,
} from '@/modules/analytics/schema';
import { moveContentReferences } from '@/modules/analytics/content-ownership';
import {
  admin_notifications as adminNotifications,
  notifications,
} from '@/modules/notifications/schema';
import {
  ratings,
  review_reactions as reviewReactions,
  review_reports as reviewReports,
  reviews,
} from '@/modules/reviews/schema';
import {
  bookmarks,
  playback_progress as playbackProgress,
  watched_state as watchedState,
  watch_history as watchHistory,
} from '@/modules/users/schema';
import { users } from '@/modules/auth/schema';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/platform/errors';
import { closePool } from '@/platform/db/pool';
import {
  applyMovieConversion,
  loadMovieConversionContext,
  previewMovieConversion,
} from '@/workflows/admin/movie-conversion';

const SLUG_PREFIX = 'it-mconv-wf-';
const TEST_EMAIL_PREFIX = 'it-mconv-user-';
const HTTPS_SOURCE = 'https://media.example.com/episodes/seasons-of-glass.mp4';

const anonymousActor: ActorContext = {
  userId: null,
  roles: [],
  isSuperAdmin: false,
  permissions: [],
};

const readerActor: ActorContext = {
  userId: 'it-movie-conv-reader',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.read'],
};

const managerActor: ActorContext = {
  userId: 'it-movie-conv-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.manage'],
};

function testSlug(label: string): string {
  return `${SLUG_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

function newUserId(): string {
  return randomUUID();
}

/**
 * User-content rows now carry a real foreign key to `users`, so a random UUID is
 * no longer an acceptable stand-in for the tables that have one.
 */
async function insertUser(label: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      name: `Test ${label}`,
      email: `${TEST_EMAIL_PREFIX}${label}-${randomUUID().slice(0, 8)}@example.com`,
    })
    .returning({ id: users.id });

  if (!row) {
    throw new Error('Test user insert returned no row.');
  }

  return row.id;
}

async function insertDrama(
  label: string,
  overrides: Partial<typeof dramas.$inferInsert> = {}
): Promise<typeof dramas.$inferSelect> {
  const [row] = await db
    .insert(dramas)
    .values({
      title: `Test ${label}`,
      slug: testSlug(label),
      description: 'A test drama.',
      poster: 'https://media.example.com/posters/test.jpg',
      banner: 'https://media.example.com/banners/test.jpg',
      publication_status: 'published',
      structure_type: 'flat',
      ...overrides,
    })
    .returning();

  if (!row) {
    throw new Error('Drama insert returned no row.');
  }

  return row;
}

async function insertMovie(
  label: string,
  overrides: Partial<typeof movies.$inferInsert> = {}
): Promise<typeof movies.$inferSelect> {
  const [row] = await db
    .insert(movies)
    .values({ title: `Test movie ${label}`, slug: testSlug(`movie-${label}`), ...overrides })
    .returning();

  if (!row) {
    throw new Error('Movie insert returned no row.');
  }

  return row;
}

async function insertSeason(
  dramaId: string,
  overrides: Partial<typeof seasons.$inferInsert> = {}
): Promise<typeof seasons.$inferSelect> {
  const [row] = await db
    .insert(seasons)
    .values({ drama_id: dramaId, title: 'Season 1', position: 0, ...overrides })
    .returning();

  if (!row) {
    throw new Error('Season insert returned no row.');
  }

  return row;
}

async function insertEpisode(
  dramaId: string,
  overrides: Partial<typeof episodes.$inferInsert> = {}
): Promise<typeof episodes.$inferSelect> {
  const [row] = await db
    .insert(episodes)
    .values({
      drama_id: dramaId,
      title: 'The Last Winter',
      episode_number: 1,
      position: 0,
      video_source: HTTPS_SOURCE,
      ...overrides,
    })
    .returning();

  if (!row) {
    throw new Error('Episode insert returned no row.');
  }

  return row;
}

async function insertCategory(label: string): Promise<string> {
  const [row] = await db
    .insert(categories)
    .values({ name: `Test ${label}`, slug: testSlug(`cat-${label}`) })
    .returning({ id: categories.id });

  if (!row) {
    throw new Error('Category insert returned no row.');
  }

  return row.id;
}

async function insertPlatform(label: string): Promise<string> {
  const [row] = await db
    .insert(platforms)
    .values({ name: `Test ${label}`, slug: testSlug(`plat-${label}`) })
    .returning({ id: platforms.id });

  if (!row) {
    throw new Error('Platform insert returned no row.');
  }

  return row.id;
}

async function testDramaIds(): Promise<string[]> {
  const rows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${SLUG_PREFIX}%`));

  return rows.map(row => row.id);
}

async function testMovieIds(dramaIds: string[]): Promise<string[]> {
  const bySlug = await db
    .select({ id: movies.id })
    .from(movies)
    .where(like(movies.slug, `${SLUG_PREFIX}%`));

  const byProvenance =
    dramaIds.length > 0
      ? await db
          .select({ id: movies.id })
          .from(movies)
          .where(inArray(movies.converted_from_drama_id, dramaIds))
      : [];

  return [...new Set([...bySlug, ...byProvenance].map(row => row.id))];
}

async function cleanup(): Promise<void> {
  const dramaIds = await testDramaIds();
  const movieIds = await testMovieIds(dramaIds);

  if (movieIds.length > 0) {
    await db.delete(movieCategories).where(inArray(movieCategories.movie_id, movieIds));
    await db.delete(moviePlatforms).where(inArray(moviePlatforms.movie_id, movieIds));
  }

  const reviewIds =
    dramaIds.length > 0 || movieIds.length > 0
      ? (
          await db
            .select({ id: reviews.id })
            .from(reviews)
            .where(
              or(
                dramaIds.length > 0 ? inArray(reviews.drama_id, dramaIds) : sql`false`,
                movieIds.length > 0 ? inArray(reviews.movie_id, movieIds) : sql`false`
              )
            )
        ).map(row => row.id)
      : [];

  if (reviewIds.length > 0) {
    await db.delete(reviewReports).where(inArray(reviewReports.review_id, reviewIds));
    await db.delete(reviewReactions).where(inArray(reviewReactions.review_id, reviewIds));
  }

  const contentFilters: Array<ReturnType<typeof or>> = [
    dramaIds.length > 0 ? inArray(ratings.drama_id, dramaIds) : undefined,
    movieIds.length > 0 ? inArray(ratings.movie_id, movieIds) : undefined,
  ].filter((value): value is NonNullable<typeof value> => value !== undefined);

  if (contentFilters.length > 0) {
    await db.delete(ratings).where(or(...contentFilters));
    await db
      .delete(reviews)
      .where(
        or(
          dramaIds.length > 0 ? inArray(reviews.drama_id, dramaIds) : sql`false`,
          movieIds.length > 0 ? inArray(reviews.movie_id, movieIds) : sql`false`
        )
      );
  }

  const polymorphicCondition = (contentType: AnyPgColumn, contentId: AnyPgColumn) =>
    or(
      dramaIds.length > 0
        ? and(eq(contentType, 'drama'), inArray(contentId, dramaIds))
        : sql`false`,
      movieIds.length > 0 ? and(eq(contentType, 'movie'), inArray(contentId, movieIds)) : sql`false`
    );

  // A row may also carry only a typed target, so the cleanup has to look at the
  // typed columns as well as the legacy pair.
  const typedCondition = (dramaId: AnyPgColumn, movieId: AnyPgColumn) =>
    or(
      dramaIds.length > 0 ? inArray(dramaId, dramaIds) : sql`false`,
      movieIds.length > 0 ? inArray(movieId, movieIds) : sql`false`
    );

  const userContentCondition = (
    contentType: AnyPgColumn,
    contentId: AnyPgColumn,
    dramaId: AnyPgColumn,
    movieId: AnyPgColumn
  ) => or(polymorphicCondition(contentType, contentId), typedCondition(dramaId, movieId));

  await db
    .delete(bookmarks)
    .where(
      userContentCondition(
        bookmarks.content_type,
        bookmarks.content_id,
        bookmarks.drama_id,
        bookmarks.movie_id
      )
    );
  await db
    .delete(playbackProgress)
    .where(
      userContentCondition(
        playbackProgress.content_type,
        playbackProgress.content_id,
        playbackProgress.drama_id,
        playbackProgress.movie_id
      )
    );
  await db
    .delete(watchedState)
    .where(
      userContentCondition(
        watchedState.content_type,
        watchedState.content_id,
        watchedState.drama_id,
        watchedState.movie_id
      )
    );
  await db
    .delete(watchHistory)
    .where(
      userContentCondition(
        watchHistory.content_type,
        watchHistory.content_id,
        watchHistory.drama_id,
        watchHistory.movie_id
      )
    );
  await db
    .delete(notifications)
    .where(polymorphicCondition(notifications.content_type, notifications.content_id));
  await db
    .delete(adminNotifications)
    .where(polymorphicCondition(adminNotifications.content_type, adminNotifications.content_id));
  await db
    .delete(contentViewEvents)
    .where(
      userContentCondition(
        contentViewEvents.content_type,
        contentViewEvents.content_id,
        contentViewEvents.drama_id,
        contentViewEvents.movie_id
      )
    );
  await db
    .delete(playbackAnalyticsEvents)
    .where(
      userContentCondition(
        playbackAnalyticsEvents.content_type,
        playbackAnalyticsEvents.content_id,
        playbackAnalyticsEvents.drama_id,
        playbackAnalyticsEvents.movie_id
      )
    );
  await db
    .delete(analyticsDailyAggregates)
    .where(
      userContentCondition(
        analyticsDailyAggregates.content_type,
        analyticsDailyAggregates.content_id,
        analyticsDailyAggregates.drama_id,
        analyticsDailyAggregates.movie_id
      )
    );
  await db
    .delete(contentSlugHistory)
    .where(polymorphicCondition(contentSlugHistory.content_type, contentSlugHistory.content_id));
  await db
    .delete(contentSeo)
    .where(polymorphicCondition(contentSeo.content_type, contentSeo.content_id));
  await db
    .delete(contentAssets)
    .where(polymorphicCondition(contentAssets.content_type, contentAssets.content_id));

  if (dramaIds.length > 0) {
    await db
      .delete(similarDramas)
      .where(
        or(
          inArray(similarDramas.drama_id, dramaIds),
          inArray(similarDramas.similar_drama_id, dramaIds)
        )
      );
    await db.delete(episodes).where(inArray(episodes.drama_id, dramaIds));
    await db.delete(seasons).where(inArray(seasons.drama_id, dramaIds));
    await db.delete(dramaCategories).where(inArray(dramaCategories.drama_id, dramaIds));
    await db.delete(dramaPlatforms).where(inArray(dramaPlatforms.drama_id, dramaIds));
  }

  if (movieIds.length > 0) {
    await db.delete(movies).where(inArray(movies.id, movieIds));
  }

  if (dramaIds.length > 0) {
    await db.delete(dramas).where(inArray(dramas.id, dramaIds));
  }

  await db.delete(categories).where(like(categories.slug, `${SLUG_PREFIX}%`));
  await db.delete(platforms).where(like(platforms.slug, `${SLUG_PREFIX}%`));

  // Created last, after every row that references them is gone.
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
}

/**
 * Fail any update of this drama's episodes. The trigger is scoped to the drama
 * so parallel test files are unaffected. It fires after the movie insert and
 * after the relationship moves, which proves the whole transaction rolls back.
 */
async function installEpisodeUpdateFailure(dramaId: string): Promise<void> {
  await db.execute(
    sql.raw(`
    CREATE OR REPLACE FUNCTION it_fail_movie_conversion_episode_update() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'injected movie conversion failure';
    END;
    $$ LANGUAGE plpgsql;
  `)
  );

  await db.execute(
    sql.raw(`
    CREATE TRIGGER it_fail_movie_conversion_episode_update_trigger
    BEFORE UPDATE ON episodes
    FOR EACH ROW
    WHEN (OLD.drama_id = '${dramaId}'::uuid)
    EXECUTE FUNCTION it_fail_movie_conversion_episode_update();
  `)
  );
}

async function removeEpisodeUpdateFailure(): Promise<void> {
  await db.execute(
    sql.raw('DROP TRIGGER IF EXISTS it_fail_movie_conversion_episode_update_trigger ON episodes;')
  );
  await db.execute(sql.raw('DROP FUNCTION IF EXISTS it_fail_movie_conversion_episode_update();'));
}

beforeEach(async () => {
  await cleanup();
});

afterEach(async () => {
  await removeEpisodeUpdateFailure();
  await cleanup();
});

afterAll(async () => {
  await removeEpisodeUpdateFailure();
  await cleanup();
  await closePool();
});

describe('loadMovieConversionContext', () => {
  it('reports an eligible drama with its single active episode', async () => {
    const drama = await insertDrama('context-eligible');
    const season = await insertSeason(drama.id);
    const episode = await insertEpisode(drama.id, { season_id: season.id });

    const context = await loadMovieConversionContext(managerActor, drama.id);

    expect(context.eligible).toBe(true);
    expect(context.ineligibilityReason).toBeNull();
    expect(context.existingMovie).toBeNull();
    expect(context.slugConflict).toBeNull();
    expect(context.drama).toMatchObject({
      id: drama.id,
      title: drama.title,
      slug: drama.slug,
      structureType: 'flat',
    });
    expect(context.activeEpisodes).toEqual([
      {
        id: episode.id,
        title: episode.title,
        episodeNumber: 1,
        position: 0,
        seasonId: season.id,
        videoSource: HTTPS_SOURCE,
      },
    ]);
  });

  it('reports a drama without an active episode as ineligible', async () => {
    const drama = await insertDrama('context-empty');

    const context = await loadMovieConversionContext(managerActor, drama.id);

    expect(context.eligible).toBe(false);
    expect(context.ineligibilityReason).toMatch(/no active episode/i);
  });

  it('reports a multi-episode drama as ineligible', async () => {
    const drama = await insertDrama('context-two');
    await insertEpisode(drama.id);
    await insertEpisode(drama.id, { episode_number: 2, position: 1 });

    const context = await loadMovieConversionContext(managerActor, drama.id);

    expect(context.eligible).toBe(false);
    expect(context.ineligibilityReason).toContain('2 active episodes');
  });

  it('ignores soft-deleted episodes when counting active episodes', async () => {
    const drama = await insertDrama('context-trashed-episode');
    await insertEpisode(drama.id);
    await insertEpisode(drama.id, {
      episode_number: 2,
      position: 1,
      deleted_at: new Date(),
    });

    const context = await loadMovieConversionContext(managerActor, drama.id);

    expect(context.eligible).toBe(true);
    expect(context.activeEpisodes).toHaveLength(1);
  });

  it('reports an active movie slug conflict with the conflicting movie', async () => {
    const drama = await insertDrama('context-slug');
    await insertEpisode(drama.id);
    const existing = await insertMovie('slug', { slug: drama.slug, title: 'Existing Movie' });

    const context = await loadMovieConversionContext(managerActor, drama.id);

    expect(context.eligible).toBe(false);
    expect(context.ineligibilityReason).toContain(drama.slug);
    expect(context.ineligibilityReason).toContain(existing.title);
    expect(context.slugConflict).toEqual({
      movieId: existing.id,
      title: existing.title,
      slug: existing.slug,
    });
  });

  it('ignores a soft-deleted movie when checking the slug', async () => {
    const drama = await insertDrama('context-slug-trashed');
    await insertEpisode(drama.id);
    await insertMovie('slug-trashed', { slug: drama.slug, deleted_at: new Date() });

    const context = await loadMovieConversionContext(managerActor, drama.id);

    expect(context.eligible).toBe(true);
  });

  it('reports an existing converted movie, even when the drama is restored', async () => {
    const drama = await insertDrama('context-converted');
    await insertEpisode(drama.id);
    const converted = await insertMovie('converted', {
      converted_from_drama_id: drama.id,
      deleted_at: new Date(),
    });

    const context = await loadMovieConversionContext(managerActor, drama.id);

    expect(context.eligible).toBe(false);
    expect(context.ineligibilityReason).toContain(converted.title);
    expect(context.existingMovie).toEqual({
      id: converted.id,
      title: converted.title,
      slug: converted.slug,
    });
  });

  it('throws NotFoundError for a missing or soft-deleted drama', async () => {
    const drama = await insertDrama('context-missing', { deleted_at: new Date() });

    await expect(loadMovieConversionContext(managerActor, drama.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
    await expect(loadMovieConversionContext(managerActor, randomUUID())).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it('enforces drama.manage', async () => {
    const drama = await insertDrama('context-authz');
    await insertEpisode(drama.id);

    await expect(loadMovieConversionContext(anonymousActor, drama.id)).rejects.toBeInstanceOf(
      AuthenticationError
    );
    await expect(loadMovieConversionContext(readerActor, drama.id)).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });
});

describe('previewMovieConversion', () => {
  it('returns the full plan without writing anything', async () => {
    const drama = await insertDrama('preview');
    const season = await insertSeason(drama.id);
    const episode = await insertEpisode(drama.id, { season_id: season.id });
    const categoryId = await insertCategory('preview');
    const platformId = await insertPlatform('preview');
    await db.insert(dramaCategories).values({ drama_id: drama.id, category_id: categoryId });
    await db.insert(dramaPlatforms).values({ drama_id: drama.id, platform_id: platformId });
    const ratingUserId = newUserId();
    await db.insert(ratings).values({ user_id: ratingUserId, drama_id: drama.id, value: 4 });
    await db.insert(reviews).values({
      user_id: newUserId(),
      drama_id: drama.id,
      content: 'A considered review.',
    });
    await db.insert(bookmarks).values({
      user_id: await insertUser('preview-bookmark'),
      content_type: 'drama',
      content_id: drama.id,
      drama_id: drama.id,
    });
    await db.insert(watchHistory).values({
      user_id: await insertUser('preview-history'),
      content_type: 'drama',
      content_id: drama.id,
      drama_id: drama.id,
      episode_id: episode.id,
    });

    const plan = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    });

    expect(plan.dramaId).toBe(drama.id);
    expect(plan.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.source).toMatchObject({
      dramaId: drama.id,
      episodeId: episode.id,
      episodeTitle: episode.title,
      episodeNumber: 1,
      seasonId: season.id,
    });
    expect(plan.movie).toMatchObject({
      title: drama.title,
      slug: drama.slug,
      description: drama.description,
      poster: drama.poster,
      banner: drama.banner,
      publicationStatus: 'published',
      videoSource: HTTPS_SOURCE,
      convertedFromDramaId: drama.id,
    });
    expect(plan.movie.categories.map(category => category.id)).toEqual([categoryId]);
    expect(plan.movie.platforms.map(platform => platform.id)).toEqual([platformId]);
    expect(plan.relationships).toMatchObject({
      ratings: 1,
      reviews: 1,
      bookmarks: 1,
      watchHistory: 1,
      categories: 1,
      platforms: 1,
    });

    // A preview never writes: the drama is still active and no movie exists.
    const [dramaRow] = await db.select().from(dramas).where(eq(dramas.id, drama.id));
    expect(dramaRow?.deleted_at).toBeNull();
    expect(await testMovieIds([drama.id])).toHaveLength(0);
  });

  it('previews a draft movie when the published episode has no source', async () => {
    const drama = await insertDrama('preview-draft-downgrade');
    await insertEpisode(drama.id, { video_source: null });

    const plan = await previewMovieConversion(managerActor, { dramaId: drama.id, mode: 'preview' });

    expect(plan.movie.publicationStatus).toBe('draft');
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/draft/i);
  });

  it('rejects a drama without exactly one active episode', async () => {
    const empty = await insertDrama('preview-empty');
    const two = await insertDrama('preview-two');
    await insertEpisode(two.id);
    await insertEpisode(two.id, { episode_number: 2, position: 1 });

    await expect(
      previewMovieConversion(managerActor, { dramaId: empty.id, mode: 'preview' })
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      previewMovieConversion(managerActor, { dramaId: two.id, mode: 'preview' })
    ).rejects.toThrow(/exactly one episode/i);
  });

  it('rejects a slug conflict and names the conflicting slug', async () => {
    const drama = await insertDrama('preview-slug');
    await insertEpisode(drama.id);
    const existing = await insertMovie('preview-slug', {
      slug: drama.slug,
      title: 'Already Taken',
    });

    const error = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).toContain(drama.slug);
    expect((error as Error).message).toContain(existing.title);
  });

  it('rejects a drama that was already converted', async () => {
    const drama = await insertDrama('preview-converted');
    await insertEpisode(drama.id);
    await insertMovie('preview-converted', { converted_from_drama_id: drama.id });

    await expect(
      previewMovieConversion(managerActor, { dramaId: drama.id, mode: 'preview' })
    ).rejects.toThrow(/already converted/i);
  });

  it('rejects a non-preview mode and invalid payloads', async () => {
    const drama = await insertDrama('preview-invalid');
    await insertEpisode(drama.id);

    await expect(
      previewMovieConversion(managerActor, { dramaId: drama.id, mode: 'apply' })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      previewMovieConversion(managerActor, { dramaId: 'not-a-uuid', mode: 'preview' })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(previewMovieConversion(managerActor, null)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('enforces drama.manage', async () => {
    const drama = await insertDrama('preview-authz');
    await insertEpisode(drama.id);

    await expect(
      previewMovieConversion(anonymousActor, { dramaId: drama.id, mode: 'preview' })
    ).rejects.toBeInstanceOf(AuthenticationError);
    await expect(
      previewMovieConversion(readerActor, { dramaId: drama.id, mode: 'preview' })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('applyMovieConversion', () => {
  it('creates the movie, records provenance, moves relationships, and trashes the drama', async () => {
    const drama = await insertDrama('apply', { title: 'Seasons of Glass' });
    const season = await insertSeason(drama.id);
    const episode = await insertEpisode(drama.id, { season_id: season.id });

    const categoryId = await insertCategory('apply');
    const platformId = await insertPlatform('apply');
    await db.insert(dramaCategories).values({ drama_id: drama.id, category_id: categoryId });
    await db.insert(dramaPlatforms).values({ drama_id: drama.id, platform_id: platformId });

    const otherDrama = await insertDrama('apply-similar');
    await insertEpisode(otherDrama.id);
    await db.insert(similarDramas).values({
      drama_id: drama.id,
      similar_drama_id: otherDrama.id,
      position: 0,
    });

    const raterId = newUserId();
    const [rating] = await db
      .insert(ratings)
      .values({ user_id: raterId, drama_id: drama.id, value: 5 })
      .returning();
    const [deletedRating] = await db
      .insert(ratings)
      .values({
        user_id: newUserId(),
        drama_id: drama.id,
        value: 2,
        deleted_at: new Date(),
      })
      .returning();
    const [review] = await db
      .insert(reviews)
      .values({ user_id: newUserId(), drama_id: drama.id, content: 'A considered review.' })
      .returning();

    if (!rating || !deletedRating || !review) {
      throw new Error('Review fixture insert returned no row.');
    }

    await db.insert(reviewReactions).values({
      user_id: await insertUser('reaction'),
      review_id: review.id,
    });
    await db.insert(reviewReports).values({
      user_id: await insertUser('reporter'),
      review_id: review.id,
      reason: 'spoiler',
    });

    const [bookmark] = await db
      .insert(bookmarks)
      .values({
        user_id: await insertUser('bookmark'),
        content_type: 'drama',
        content_id: drama.id,
        drama_id: drama.id,
      })
      .returning();
    const [progress] = await db
      .insert(playbackProgress)
      .values({
        user_id: await insertUser('progress'),
        content_type: 'drama',
        content_id: drama.id,
        drama_id: drama.id,
        episode_id: episode.id,
        position: 42,
        duration: 1800,
      })
      .returning();
    const [watched] = await db
      .insert(watchedState)
      .values({
        user_id: await insertUser('watched'),
        content_type: 'drama',
        content_id: drama.id,
        drama_id: drama.id,
        episode_id: episode.id,
        watched_minutes: 30,
        threshold_met: true,
      })
      .returning();
    const watchedAt = new Date('2026-01-02T03:04:05.000Z');
    const [history] = await db
      .insert(watchHistory)
      .values({
        user_id: await insertUser('history'),
        content_type: 'drama',
        content_id: drama.id,
        drama_id: drama.id,
        episode_id: episode.id,
        watched_at: watchedAt,
        watch_duration: 42,
      })
      .returning();

    if (!bookmark || !progress || !watched || !history) {
      throw new Error('User fixture insert returned no row.');
    }

    await db.insert(notifications).values({
      user_id: newUserId(),
      title: 'New episode',
      content: 'Episode one is available.',
      event_type: 'new_episode',
      content_type: 'drama',
      content_id: drama.id,
    });
    await db.insert(adminNotifications).values({
      title: 'Content flagged',
      content: 'Review this drama.',
      content_type: 'drama',
      content_id: drama.id,
    });
    await db.insert(contentViewEvents).values({
      content_type: 'drama',
      content_id: drama.id,
      drama_id: drama.id,
    });
    await db.insert(playbackAnalyticsEvents).values({
      content_type: 'drama',
      content_id: drama.id,
      event_type: 'completion',
      drama_id: drama.id,
    });
    await db.insert(analyticsDailyAggregates).values({
      date: '2026-01-02',
      content_type: 'drama',
      content_id: drama.id,
      drama_id: drama.id,
      total_views: 3,
    });
    await db.insert(contentSlugHistory).values({
      content_type: 'drama',
      content_id: drama.id,
      old_slug: 'old-seasons-of-glass',
      new_slug: drama.slug,
    });
    await db.insert(contentSeo).values({
      content_type: 'drama',
      content_id: drama.id,
      seo_title: 'Seasons of Glass',
    });
    await db.insert(contentAssets).values({
      content_type: 'drama',
      content_id: drama.id,
      asset_type: 'poster',
      file_path: '/assets/seasons-of-glass.jpg',
    });

    const plan = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    });

    const result = await applyMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      fingerprint: plan.fingerprint,
    });

    expect(result.applied).toBe(true);
    expect(result.movieId).not.toBe(drama.id);
    expect(result.movie.convertedFromDramaId).toBe(drama.id);
    expect(result.relationships).toMatchObject({
      ratings: 2,
      reviews: 1,
      bookmarks: 1,
      playbackProgress: 1,
      watchedState: 1,
      watchHistory: 1,
      categories: 1,
      platforms: 1,
      slugHistory: 1,
      seo: 1,
      assets: 1,
      notifications: 1,
      adminNotifications: 1,
      analyticsEvents: 3,
    });

    const [movie] = await db.select().from(movies).where(eq(movies.id, result.movieId));

    expect(movie).toMatchObject({
      id: result.movieId,
      title: 'Seasons of Glass',
      slug: drama.slug,
      description: drama.description,
      poster: drama.poster,
      banner: drama.banner,
      publication_status: 'published',
      video_source: HTTPS_SOURCE,
      converted_from_drama_id: drama.id,
      deleted_at: null,
    });
    expect(movie?.created_at.getTime()).toBe(drama.created_at.getTime());

    const [dramaRow] = await db.select().from(dramas).where(eq(dramas.id, drama.id));
    expect(dramaRow?.deleted_at).not.toBeNull();
    expect(dramaRow?.title).toBe('Seasons of Glass');

    const [episodeRow] = await db.select().from(episodes).where(eq(episodes.id, episode.id));
    expect(episodeRow?.deleted_at).not.toBeNull();
    expect(episodeRow?.video_source).toBe(HTTPS_SOURCE);

    const [seasonRow] = await db.select().from(seasons).where(eq(seasons.id, season.id));
    expect(seasonRow?.deleted_at).not.toBeNull();

    // Ratings and reviews moved, including the moderation state.
    const ratingRows = await db.select().from(ratings).where(eq(ratings.movie_id, result.movieId));
    expect(ratingRows).toHaveLength(2);
    expect(ratingRows.every(row => row.drama_id === null)).toBe(true);
    expect(ratingRows.find(row => row.id === rating.id)).toMatchObject({
      value: 5,
      deleted_at: null,
    });
    expect(ratingRows.find(row => row.id === deletedRating.id)?.deleted_at).not.toBeNull();

    const [reviewRow] = await db.select().from(reviews).where(eq(reviews.id, review.id));
    expect(reviewRow).toMatchObject({
      drama_id: null,
      movie_id: result.movieId,
      content: 'A considered review.',
    });

    // Reactions and reports reference the review id, so they follow it.
    expect(
      await db.select().from(reviewReactions).where(eq(reviewReactions.review_id, review.id))
    ).toHaveLength(1);
    expect(
      await db.select().from(reviewReports).where(eq(reviewReports.review_id, review.id))
    ).toHaveLength(1);

    const [bookmarkRow] = await db.select().from(bookmarks).where(eq(bookmarks.id, bookmark.id));
    expect(bookmarkRow).toMatchObject({ content_type: 'movie', content_id: result.movieId });

    const [progressRow] = await db
      .select()
      .from(playbackProgress)
      .where(eq(playbackProgress.id, progress.id));
    expect(progressRow).toMatchObject({
      content_type: 'movie',
      content_id: result.movieId,
      episode_id: null,
      position: 42,
      duration: 1800,
    });

    const [watchedRow] = await db
      .select()
      .from(watchedState)
      .where(eq(watchedState.id, watched.id));
    expect(watchedRow).toMatchObject({
      content_type: 'movie',
      content_id: result.movieId,
      episode_id: null,
      watched_minutes: 30,
      threshold_met: true,
    });

    const [historyRow] = await db
      .select()
      .from(watchHistory)
      .where(eq(watchHistory.id, history.id));
    expect(historyRow).toMatchObject({
      content_type: 'movie',
      content_id: result.movieId,
      episode_id: episode.id,
      watch_duration: 42,
    });
    expect(historyRow?.watched_at.getTime()).toBe(watchedAt.getTime());

    // Associations moved off the drama onto the movie.
    expect(
      await db.select().from(dramaCategories).where(eq(dramaCategories.drama_id, drama.id))
    ).toHaveLength(0);
    expect(
      await db.select().from(dramaPlatforms).where(eq(dramaPlatforms.drama_id, drama.id))
    ).toHaveLength(0);
    expect(
      await db.select().from(movieCategories).where(eq(movieCategories.movie_id, result.movieId))
    ).toEqual([{ movie_id: result.movieId, category_id: categoryId }]);
    expect(
      await db.select().from(moviePlatforms).where(eq(moviePlatforms.movie_id, result.movieId))
    ).toEqual([{ movie_id: result.movieId, platform_id: platformId }]);

    // Notifications, analytics, and metadata follow the new identity.
    const [notificationRow] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.content_id, result.movieId));
    expect(notificationRow?.content_type).toBe('movie');
    const [adminNotificationRow] = await db
      .select()
      .from(adminNotifications)
      .where(eq(adminNotifications.content_id, result.movieId));
    expect(adminNotificationRow?.content_type).toBe('movie');
    expect(
      await db
        .select()
        .from(contentViewEvents)
        .where(eq(contentViewEvents.content_id, result.movieId))
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(playbackAnalyticsEvents)
        .where(eq(playbackAnalyticsEvents.content_id, result.movieId))
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(analyticsDailyAggregates)
        .where(eq(analyticsDailyAggregates.content_id, result.movieId))
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(contentSlugHistory)
        .where(eq(contentSlugHistory.content_id, result.movieId))
    ).toHaveLength(1);
    expect(
      await db.select().from(contentSeo).where(eq(contentSeo.content_id, result.movieId))
    ).toHaveLength(1);
    expect(
      await db.select().from(contentAssets).where(eq(contentAssets.content_id, result.movieId))
    ).toHaveLength(1);

    // Similar-drama recommendations are intentionally untouched.
    expect(
      await db.select().from(similarDramas).where(eq(similarDramas.drama_id, drama.id))
    ).toHaveLength(1);
  });

  it('rejects a duplicate apply and keeps a single movie', async () => {
    const drama = await insertDrama('apply-duplicate');
    await insertEpisode(drama.id);
    const plan = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    });

    const first = await applyMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      fingerprint: plan.fingerprint,
    });

    await expect(
      applyMovieConversion(managerActor, {
        dramaId: drama.id,
        mode: 'apply',
        fingerprint: plan.fingerprint,
      })
    ).rejects.toThrow(/already converted|no longer/i);

    const movieRows = await db
      .select()
      .from(movies)
      .where(eq(movies.converted_from_drama_id, drama.id));
    expect(movieRows).toHaveLength(1);
    expect(movieRows[0]?.id).toBe(first.movieId);
  });

  it('creates a draft movie when the published episode has no source', async () => {
    const drama = await insertDrama('apply-draft-downgrade');
    await insertEpisode(drama.id, { video_source: null });
    const plan = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    });

    const result = await applyMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      fingerprint: plan.fingerprint,
    });

    expect(result.applied).toBe(true);
    expect(result.movie.publicationStatus).toBe('draft');

    const [movie] = await db.select().from(movies).where(eq(movies.id, result.movieId));
    expect(movie?.publication_status).toBe('draft');
    expect(movie?.video_source).toBeNull();
  });

  it('rejects a stale fingerprint after the drama changes', async () => {
    const drama = await insertDrama('apply-stale');
    await insertEpisode(drama.id);
    const plan = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    });

    await db.update(dramas).set({ title: 'Changed After Preview' }).where(eq(dramas.id, drama.id));

    await expect(
      applyMovieConversion(managerActor, {
        dramaId: drama.id,
        mode: 'apply',
        fingerprint: plan.fingerprint,
      })
    ).rejects.toThrow(/changed after the preview/i);

    expect(await testMovieIds([drama.id])).toHaveLength(0);
    const [dramaRow] = await db.select().from(dramas).where(eq(dramas.id, drama.id));
    expect(dramaRow?.deleted_at).toBeNull();
  });

  it('rechecks the slug conflict at apply time and writes nothing', async () => {
    const drama = await insertDrama('apply-slug');
    await insertEpisode(drama.id);
    const plan = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    });

    const conflicting = await insertMovie('apply-conflict', {
      slug: drama.slug,
      title: 'Conflicting Movie',
    });

    const error = await applyMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      fingerprint: plan.fingerprint,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictError);
    expect((error as Error).message).toContain(drama.slug);
    expect((error as Error).message).toContain(conflicting.title);

    const movieRows = await db
      .select()
      .from(movies)
      .where(eq(movies.converted_from_drama_id, drama.id));
    expect(movieRows).toHaveLength(0);
    const [dramaRow] = await db.select().from(dramas).where(eq(dramas.id, drama.id));
    expect(dramaRow?.deleted_at).toBeNull();
  });

  it('rechecks the episode count at apply time', async () => {
    const drama = await insertDrama('apply-episode-count');
    await insertEpisode(drama.id);
    const plan = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    });

    await insertEpisode(drama.id, { episode_number: 2, position: 1 });

    await expect(
      applyMovieConversion(managerActor, {
        dramaId: drama.id,
        mode: 'apply',
        fingerprint: plan.fingerprint,
      })
    ).rejects.toThrow(/exactly one episode/i);

    expect(await testMovieIds([drama.id])).toHaveLength(0);
  });

  it('allows exactly one of two concurrent applies', async () => {
    const drama = await insertDrama('apply-concurrent');
    await insertEpisode(drama.id);
    const plan = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    });
    const request = {
      dramaId: drama.id,
      mode: 'apply' as const,
      fingerprint: plan.fingerprint,
    };

    const outcomes = await Promise.allSettled([
      applyMovieConversion(managerActor, request),
      applyMovieConversion(managerActor, request),
    ]);

    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);

    const rejected = outcomes.find(
      (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
    );
    expect(rejected?.reason).toBeInstanceOf(ConflictError);

    const movieRows = await db
      .select()
      .from(movies)
      .where(eq(movies.converted_from_drama_id, drama.id));
    expect(movieRows).toHaveLength(1);
  });

  it('rejects an apply without a fingerprint or with the wrong mode', async () => {
    const drama = await insertDrama('apply-invalid');
    await insertEpisode(drama.id);

    await expect(
      applyMovieConversion(managerActor, { dramaId: drama.id, mode: 'apply' })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      applyMovieConversion(managerActor, { dramaId: drama.id, mode: 'preview' })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('enforces drama.manage', async () => {
    const drama = await insertDrama('apply-authz');
    await insertEpisode(drama.id);
    const request = {
      dramaId: drama.id,
      mode: 'apply' as const,
      fingerprint: 'a'.repeat(64),
    };

    await expect(applyMovieConversion(anonymousActor, request)).rejects.toBeInstanceOf(
      AuthenticationError
    );
    await expect(applyMovieConversion(readerActor, request)).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it('rolls back the movie and every moved record when a later write fails', async () => {
    const drama = await insertDrama('apply-rollback');
    const season = await insertSeason(drama.id);
    const episode = await insertEpisode(drama.id, { season_id: season.id });
    const categoryId = await insertCategory('rollback');
    await db.insert(dramaCategories).values({ drama_id: drama.id, category_id: categoryId });

    const [rating] = await db
      .insert(ratings)
      .values({ user_id: newUserId(), drama_id: drama.id, value: 4 })
      .returning();
    const [bookmark] = await db
      .insert(bookmarks)
      .values({
        user_id: await insertUser('rollback-bookmark'),
        content_type: 'drama',
        content_id: drama.id,
        drama_id: drama.id,
      })
      .returning();

    if (!rating || !bookmark) {
      throw new Error('Rollback fixture insert returned no row.');
    }

    const plan = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    });

    // The trigger fires while episodes are soft-deleted, after the movie
    // insert and every relationship move have already run.
    await installEpisodeUpdateFailure(drama.id);

    await expect(
      applyMovieConversion(managerActor, {
        dramaId: drama.id,
        mode: 'apply',
        fingerprint: plan.fingerprint,
      })
    ).rejects.toThrow();

    expect(await testMovieIds([drama.id])).toHaveLength(0);

    const [dramaRow] = await db.select().from(dramas).where(eq(dramas.id, drama.id));
    expect(dramaRow?.deleted_at).toBeNull();
    expect(dramaRow?.title).toBe(drama.title);

    const [episodeRow] = await db.select().from(episodes).where(eq(episodes.id, episode.id));
    expect(episodeRow?.deleted_at).toBeNull();

    const [seasonRow] = await db.select().from(seasons).where(eq(seasons.id, season.id));
    expect(seasonRow?.deleted_at).toBeNull();

    const [ratingRow] = await db.select().from(ratings).where(eq(ratings.id, rating.id));
    expect(ratingRow).toMatchObject({ drama_id: drama.id, movie_id: null, value: 4 });

    const [bookmarkRow] = await db.select().from(bookmarks).where(eq(bookmarks.id, bookmark.id));
    expect(bookmarkRow).toMatchObject({ content_type: 'drama', content_id: drama.id });

    expect(
      await db.select().from(dramaCategories).where(eq(dramaCategories.drama_id, drama.id))
    ).toHaveLength(1);
  });
});

describe('typed targets follow the conversion', () => {
  it('moves a typed target even when the legacy pair names another drama', async () => {
    const drama = await insertDrama('typed-move');
    await insertEpisode(drama.id);
    const otherDrama = await insertDrama('typed-move-other');

    const [bookmark] = await db
      .insert(bookmarks)
      .values({
        user_id: await insertUser('typed-move'),
        content_type: 'drama',
        content_id: otherDrama.id,
        drama_id: drama.id,
      })
      .returning();

    const plan = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    });

    // The typed target is the authoritative one, so the row is counted even
    // though the legacy pair names a different drama.
    expect(plan.relationships.bookmarks).toBe(1);

    const result = await applyMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      fingerprint: plan.fingerprint,
    });

    const [row] = await db.select().from(bookmarks).where(eq(bookmarks.id, bookmark!.id));

    expect(row).toMatchObject({
      drama_id: null,
      movie_id: result.movieId,
      content_type: 'movie',
      content_id: result.movieId,
    });
  });

  it('merges two episode progress rows into one movie row', async () => {
    const drama = await insertDrama('typed-progress');
    const first = await insertEpisode(drama.id, { episode_number: 1, position: 0 });
    const userId = await insertUser('typed-progress');

    await db.insert(playbackProgress).values([
      {
        user_id: userId,
        content_type: 'drama',
        content_id: drama.id,
        drama_id: drama.id,
        episode_id: first.id,
        position: 10,
        duration: 100,
        last_watched_at: new Date('2026-01-01T00:00:00.000Z'),
        completed: false,
      },
      {
        user_id: userId,
        content_type: 'drama',
        content_id: drama.id,
        drama_id: drama.id,
        episode_id: null,
        position: 55,
        duration: 120,
        last_watched_at: new Date('2026-01-03T00:00:00.000Z'),
        completed: true,
      },
    ]);

    const plan = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    });
    const result = await applyMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      fingerprint: plan.fingerprint,
    });

    const rows = await db
      .select()
      .from(playbackProgress)
      .where(eq(playbackProgress.user_id, userId));

    // One row per user and target: the movie-level uniqueness would reject two.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      drama_id: null,
      movie_id: result.movieId,
      episode_id: null,
      // The latest watched episode keeps the resume point.
      position: 55,
      duration: 120,
      // Completion is true when any merged row was complete.
      completed: true,
    });
    expect(rows[0]?.last_watched_at.toISOString()).toBe('2026-01-03T00:00:00.000Z');
  });

  it('merges two watched-state rows into one movie row', async () => {
    const drama = await insertDrama('typed-watched');
    const first = await insertEpisode(drama.id, { episode_number: 1, position: 0 });
    const userId = await insertUser('typed-watched');

    await db.insert(watchedState).values([
      {
        user_id: userId,
        content_type: 'drama',
        content_id: drama.id,
        drama_id: drama.id,
        episode_id: first.id,
        watched_minutes: 30,
        threshold_met: false,
        last_watched_at: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        user_id: userId,
        content_type: 'drama',
        content_id: drama.id,
        drama_id: drama.id,
        episode_id: null,
        watched_minutes: 95,
        threshold_met: true,
        last_watched_at: new Date('2026-01-02T00:00:00.000Z'),
      },
    ]);

    const plan = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    });
    const result = await applyMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      fingerprint: plan.fingerprint,
    });

    const rows = await db.select().from(watchedState).where(eq(watchedState.user_id, userId));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      drama_id: null,
      movie_id: result.movieId,
      episode_id: null,
      // The merged state keeps the most watched minutes and any threshold.
      watched_minutes: 95,
      threshold_met: true,
    });
  });

  it('keeps every watch-history row and its episode id', async () => {
    const drama = await insertDrama('typed-history');
    const episode = await insertEpisode(drama.id);
    const userId = await insertUser('typed-history');

    await db.insert(watchHistory).values([
      {
        user_id: userId,
        content_type: 'drama',
        content_id: drama.id,
        drama_id: drama.id,
        episode_id: episode.id,
        watched_at: new Date('2026-01-01T00:00:00.000Z'),
        watch_duration: 20,
      },
      {
        user_id: userId,
        content_type: 'drama',
        content_id: drama.id,
        drama_id: drama.id,
        episode_id: episode.id,
        watched_at: new Date('2026-01-02T00:00:00.000Z'),
        watch_duration: 35,
      },
    ]);

    const plan = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    });
    const result = await applyMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      fingerprint: plan.fingerprint,
    });

    const rows = await db.select().from(watchHistory).where(eq(watchHistory.user_id, userId));

    // History is append-only: two sessions stay two sessions.
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.movie_id === result.movieId && row.drama_id === null)).toBe(true);
    expect(rows.every(row => row.episode_id === episode.id)).toBe(true);
    expect(rows.map(row => row.watched_at.toISOString()).sort()).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
    ]);
  });

  it('merges a legacy bookmark into the typed bookmark of the same user', async () => {
    const drama = await insertDrama('typed-bookmark');
    await insertEpisode(drama.id);
    const userId = await insertUser('typed-bookmark');

    await db.insert(bookmarks).values({
      user_id: userId,
      content_type: 'drama',
      content_id: drama.id,
      drama_id: drama.id,
    });

    // A legacy-only row cannot be written after the migration: the exactly-one
    // check is enforced for every new row. The pre-migration state is recreated
    // inside one transaction instead — the constraint is dropped, the row is
    // inserted, and the constraint is restored as `NOT VALID`. Other sessions
    // never see the table without the constraint, because the whole change is
    // one transaction.
    await db.transaction(async tx => {
      await tx.execute(sql`ALTER TABLE bookmarks DROP CONSTRAINT ck_bookmarks_target`);
      await tx.insert(bookmarks).values({
        user_id: userId,
        content_type: 'drama',
        content_id: drama.id,
      });
      await tx.execute(
        sql`ALTER TABLE bookmarks ADD CONSTRAINT ck_bookmarks_target
            CHECK ((drama_id is not null and movie_id is null) or (drama_id is null and movie_id is not null)) NOT VALID`
      );
    });

    const plan = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    });
    const result = await applyMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      fingerprint: plan.fingerprint,
    });

    const rows = await db.select().from(bookmarks).where(eq(bookmarks.user_id, userId));

    // Both rows pointed at the same content for the same user, so they become
    // one movie bookmark instead of colliding on the per-user target index.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      drama_id: null,
      movie_id: result.movieId,
      content_type: 'movie',
      content_id: result.movieId,
    });
  });

  it('moves typed analytics rows to the movie', async () => {
    const drama = await insertDrama('typed-analytics');
    await insertEpisode(drama.id);

    await db.insert(contentViewEvents).values({
      content_type: 'drama',
      content_id: drama.id,
      drama_id: drama.id,
    });
    await db.insert(playbackAnalyticsEvents).values({
      content_type: 'drama',
      content_id: drama.id,
      drama_id: drama.id,
      event_type: 'completion',
    });

    const plan = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    });
    const result = await applyMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      fingerprint: plan.fingerprint,
    });

    const [view] = await db.select().from(contentViewEvents);
    const [playback] = await db.select().from(playbackAnalyticsEvents);

    expect(view).toMatchObject({
      drama_id: null,
      movie_id: result.movieId,
      content_type: 'movie',
      content_id: result.movieId,
    });
    expect(playback).toMatchObject({
      drama_id: null,
      movie_id: result.movieId,
      content_type: 'movie',
      content_id: result.movieId,
    });
  });

  it('carries the daily aggregates of one date to the new movie', async () => {
    const drama = await insertDrama('typed-aggregate');
    await insertEpisode(drama.id);

    // The database holds one live row per day and target (D-070), so the
    // aggregate of the drama follows the content into the movie row.
    await db.insert(analyticsDailyAggregates).values({
      date: '2026-01-05',
      content_type: 'drama',
      content_id: drama.id,
      drama_id: drama.id,
      unique_visitors: 4,
      total_views: 6,
      total_playback_events: 2,
      completion_events: 1,
      total_watch_duration_seconds: 900,
    });

    const plan = await previewMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
    });
    const result = await applyMovieConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      fingerprint: plan.fingerprint,
    });

    const rows = await db
      .select()
      .from(analyticsDailyAggregates)
      .where(eq(analyticsDailyAggregates.content_id, result.movieId));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-01-05',
      drama_id: null,
      movie_id: result.movieId,
      content_type: 'movie',
      content_id: result.movieId,
      // The counters of the day are carried over unchanged: the aggregate was
      // rewritten, not recounted.
      unique_visitors: 4,
      total_views: 6,
      total_playback_events: 2,
      completion_events: 1,
      total_watch_duration_seconds: 900,
    });
  });

  it('merges the rows of one date into the row of the target', async () => {
    const drama = await insertDrama('typed-aggregate-multi');
    const movie = await insertMovie('typed-aggregate-multi');

    await db.insert(analyticsDailyAggregates).values([
      {
        date: '2026-01-06',
        content_type: 'drama',
        content_id: drama.id,
        drama_id: drama.id,
        unique_visitors: 4,
        total_views: 6,
      },
      {
        date: '2026-01-06',
        content_type: 'movie',
        content_id: movie.id,
        movie_id: movie.id,
        unique_visitors: 7,
        total_views: 3,
      },
    ]);

    await db.transaction(async tx => moveContentReferences(tx, drama.id, movie.id));

    const rows = await db
      .select()
      .from(analyticsDailyAggregates)
      .where(eq(analyticsDailyAggregates.date, '2026-01-06'));

    // Every row of the date is merged, not only the first target row: the
    // drama row and the row of the target are two halves of the same
    // aggregate.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      drama_id: null,
      movie_id: movie.id,
      content_type: 'movie',
      content_id: movie.id,
      // The counters add up; the visitor count cannot, because the overlap
      // between the two rows is unknown.
      unique_visitors: 7,
      total_views: 9,
    });
  });
});

describe('ratings and reviews target contract', () => {
  it('enforces exactly one target per rating and review', async () => {
    const drama = await insertDrama('target-check');
    const movie = await insertMovie('target-check');

    await expect(
      db.insert(ratings).values({
        user_id: newUserId(),
        drama_id: drama.id,
        movie_id: movie.id,
        value: 3,
      })
    ).rejects.toThrow();
    await expect(db.insert(ratings).values({ user_id: newUserId(), value: 3 })).rejects.toThrow();
    await expect(
      db.insert(reviews).values({
        user_id: newUserId(),
        drama_id: drama.id,
        movie_id: movie.id,
        content: 'Two targets.',
      })
    ).rejects.toThrow();
    await expect(
      db.insert(reviews).values({ user_id: newUserId(), content: 'No target.' })
    ).rejects.toThrow();
  });

  it('keeps one active rating per user and target', async () => {
    const drama = await insertDrama('target-unique');

    const raterId = newUserId();
    await db.insert(ratings).values({ user_id: raterId, drama_id: drama.id, value: 5 });

    await expect(
      db.insert(ratings).values({ user_id: raterId, drama_id: drama.id, value: 4 })
    ).rejects.toThrow();

    // A soft-deleted rating does not block a new active rating.
    await db
      .update(ratings)
      .set({ deleted_at: new Date() })
      .where(and(eq(ratings.user_id, raterId), eq(ratings.drama_id, drama.id)));

    await expect(
      db.insert(ratings).values({ user_id: raterId, drama_id: drama.id, value: 4 })
    ).resolves.toBeDefined();
  });
});
