import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Movie playback-progress integration coverage.
 *
 * A standalone movie is its own content type: the viewer has one resume point
 * per movie, exactly like one per episode. The write has to behave the same
 * way — one row per user and movie, updated in place, the watched state moving
 * with the position, and a report for a movie that is not publicly playable
 * refused.
 *
 * These tests run against the real PostgreSQL test database.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for movie progress integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { anonymousActor, userActor } from '@/modules/authorization';
import { movies } from '@/modules/content/schema';
import { getMoviePlaybackState } from '@/modules/users/playback-state';
import { savePlaybackProgress } from '@/modules/users/progress';
import { playback_progress, watched_state } from '@/modules/users/schema';
import { closePool } from '@/platform/db/pool';
import { AuthenticationError, NotFoundError } from '@/platform/errors';

const TEST_PREFIX = 'it-movie-progress-';

type Seed = {
  userId: string;
  movieId: string;
};

async function seed(): Promise<Seed> {
  const userId = randomUUID();
  const movieId = randomUUID();

  await db.insert(users).values({
    id: userId,
    name: 'Movie progress tester',
    email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
  });

  await db.insert(movies).values({
    id: movieId,
    title: 'The Film',
    slug: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
    publication_status: 'published',
    video_source: 'https://media.example.com/movies/1.mp4',
  });

  return { userId, movieId };
}

async function cleanup(): Promise<void> {
  const rows = await db
    .select({ id: movies.id })
    .from(movies)
    .where(like(movies.slug, `${TEST_PREFIX}%`));

  const movieIds = rows.map(row => row.id);

  if (movieIds.length > 0) {
    await db.delete(playback_progress).where(inArray(playback_progress.movie_id, movieIds));
    await db.delete(watched_state).where(inArray(watched_state.movie_id, movieIds));
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

describe('savePlaybackProgress for a movie', () => {
  it('stores the position and the duration of a movie', async () => {
    const seeded = await seed();

    const result = await savePlaybackProgress(
      userActor(seeded.userId),
      {
        movieId: seeded.movieId,
        positionSeconds: 300,
        durationSeconds: 5400,
        watchedAt: '2026-01-02T10:00:00.000Z',
      },
      { now: new Date('2026-01-02T10:00:05.000Z') }
    );

    expect(result.applied).toBe(true);
    expect(result.thresholdMet).toBe(false);

    const rows = await db
      .select()
      .from(playback_progress)
      .where(eq(playback_progress.movie_id, seeded.movieId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.position).toBe(300);
    expect(rows[0]?.duration).toBe(5400);
    expect(rows[0]?.movie_id).toBe(seeded.movieId);
    expect(rows[0]?.drama_id).toBeNull();
    expect(rows[0]?.episode_id).toBeNull();
    expect(rows[0]?.content_type).toBe('movie');
  });

  it('keeps one row per user and movie and updates it in place', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.userId);

    await savePlaybackProgress(
      actor,
      {
        movieId: seeded.movieId,
        positionSeconds: 300,
        durationSeconds: 5400,
        watchedAt: '2026-01-02T10:00:00.000Z',
      },
      { now: new Date('2026-01-02T10:00:05.000Z') }
    );

    await savePlaybackProgress(
      actor,
      {
        movieId: seeded.movieId,
        positionSeconds: 900,
        durationSeconds: 5400,
        watchedAt: '2026-01-02T10:05:00.000Z',
      },
      { now: new Date('2026-01-02T10:05:05.000Z') }
    );

    const rows = await db
      .select()
      .from(playback_progress)
      .where(eq(playback_progress.movie_id, seeded.movieId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.position).toBe(900);
  });

  it('marks the movie watched once the completion threshold is met', async () => {
    const seeded = await seed();

    const result = await savePlaybackProgress(
      userActor(seeded.userId),
      {
        movieId: seeded.movieId,
        positionSeconds: 5000,
        durationSeconds: 5400,
        watchedAt: '2026-01-02T10:00:00.000Z',
      },
      { now: new Date('2026-01-02T10:00:05.000Z') }
    );

    expect(result.thresholdMet).toBe(true);

    const watched = await db
      .select()
      .from(watched_state)
      .where(eq(watched_state.movie_id, seeded.movieId));

    expect(watched).toHaveLength(1);
    expect(watched[0]?.threshold_met).toBe(true);
    expect(watched[0]?.completed_at).not.toBeNull();
  });

  it('exposes the stored state as the resume point', async () => {
    const seeded = await seed();

    await savePlaybackProgress(
      userActor(seeded.userId),
      {
        movieId: seeded.movieId,
        positionSeconds: 300,
        durationSeconds: 5400,
        watchedAt: '2026-01-02T10:00:00.000Z',
      },
      { now: new Date('2026-01-02T10:00:05.000Z') }
    );

    const state = await getMoviePlaybackState(seeded.userId, seeded.movieId);

    expect(state).toEqual({
      positionSeconds: 300,
      durationSeconds: 5400,
      watched: false,
    });
  });

  it('rejects a movie that is not publicly playable', async () => {
    const seeded = await seed();

    await db
      .update(movies)
      .set({ publication_status: 'unpublished' })
      .where(eq(movies.id, seeded.movieId));

    await expect(
      savePlaybackProgress(
        userActor(seeded.userId),
        {
          movieId: seeded.movieId,
          positionSeconds: 300,
          durationSeconds: 5400,
          watchedAt: '2026-01-02T10:00:00.000Z',
        },
        { now: new Date('2026-01-02T10:00:05.000Z') }
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an unknown movie', async () => {
    const seeded = await seed();

    await expect(
      savePlaybackProgress(
        userActor(seeded.userId),
        {
          movieId: randomUUID(),
          positionSeconds: 300,
          durationSeconds: 5400,
          watchedAt: '2026-01-02T10:00:00.000Z',
        },
        { now: new Date('2026-01-02T10:00:05.000Z') }
      )
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an anonymous viewer', async () => {
    const seeded = await seed();

    await expect(
      savePlaybackProgress(
        anonymousActor(),
        {
          movieId: seeded.movieId,
          positionSeconds: 300,
          durationSeconds: 5400,
          watchedAt: '2026-01-02T10:00:00.000Z',
        },
        { now: new Date('2026-01-02T10:00:05.000Z') }
      )
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});
