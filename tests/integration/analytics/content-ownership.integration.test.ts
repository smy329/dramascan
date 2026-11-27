import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Analytics content ownership integration coverage (D-090).
 *
 * The viewing-session table is the server's baseline of a viewing. It points
 * at a title, so it has to follow the title:
 *
 *   - when a drama becomes a movie, the baseline follows the new identity;
 *   - when a title is permanently deleted, its baselines go with it;
 *   - the Trash surface counts them, so the administrator sees the real
 *     consequences before confirming.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for the analytics content ownership tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { dramas, episodes, movies, seasons } from '@/modules/content/schema';
import {
  countPurgeImpact,
  moveContentReferences,
  purgeContentReferences,
} from '@/modules/analytics/content-ownership';
import { guest_sessions, playback_viewing_sessions } from '@/modules/analytics/schema';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-ownership-';

type Seed = {
  guestSessionId: string;
  dramaId: string;
  seasonId: string;
  episodeId: string;
  movieId: string;
};

async function seed(): Promise<Seed> {
  const guestSessionId = randomUUID();
  const dramaId = randomUUID();
  const seasonId = randomUUID();
  const episodeId = randomUUID();
  const movieId = randomUUID();

  await db.insert(guest_sessions).values({
    id: guestSessionId,
    session_id: `session-${TEST_PREFIX}${randomUUID()}`,
  });

  await db.insert(dramas).values({
    id: dramaId,
    title: 'Ownership drama',
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
    title: 'Ownership movie',
    slug: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
    publication_status: 'published',
    video_source: 'https://media.example.com/movies/1.mp4',
  });

  return { guestSessionId, dramaId, seasonId, episodeId, movieId };
}

async function cleanup(seeded: Seed): Promise<void> {
  await db
    .delete(playback_viewing_sessions)
    .where(
      inArray(playback_viewing_sessions.content_id, [seeded.dramaId, seeded.movieId])
    );
  await db.delete(guest_sessions).where(eq(guest_sessions.id, seeded.guestSessionId));
  await db.delete(episodes).where(eq(episodes.drama_id, seeded.dramaId));
  await db.delete(seasons).where(eq(seasons.drama_id, seeded.dramaId));
  await db.delete(dramas).where(eq(dramas.id, seeded.dramaId));
  await db.delete(movies).where(eq(movies.id, seeded.movieId));
}

async function insertViewingSession(
  seeded: Seed,
  values: {
    contentId: string;
    contentType: 'drama' | 'movie';
    dramaId: string | null;
    movieId: string | null;
    clientSessionKey: string;
  }
): Promise<void> {
  await db.insert(playback_viewing_sessions).values({
    guest_session_id: seeded.guestSessionId,
    content_id: values.contentId,
    content_type: values.contentType,
    drama_id: values.dramaId,
    movie_id: values.movieId,
    client_session_key: values.clientSessionKey,
    started_at: new Date('2026-11-26T10:00:00.000Z'),
    last_event_at: new Date('2026-11-26T10:01:00.000Z'),
    last_cumulative_watch_seconds: 60,
  });
}

describe('analytics content ownership', () => {
  let seeded: Seed;

  beforeEach(async () => {
    seeded = await seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
  });

  afterAll(async () => {
    await closePool();
  });

  it('moves the viewing sessions of a drama to the movie it became', async () => {
    await insertViewingSession(seeded, {
      contentId: seeded.dramaId,
      contentType: 'drama',
      dramaId: seeded.dramaId,
      movieId: null,
      clientSessionKey: 'tab-drama',
    });

    await db.transaction(async tx => moveContentReferences(tx, seeded.dramaId, seeded.movieId));

    const rows = await db
      .select({
        contentId: playback_viewing_sessions.content_id,
        contentType: playback_viewing_sessions.content_type,
        dramaId: playback_viewing_sessions.drama_id,
        movieId: playback_viewing_sessions.movie_id,
        lastCumulativeWatchSeconds: playback_viewing_sessions.last_cumulative_watch_seconds,
      })
      .from(playback_viewing_sessions)
      .where(eq(playback_viewing_sessions.guest_session_id, seeded.guestSessionId));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      contentId: seeded.movieId,
      contentType: 'movie',
      dramaId: null,
      movieId: seeded.movieId,
      // The baseline itself is kept: it is the watch time the server already
      // accounted for, and it still describes the same viewing.
      lastCumulativeWatchSeconds: 60,
    });
  });

  it('removes the viewing sessions of a title that is permanently deleted', async () => {
    await insertViewingSession(seeded, {
      contentId: seeded.dramaId,
      contentType: 'drama',
      dramaId: seeded.dramaId,
      movieId: null,
      clientSessionKey: 'tab-drama',
    });
    await insertViewingSession(seeded, {
      contentId: seeded.movieId,
      contentType: 'movie',
      dramaId: null,
      movieId: seeded.movieId,
      clientSessionKey: 'tab-movie',
    });

    const purged = await db.transaction(async tx =>
      purgeContentReferences(tx, 'drama', seeded.dramaId)
    );

    expect(purged.viewingSessions).toBe(1);

    const rows = await db
      .select({ contentId: playback_viewing_sessions.content_id })
      .from(playback_viewing_sessions)
      .where(eq(playback_viewing_sessions.guest_session_id, seeded.guestSessionId));

    expect(rows.map(row => row.contentId)).toEqual([seeded.movieId]);
  });

  it('counts the viewing sessions in the impact of a permanent deletion', async () => {
    await insertViewingSession(seeded, {
      contentId: seeded.dramaId,
      contentType: 'drama',
      dramaId: seeded.dramaId,
      movieId: null,
      clientSessionKey: 'tab-drama',
    });

    const impact = await countPurgeImpact(db, 'drama', seeded.dramaId);

    expect(impact.viewingSessions).toBe(1);
  });
});
