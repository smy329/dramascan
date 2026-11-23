import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Bookmark integration coverage.
 *
 * A bookmark names one content item and belongs to one viewer. The write is
 * validated against the public availability rules, so a bookmark can never
 * point at content the viewer is unable to open.
 *
 * These tests run against the real PostgreSQL test database.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for bookmark integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { anonymousActor, userActor } from '@/modules/authorization';
import { dramas, episodes, movies, seasons } from '@/modules/content/schema';
import { isBookmarked, toggleBookmark } from '@/modules/users/bookmarks';
import { bookmarks } from '@/modules/users/schema';
import { closePool } from '@/platform/db/pool';
import { AuthenticationError, NotFoundError } from '@/platform/errors';

const TEST_PREFIX = 'it-bookmark-';

type Seed = {
  userId: string;
  dramaId: string;
  episodeId: string;
  movieId: string;
};

async function seed(): Promise<Seed> {
  const userId = randomUUID();
  const dramaId = randomUUID();
  const seasonId = randomUUID();
  const episodeId = randomUUID();
  const movieId = randomUUID();

  await db.insert(users).values({
    id: userId,
    name: 'Bookmark tester',
    email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
  });

  await db.insert(dramas).values({
    id: dramaId,
    title: 'Bookmark drama',
    slug: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
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

  await db.insert(episodes).values({
    id: episodeId,
    drama_id: dramaId,
    season_id: seasonId,
    title: 'Episode 1',
    episode_number: 1,
    position: 0,
    publication_status: 'published',
    video_source: 'https://media.example.com/episodes/1.mp4',
  });

  await db.insert(movies).values({
    id: movieId,
    title: 'Bookmark film',
    slug: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
    publication_status: 'published',
    video_source: 'https://media.example.com/movies/1.mp4',
  });

  return { userId, dramaId, episodeId, movieId };
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

  const dramaIds = dramaRows.map(row => row.id);
  const movieIds = movieRows.map(row => row.id);

  if (dramaIds.length > 0) {
    await db.delete(bookmarks).where(inArray(bookmarks.drama_id, dramaIds));
  }

  if (movieIds.length > 0) {
    await db.delete(bookmarks).where(inArray(bookmarks.movie_id, movieIds));
  }

  if (dramaIds.length > 0) {
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
    await db.delete(movies).where(inArray(movies.id, movieIds));
  }

  await db.delete(users).where(like(users.email, `${TEST_PREFIX}%`));
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

describe('toggleBookmark', () => {
  it('adds a drama to the viewer list', async () => {
    const seeded = await seed();

    const result = await toggleBookmark(userActor(seeded.userId), {
      type: 'drama',
      id: seeded.dramaId,
    });

    expect(result.bookmarked).toBe(true);

    const rows = await db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.drama_id, seeded.dramaId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(seeded.userId);
    expect(rows[0]?.movie_id).toBeNull();
    expect(rows[0]?.content_type).toBe('drama');
  });

  it('removes the drama again when it is toggled twice', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.userId);

    await toggleBookmark(actor, { type: 'drama', id: seeded.dramaId });
    const result = await toggleBookmark(actor, { type: 'drama', id: seeded.dramaId });

    expect(result.bookmarked).toBe(false);

    const rows = await db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.drama_id, seeded.dramaId));

    expect(rows).toHaveLength(0);
  });

  it('adds a movie to the viewer list', async () => {
    const seeded = await seed();

    const result = await toggleBookmark(userActor(seeded.userId), {
      type: 'movie',
      id: seeded.movieId,
    });

    expect(result.bookmarked).toBe(true);

    const rows = await db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.movie_id, seeded.movieId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.drama_id).toBeNull();
    expect(rows[0]?.content_type).toBe('movie');
  });

  it('reports whether the item is on the list', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.userId);

    expect(await isBookmarked(actor, { type: 'drama', id: seeded.dramaId })).toBe(false);

    await toggleBookmark(actor, { type: 'drama', id: seeded.dramaId });

    expect(await isBookmarked(actor, { type: 'drama', id: seeded.dramaId })).toBe(true);
  });

  it('reports no bookmark for an anonymous viewer', async () => {
    const seeded = await seed();

    expect(await isBookmarked(anonymousActor(), { type: 'drama', id: seeded.dramaId })).toBe(false);
  });

  it('refuses a drama that is not publicly available', async () => {
    const seeded = await seed();

    await db
      .update(dramas)
      .set({ publication_status: 'unpublished' })
      .where(eq(dramas.id, seeded.dramaId));

    await expect(
      toggleBookmark(userActor(seeded.userId), { type: 'drama', id: seeded.dramaId })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a movie that is not publicly available', async () => {
    const seeded = await seed();

    await db
      .update(movies)
      .set({ publication_status: 'draft' })
      .where(eq(movies.id, seeded.movieId));

    await expect(
      toggleBookmark(userActor(seeded.userId), { type: 'movie', id: seeded.movieId })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses an unknown item', async () => {
    const seeded = await seed();

    await expect(
      toggleBookmark(userActor(seeded.userId), { type: 'drama', id: randomUUID() })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses an anonymous viewer', async () => {
    const seeded = await seed();

    await expect(
      toggleBookmark(anonymousActor(), { type: 'drama', id: seeded.dramaId })
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});
