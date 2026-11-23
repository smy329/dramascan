import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Public detail-page integration coverage.
 *
 * The details pages are the public face of the content module, so the
 * availability rules have to hold there as well: a draft, trashed, or hidden
 * drama is not readable, an unpublished episode never appears in the episode
 * list, and a movie without a published state or a source is not readable
 * either.
 *
 * These tests run against the real PostgreSQL test database.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for public detail integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  categories,
  content_slug_history as contentSlugHistory,
  dramas,
  drama_categories as dramaCategories,
  episodes,
  movies,
  seasons,
  similar_dramas as similarDramas,
} from '@/modules/content/schema';
import {
  getPublicDramaDetail,
  getPublicMovieDetail,
  listPublicSimilarDramas,
} from '@/modules/content/public-details';
import { resolvePublicContentSlug } from '@/modules/content/public-slugs';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-public-details-';

type Seed = {
  dramaId: string;
  dramaSlug: string;
  seasonId: string;
  publishedEpisodeId: string;
  draftEpisodeId: string;
  categoryId: string;
  movieId: string;
  movieSlug: string;
};

async function seed(): Promise<Seed> {
  const dramaId = randomUUID();
  const dramaSlug = `${TEST_PREFIX}${randomUUID().slice(0, 8)}`;
  const seasonId = randomUUID();
  const publishedEpisodeId = randomUUID();
  const draftEpisodeId = randomUUID();
  const categoryId = randomUUID();
  const movieId = randomUUID();
  const movieSlug = `${TEST_PREFIX}${randomUUID().slice(0, 8)}`;

  await db.insert(dramas).values({
    id: dramaId,
    title: 'Public drama',
    slug: dramaSlug,
    description: 'A drama the public may read.',
    structure_type: 'season_based',
    status: 'ongoing',
    publication_status: 'published',
    visibility: 'coming_soon',
  });

  await db.insert(seasons).values({
    id: seasonId,
    drama_id: dramaId,
    title: 'Season 1',
    position: 0,
    publication_status: 'published',
  });

  await db.insert(episodes).values([
    {
      id: publishedEpisodeId,
      drama_id: dramaId,
      season_id: seasonId,
      title: 'Published episode',
      episode_number: 1,
      position: 0,
      publication_status: 'published',
      video_source: 'https://media.example.com/episodes/published.mp4',
    },
    {
      id: draftEpisodeId,
      drama_id: dramaId,
      season_id: seasonId,
      title: 'Draft episode',
      episode_number: 2,
      position: 1,
      publication_status: 'draft',
      video_source: 'https://media.example.com/episodes/draft.mp4',
    },
  ]);

  await db.insert(categories).values({
    id: categoryId,
    name: 'Romance',
    slug: `${TEST_PREFIX}-romance`,
  });

  await db.insert(dramaCategories).values({
    drama_id: dramaId,
    category_id: categoryId,
  });

  await db.insert(movies).values({
    id: movieId,
    title: 'Public film',
    slug: movieSlug,
    description: 'A film the public may read.',
    publication_status: 'published',
    video_source: 'https://media.example.com/movies/1.mp4',
  });

  return {
    dramaId,
    dramaSlug,
    seasonId,
    publishedEpisodeId,
    draftEpisodeId,
    categoryId,
    movieId,
    movieSlug,
  };
}

