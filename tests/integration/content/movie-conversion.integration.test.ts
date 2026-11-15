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
    await db.delete(reviews).where(
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
      movieIds.length > 0
        ? and(eq(contentType, 'movie'), inArray(contentId, movieIds))
        : sql`false`
    );

  await db.delete(bookmarks).where(polymorphicCondition(bookmarks.content_type, bookmarks.content_id));
  await db
    .delete(playbackProgress)
    .where(polymorphicCondition(playbackProgress.content_type, playbackProgress.content_id));
  await db
    .delete(watchedState)
    .where(polymorphicCondition(watchedState.content_type, watchedState.content_id));
  await db
    .delete(watchHistory)
    .where(polymorphicCondition(watchHistory.content_type, watchHistory.content_id));
  await db
    .delete(notifications)
    .where(polymorphicCondition(notifications.content_type, notifications.content_id));
  await db
    .delete(adminNotifications)
    .where(polymorphicCondition(adminNotifications.content_type, adminNotifications.content_id));
  await db
    .delete(contentViewEvents)
    .where(polymorphicCondition(contentViewEvents.content_type, contentViewEvents.content_id));
  await db
    .delete(playbackAnalyticsEvents)
    .where(
      polymorphicCondition(
        playbackAnalyticsEvents.content_type,
        playbackAnalyticsEvents.content_id
      )
    );
  await db
    .delete(analyticsDailyAggregates)
    .where(
      polymorphicCondition(analyticsDailyAggregates.content_type, analyticsDailyAggregates.content_id)
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
}

/**
 * Fail any update of this drama's episodes. The trigger is scoped to the drama
 * so parallel test files are unaffected. It fires after the movie insert and
 * after the relationship moves, which proves the whole transaction rolls back.
 */
async function installEpisodeUpdateFailure(dramaId: string): Promise<void> {
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION it_fail_movie_conversion_episode_update() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'injected movie conversion failure';
    END;
    $$ LANGUAGE plpgsql;
  `));

  await db.execute(sql.raw(`
    CREATE TRIGGER it_fail_movie_conversion_episode_update_trigger
    BEFORE UPDATE ON episodes
    FOR EACH ROW
    WHEN (OLD.drama_id = '${dramaId}'::uuid)
    EXECUTE FUNCTION it_fail_movie_conversion_episode_update();
  `));
}

async function removeEpisodeUpdateFailure(): Promise<void> {
  await db.execute(
    sql.raw(
      'DROP TRIGGER IF EXISTS it_fail_movie_conversion_episode_update_trigger ON episodes;'
    )
  );
  await db.execute(
    sql.raw('DROP FUNCTION IF EXISTS it_fail_movie_conversion_episode_update();')
  );
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
    await expect(
      loadMovieConversionContext(managerActor, randomUUID())
    ).rejects.toBeInstanceOf(NotFoundError);
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
      user_id: newUserId(),
      content_type: 'drama',
      content_id: drama.id,
    });
    await db.insert(watchHistory).values({
      user_id: newUserId(),
      content_type: 'drama',
      content_id: drama.id,
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

    await db.insert(reviewReactions).values({ user_id: newUserId(), review_id: review.id });
    await db.insert(reviewReports).values({
      user_id: newUserId(),
      review_id: review.id,
      reason: 'spoiler',
    });

    const [bookmark] = await db
      .insert(bookmarks)
      .values({ user_id: newUserId(), content_type: 'drama', content_id: drama.id })
      .returning();
    const [progress] = await db
      .insert(playbackProgress)
      .values({
        user_id: newUserId(),
        content_type: 'drama',
        content_id: drama.id,
        episode_id: episode.id,
        position: 42,
        duration: 1800,
      })
      .returning();
    const [watched] = await db
      .insert(watchedState)
      .values({
        user_id: newUserId(),
        content_type: 'drama',
        content_id: drama.id,
        episode_id: episode.id,
        watched_minutes: 30,
        threshold_met: true,
      })
      .returning();
    const watchedAt = new Date('2026-01-02T03:04:05.000Z');
    const [history] = await db
      .insert(watchHistory)
      .values({
        user_id: newUserId(),
        content_type: 'drama',
        content_id: drama.id,
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
    });
    await db.insert(playbackAnalyticsEvents).values({
      content_type: 'drama',
      content_id: drama.id,
      event_type: 'completion',
    });
    await db.insert(analyticsDailyAggregates).values({
      date: '2026-01-02',
      content_type: 'drama',
      content_id: drama.id,
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
    const ratingRows = await db
      .select()
      .from(ratings)
      .where(eq(ratings.movie_id, result.movieId));
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

    const [bookmarkRow] = await db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.id, bookmark.id));
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

    await db
      .update(dramas)
      .set({ title: 'Changed After Preview' })
      .where(eq(dramas.id, drama.id));

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
      .values({ user_id: newUserId(), content_type: 'drama', content_id: drama.id })
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

    const [bookmarkRow] = await db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.id, bookmark.id));
    expect(bookmarkRow).toMatchObject({ content_type: 'drama', content_id: drama.id });

    expect(
      await db.select().from(dramaCategories).where(eq(dramaCategories.drama_id, drama.id))
    ).toHaveLength(1);
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
