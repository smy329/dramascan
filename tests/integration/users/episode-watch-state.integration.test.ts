import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Episode watch-state reset integration coverage.
 *
 * When an administrator replaces an episode's video source, the episode's
 * playback position is no longer meaningful: every viewer's progress has to
 * go back to the beginning and the episode has to read as unwatched. The
 * watch *history*, however, is a historical record of what somebody watched
 * and when, and must survive the replacement with its original dates.
 *
 * These tests run against the real PostgreSQL test database.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for watch-state integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { dramas, episodes, seasons } from '@/modules/content/schema';
import { resetEpisodeWatchState } from '@/modules/users/watch-state';
import { playback_progress, watch_history, watched_state } from '@/modules/users/schema';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-watch-state-';

type Seed = {
  userId: string;
  dramaId: string;
  episodeId: string;
  otherEpisodeId: string;
};

async function seed(): Promise<Seed> {
  const userId = randomUUID();
  const dramaId = randomUUID();
  const seasonId = randomUUID();
  const episodeId = randomUUID();
  const otherEpisodeId = randomUUID();

  await db.insert(users).values({
    id: userId,
    name: 'Watch state tester',
    email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
  });

  await db.insert(dramas).values({
    id: dramaId,
    title: 'Watch state drama',
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

  await db.insert(episodes).values([
    {
      id: episodeId,
      drama_id: dramaId,
      season_id: seasonId,
      title: 'Episode 1',
      episode_number: 1,
      position: 0,
      publication_status: 'published',
      video_source: 'https://media.example.com/episodes/1.mp4',
    },
    {
      id: otherEpisodeId,
      drama_id: dramaId,
      season_id: seasonId,
      title: 'Episode 2',
      episode_number: 2,
      position: 1,
      publication_status: 'published',
      video_source: 'https://media.example.com/episodes/2.mp4',
    },
  ]);

  return { userId, dramaId, episodeId, otherEpisodeId };
}

async function seedProgress(seeded: Seed): Promise<void> {
  await db.insert(playback_progress).values({
    user_id: seeded.userId,
    content_type: 'drama',
    content_id: seeded.dramaId,
    drama_id: seeded.dramaId,
    episode_id: seeded.episodeId,
    position: 512,
    duration: 2400,
    completed: true,
    last_watched_at: new Date('2026-01-02T03:04:05.000Z'),
  });

  await db.insert(watched_state).values({
    user_id: seeded.userId,
    content_type: 'drama',
    content_id: seeded.dramaId,
    drama_id: seeded.dramaId,
    episode_id: seeded.episodeId,
    watched_minutes: 40,
    threshold_met: true,
    last_watched_at: new Date('2026-01-02T03:04:05.000Z'),
    completed_at: new Date('2026-01-02T03:04:05.000Z'),
  });
}

async function seedHistory(seeded: Seed): Promise<void> {
  await db.insert(watch_history).values([
    {
      user_id: seeded.userId,
      content_type: 'drama',
      content_id: seeded.dramaId,
      drama_id: seeded.dramaId,
      episode_id: seeded.episodeId,
      watched_at: new Date('2026-01-01T10:00:00.000Z'),
      watch_duration: 42,
    },
    {
      user_id: seeded.userId,
      content_type: 'drama',
      content_id: seeded.dramaId,
      drama_id: seeded.dramaId,
      episode_id: seeded.episodeId,
      watched_at: new Date('2026-01-02T10:00:00.000Z'),
      watch_duration: 7,
    },
  ]);
}

async function cleanup(): Promise<void> {
  const rows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_PREFIX}%`));

  const dramaIds = rows.map(row => row.id);

  if (dramaIds.length > 0) {
    const episodeRows = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(inArray(episodes.drama_id, dramaIds));

    const episodeIds = episodeRows.map(row => row.id);

    if (episodeIds.length > 0) {
      await db.delete(playback_progress).where(inArray(playback_progress.episode_id, episodeIds));
      await db.delete(watched_state).where(inArray(watched_state.episode_id, episodeIds));
      await db.delete(watch_history).where(inArray(watch_history.episode_id, episodeIds));
      await db.delete(episodes).where(inArray(episodes.id, episodeIds));
    }

    await db.delete(seasons).where(inArray(seasons.drama_id, dramaIds));
    await db.delete(dramas).where(inArray(dramas.id, dramaIds));
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

describe('resetEpisodeWatchState', () => {
  it('resets the playback position to zero and clears the completed flag', async () => {
    const seeded = await seed();
    await seedProgress(seeded);

    const result = await resetEpisodeWatchState(seeded.episodeId);

    expect(result.progressRows).toBe(1);

    const [row] = await db
      .select()
      .from(playback_progress)
      .where(eq(playback_progress.episode_id, seeded.episodeId));

    expect(row?.position).toBe(0);
    expect(row?.completed).toBe(false);
  });

  it('marks the episode unwatched for every viewer', async () => {
    const seeded = await seed();
    await seedProgress(seeded);

    const result = await resetEpisodeWatchState(seeded.episodeId);

    expect(result.watchedRows).toBe(1);

    const [row] = await db
      .select()
      .from(watched_state)
      .where(eq(watched_state.episode_id, seeded.episodeId));

    expect(row?.threshold_met).toBe(false);
    expect(row?.watched_minutes).toBe(0);
    expect(row?.completed_at).toBeNull();
    expect(row?.completed_at_reset_at).not.toBeNull();
  });

  it('preserves the watch history and its historical dates', async () => {
    const seeded = await seed();
    await seedProgress(seeded);
    await seedHistory(seeded);

    await resetEpisodeWatchState(seeded.episodeId);

    const rows = await db
      .select({
        watchedAt: watch_history.watched_at,
        watchDuration: watch_history.watch_duration,
      })
      .from(watch_history)
      .where(eq(watch_history.episode_id, seeded.episodeId))
      .orderBy(watch_history.watched_at);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.watchedAt?.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(rows[1]?.watchedAt?.toISOString()).toBe('2026-01-02T10:00:00.000Z');
    expect(rows[0]?.watchDuration).toBe(42);
    expect(rows[1]?.watchDuration).toBe(7);
  });

  it('does not touch another episode', async () => {
    const seeded = await seed();

    await db.insert(playback_progress).values({
      user_id: seeded.userId,
      content_type: 'drama',
      content_id: seeded.dramaId,
      drama_id: seeded.dramaId,
      episode_id: seeded.otherEpisodeId,
      position: 120,
      duration: 2400,
      completed: true,
    });

    await resetEpisodeWatchState(seeded.episodeId);

    const [row] = await db
      .select()
      .from(playback_progress)
      .where(eq(playback_progress.episode_id, seeded.otherEpisodeId));

    expect(row?.position).toBe(120);
    expect(row?.completed).toBe(true);
  });

  it('is a no-op when no viewer has progress for the episode', async () => {
    const seeded = await seed();

    const result = await resetEpisodeWatchState(seeded.episodeId);

    expect(result).toEqual({ progressRows: 0, watchedRows: 0 });
  });
});