async function cleanup(): Promise<void> {
  const dramaRows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_PREFIX}%`));

  const movieRows = await db
    .select({ id: movies.id })
    .from(movies)
    .where(like(movies.slug, `${TEST_PREFIX}%`));

  const categoryRows = await db
    .select({ id: categories.id })
    .from(categories)
    .where(like(categories.slug, `${TEST_PREFIX}%`));

  const dramaIds = dramaRows.map(row => row.id);
  const movieIds = movieRows.map(row => row.id);
  const categoryIds = categoryRows.map(row => row.id);

  if (dramaIds.length > 0) {
    await db.delete(dramaCategories).where(inArray(dramaCategories.drama_id, dramaIds));
    await db.delete(similarDramas).where(inArray(similarDramas.drama_id, dramaIds));
    await db.delete(contentSlugHistory).where(inArray(contentSlugHistory.content_id, dramaIds));

    const episodeRows = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(inArray(episodes.drama_id, dramaIds));

    const episodeIds = episodeRows.map(row => row.id);

    if (episodeIds.length > 0) {
      await db.delete(episodes).where(inArray(episodes.id, episodeIds));
    }

    await db.delete(seasons).where(inArray(seasons.drama_id, dramaIds));
    await db.delete(dramas).where(inArray(dramas.id, dramaIds));
  }

  if (movieIds.length > 0) {
    await db.delete(contentSlugHistory).where(inArray(contentSlugHistory.content_id, movieIds));
    await db.delete(movies).where(inArray(movies.id, movieIds));
  }

  if (categoryIds.length > 0) {
    await db.delete(categories).where(inArray(categories.id, categoryIds));
  }
}

beforeEach(async () => {
  await cleanup();
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('getPublicDramaDetail', () => {
  it('returns the drama with its playable episodes and taxonomy', async () => {
    const seeded = await seed();

    const detail = await getPublicDramaDetail(seeded.dramaId, seeded.dramaSlug);

    expect(detail).not.toBeNull();
    expect(detail?.title).toBe('Public drama');
    expect(detail?.href).toBe(`/drama/${seeded.dramaId}/${seeded.dramaSlug}`);
    expect(detail?.structureType).toBe('season_based');
    expect(detail?.categories.map(category => category.name)).toEqual(['Romance']);
  });

  it('never exposes an unpublished episode', async () => {
    const seeded = await seed();

    const detail = await getPublicDramaDetail(seeded.dramaId, seeded.dramaSlug);

    expect(detail?.episodes.map(episode => episode.id)).toEqual([seeded.publishedEpisodeId]);
    expect(detail?.episodes.map(episode => episode.id)).not.toContain(seeded.draftEpisodeId);
  });

  it('groups the playable episodes by season', async () => {
    const seeded = await seed();

    const detail = await getPublicDramaDetail(seeded.dramaId, seeded.dramaSlug);

    expect(detail?.seasons).toHaveLength(1);
    expect(detail?.seasons[0]?.title).toBe('Season 1');
    expect(detail?.seasons[0]?.episodes).toHaveLength(1);
  });

  it('returns null for a drama that is not published', async () => {
    const seeded = await seed();

    await db
      .update(dramas)
      .set({ publication_status: 'unpublished' })
      .where(eq(dramas.id, seeded.dramaId));

    expect(await getPublicDramaDetail(seeded.dramaId, seeded.dramaSlug)).toBeNull();
  });

  it('returns null for a drama in the Trash', async () => {
    const seeded = await seed();

    await db
      .update(dramas)
      .set({ deleted_at: new Date() })
      .where(eq(dramas.id, seeded.dramaId));

    expect(await getPublicDramaDetail(seeded.dramaId, seeded.dramaSlug)).toBeNull();

    // The row leaves the Trash again right away: a trashed row is visible to
    // every reader of the database, and the integration suite shares one.
    await db
      .update(dramas)
      .set({ deleted_at: null })
      .where(eq(dramas.id, seeded.dramaId));
  });

  it('returns null when the slug does not match', async () => {
    const seeded = await seed();

    expect(await getPublicDramaDetail(seeded.dramaId, 'a-different-slug')).toBeNull();
  });
});

describe('listPublicSimilarDramas', () => {
  it('only recommends dramas the public may discover', async () => {
    const seeded = await seed();
    const otherId = randomUUID();
    const otherSlug = `${TEST_PREFIX}${randomUUID().slice(0, 8)}`;

    await db.insert(dramas).values({
      id: otherId,
      title: 'Similar drama',
      slug: otherSlug,
      structure_type: 'season_based',
      status: 'completed',
      publication_status: 'published',
      visibility: 'coming_soon',
    });

    await db.insert(similarDramas).values({
      drama_id: seeded.dramaId,
      similar_drama_id: otherId,
      position: 0,
    });

    const similar = await listPublicSimilarDramas(seeded.dramaId);

    expect(similar.map(drama => drama.id)).toEqual([otherId]);

    // The recommended drama is unpublished: it disappears from the list.
    await db
      .update(dramas)
      .set({ publication_status: 'draft' })
      .where(eq(dramas.id, otherId));

    expect(await listPublicSimilarDramas(seeded.dramaId)).toEqual([]);
  });
});

describe('getPublicMovieDetail', () => {
  it('returns the movie with its taxonomy and the watch route', async () => {
    const seeded = await seed();

    const detail = await getPublicMovieDetail(seeded.movieId, seeded.movieSlug);

    expect(detail).not.toBeNull();
    expect(detail?.title).toBe('Public film');
    expect(detail?.href).toBe(`/movie/${seeded.movieId}/${seeded.movieSlug}`);
    expect(detail?.watchHref).toBe(`/movie/${seeded.movieId}/${seeded.movieSlug}/watch`);
  });

  it('returns null for a movie that is not published', async () => {
    const seeded = await seed();

    await db
      .update(movies)
      .set({ publication_status: 'draft' })
      .where(eq(movies.id, seeded.movieId));

    expect(await getPublicMovieDetail(seeded.movieId, seeded.movieSlug)).toBeNull();
  });

  it('returns null for a movie in the Trash', async () => {
    const seeded = await seed();

    await db
      .update(movies)
      .set({ deleted_at: new Date() })
      .where(eq(movies.id, seeded.movieId));

    expect(await getPublicMovieDetail(seeded.movieId, seeded.movieSlug)).toBeNull();

    // The row leaves the Trash again right away: a trashed row is visible to
    // every reader of the database, and the integration suite shares one.
    await db
      .update(movies)
      .set({ deleted_at: null })
      .where(eq(movies.id, seeded.movieId));
  });

  it('returns null when the slug does not match', async () => {
    const seeded = await seed();

    expect(await getPublicMovieDetail(seeded.movieId, 'a-different-slug')).toBeNull();
  });

  it('returns null for a published movie without a source', async () => {
    const seeded = await seed();

    // A published movie without a source is not playable, so it is not
    // reachable through the details page either: the page, the watch route,
    // and the bookmark write all answer the same question.
    await db
      .update(movies)
      .set({ video_source: null })
      .where(eq(movies.id, seeded.movieId));

    expect(await getPublicMovieDetail(seeded.movieId, seeded.movieSlug)).toBeNull();
  });
});

describe('resolvePublicContentSlug', () => {
  it('returns the current slug for a slug the content used before', async () => {
    const seeded = await seed();
    const oldSlug = `${TEST_PREFIX}old-drama`;

    await db.insert(contentSlugHistory).values({
      content_type: 'drama',
      content_id: seeded.dramaId,
      old_slug: oldSlug,
      new_slug: seeded.dramaSlug,
    });

    expect(await resolvePublicContentSlug('drama', seeded.dramaId, oldSlug)).toBe(
      seeded.dramaSlug
    );
  });

  it('returns the current movie slug for a slug the movie used before', async () => {
    const seeded = await seed();
    const oldSlug = `${TEST_PREFIX}old-movie`;

    await db.insert(contentSlugHistory).values({
      content_type: 'movie',
      content_id: seeded.movieId,
      old_slug: oldSlug,
      new_slug: seeded.movieSlug,
    });

    expect(await resolvePublicContentSlug('movie', seeded.movieId, oldSlug)).toBe(
      seeded.movieSlug
    );
  });

  it('returns null for a slug the content never used', async () => {
    const seeded = await seed();

    expect(
      await resolvePublicContentSlug('drama', seeded.dramaId, `${TEST_PREFIX}never-used`)
    ).toBeNull();
  });

  it('returns null for content that is not publicly available', async () => {
    const seeded = await seed();
    const oldSlug = `${TEST_PREFIX}old-draft-drama`;

    await db.insert(contentSlugHistory).values({
      content_type: 'drama',
      content_id: seeded.dramaId,
      old_slug: oldSlug,
      new_slug: seeded.dramaSlug,
    });

    // The redirect must not reveal the current slug of a draft item.
    await db
      .update(dramas)
      .set({ publication_status: 'draft' })
      .where(eq(dramas.id, seeded.dramaId));

    expect(await resolvePublicContentSlug('drama', seeded.dramaId, oldSlug)).toBeNull();
  });

  it('returns null for a movie without a source', async () => {
    const seeded = await seed();
    const oldSlug = `${TEST_PREFIX}old-movie-without-source`;

    await db.insert(contentSlugHistory).values({
      content_type: 'movie',
      content_id: seeded.movieId,
      old_slug: oldSlug,
      new_slug: seeded.movieSlug,
    });

    await db
      .update(movies)
      .set({ video_source: null })
      .where(eq(movies.id, seeded.movieId));

    expect(await resolvePublicContentSlug('movie', seeded.movieId, oldSlug)).toBeNull();
  });
});
