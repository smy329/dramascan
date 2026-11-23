import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Playback-progress persistence integration coverage.
 *
 * A viewer's position is a resume point, not a log: one row per user and
 * episode, updated in place. The write has to be safe when two tabs or two
 * devices report at the same time — an update that was captured earlier must
 * never overwrite a newer one — and it has to mark the episode watched exactly
 * once the configured completion threshold is reached.
 *
 * These tests run against the real PostgreSQL test database.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for playback progress integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { anonymousActor, userActor } from '@/modules/authorization';
import { dramas, episodes, seasons } from '@/modules/content/schema';
import { savePlaybackProgress } from '@/modules/users/progress';
import { playback_progress, watch_history, watched_state } from '@/modules/users/schema';
import { AuthenticationError, NotFoundError } from '@/platform/errors';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-progress-';

/** The completion threshold the test expects the default configuration to use. */
const COMPLETION_THRESHOLD_PERCENT = 90;

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
    name: 'Progress tester',
    email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
  });

  await db.insert(dramas).values({
    id: dramaId,
    title: 'Progress drama',
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

describe('savePlaybackProgress', () => {
  it('stores the position and the duration of an episode', async () => {
    const seeded = await seed();

    const result = await savePlaybackProgress(
      userActor(seeded.userId),
      {
        episodeId: seeded.episodeId,
        positionSeconds: 120,
        durationSeconds: 1000,
        watchedAt: '2026-01-02T10:00:00.000Z',
      },
      { now: new Date('2026-01-02T10:00:05.000Z') }
    );

    expect(result.applied).toBe(true);

    const rows = await db
      .select()
      .from(playback_progress)
      .where(eq(playback_progress.episode_id, seeded.episodeId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.position).toBe(120);
    expect(rows[0]?.duration).toBe(1000);
    expect(rows[0]?.drama_id).toBe(seeded.dramaId);
    expect(rows[0]?.completed).toBe(false);
  });

  it('keeps one row per user and episode and updates it in place', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.userId);

    await savePlaybackProgress(
      actor,
      {
        episodeId: seeded.episodeId,
        positionSeconds: 120,
        durationSeconds: 1000,
        watchedAt: '2026-01-02T10:00:00.000Z',
      },
      { now: new Date('2026-01-02T10:00:05.000Z') }
    );

    await savePlaybackProgress(
      actor,
      {
        episodeId: seeded.episodeId,
        positionSeconds: 240,
        durationSeconds: 1000,
        watchedAt: '2026-01-02T10:01:00.000Z',
      },
      { now: new Date('2026-01-02T10:01:05.000Z') }
    );

    const rows = await db
      .select()
      .from(playback_progress)
      .where(eq(playback_progress.episode_id, seeded.episodeId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.position).toBe(240);
  });

  it('ignores an update that was observed before the stored one', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.userId);

    await savePlaybackProgress(
      actor,
      {
        episodeId: seeded.episodeId,
        positionSeconds: 600,
        durationSeconds: 1000,
        watchedAt: '2026-01-02T10:05:00.000Z',
      },
      { now: new Date('2026-01-02T10:05:05.000Z') }
    );

    const stale = await savePlaybackProgress(
      actor,
      {
        episodeId: seeded.episodeId,
        positionSeconds: 60,
        durationSeconds: 1000,
        watchedAt: '2026-01-02T10:01:00.000Z',
      },
      { now: new Date('2026-01-02T10:06:00.000Z') }
    );

    expect(stale.applied).toBe(false);

    const rows = await db
      .select()
      .from(playback_progress)
      .where(eq(playback_progress.episode_id, seeded.episodeId));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.position).toBe(600);
  });

  it('marks the episode watched once the completion threshold is met', async () => {
    const seeded = await seed();

    const position = Math.floor(1000 * COMPLETION_THRESHOLD_PERCENT / 100) + 10;

    const result = await savePlaybackProgress(
      userActor(seeded.userId),
      {
        episodeId: seeded.episodeId,
        positionSeconds: position,
        durationSeconds: 1000,
        watchedAt: '2026-01-02T10:05:00.000Z',
      },
      { now: new Date('2026-01-02T10:05:05.000Z') }
    );

    expect(result.thresholdMet).toBe(true);

    const progress = await db
      .select()
      .from(playback_progress)
      .where(eq(playback_progress.episode_id, seeded.episodeId));

    expect(progress[0]?.completed).toBe(true);

    const watched = await db
      .select()
      .from(watched_state)
      .where(eq(watched_state.episode_id, seeded.episodeId));

    expect(watched).toHaveLength(1);
    expect(watched[0]?.threshold_met).toBe(true);
    expect(watched[0]?.completed_at).not.toBeNull();
  });

  it('does not mark the episode watched below the completion threshold', async () => {
    const seeded = await seed();

    const result = await savePlaybackProgress(
      userActor(seeded.userId),
      {
        episodeId: seeded.episodeId,
        positionSeconds: 100,
        durationSeconds: 1000,
        watchedAt: '2026-01-02T10:00:00.000Z',
      },
      { now: new Date('2026-01-02T10:00:05.000Z') }
    );

    expect(result.thresholdMet).toBe(false);

    const watched = await db
      .select()
      .from(watched_state)
      .where(eq(watched_state.episode_id, seeded.episodeId));

    expect(watched).toHaveLength(1);
    expect(watched[0]?.threshold_met).toBe(false);
    expect(watched[0]?.completed_at).toBeNull();
  });

  it('keeps the first completion date when a later update arrives', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.userId);

    await savePlaybackProgress(
      actor,
      {
        episodeId: seeded.episodeId,
        positionSeconds: 950,
        durationSeconds: 1000,
        watchedAt: '2026-01-02T10:05:00.000Z',
      },
      { now: new Date('2026-01-02T10:05:05.000Z') }
    );

    const [first] = await db
      .select()
      .from(watched_state)
      .where(eq(watched_state.episode_id, seeded.episodeId));

    const firstCompletion = first?.completed_at;

    expect(firstCompletion).not.toBeNull();

    await savePlaybackProgress(
      actor,
      {
        episodeId: seeded.episodeId,
        positionSeconds: 980,
        durationSeconds: 1000,
        watchedAt: '2026-01-02T11:05:00.000Z',
      },
      { now: new Date('2026-01-02T11:05:05.000Z') }
    );

    const [second] = await db
      .select()
      .from(watched_state)
      .where(eq(watched_state.episode_id, seeded.episodeId));

    expect(second?.completed_at?.toISOString()).toBe(firstCompletion?.toISOString());
  });

  it('does not write a watch-history row', async () => {
    const seeded = await seed();

    await savePlaybackProgress(
      userActor(seeded.userId),
      {
        episodeId: seeded.episodeId,
        positionSeconds: 120,
        durationSeconds: 1000,
        watchedAt: '2026-01-02T10:00:00.000Z',
      },
      { now: new Date('2026-01-02T10:00:05.000Z') }
    );

    const history = await db
      .select()
      .from(watch_history)
      .where(eq(watch_history.episode_id, seeded.episodeId));

    expect(history).toHaveLength(0);
  });

  it('does not touch another episode', async () => {
    const seeded = await seed();

    await savePlaybackProgress(
      userActor(seeded.userId),
      {
        episodeId: seeded.otherEpisodeId,
        positionSeconds: 300,
        durationSeconds: 1000,
        watchedAt: '2026-01-02T10:00:00.000Z',
      },
      { now: new Date('2026-01-02T10:00:05.000Z') }
    );

    const rows = await db
      .select()
      .from(playback_progress)
      .where(eq(playback_progress.episode_id, seeded.episodeId));

    expect(rows).toHaveLength(0);
  });

  it('rejects an unknown episode', async () => {
    const seeded = await seed();

    await expect(
      savePlaybackProgress(
        userActor(seeded.userId),
        {
          episodeId: randomUUID(),
          positionSeconds: 120,
          durationSeconds: 1000,
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
          episodeId: seeded.episodeId,
          positionSeconds: 120,
          durationSeconds: 1000,
          watchedAt: '2026-01-02T10:00:00.000Z',
        },
        { now: new Date('2026-01-02T10:00:05.000Z') }
      )
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects a position that is not a number', async () => {
    const seeded = await seed();

    await expect(
      savePlaybackProgress(
        userActor(seeded.userId),
        {
          episodeId: seeded.episodeId,
          positionSeconds: 'not-a-number',
          durationSeconds: 1000,
          watchedAt: '2026-01-02T10:00:00.000Z',
        },
        { now: new Date('2026-01-02T10:00:05.000Z') }
      )
    ).rejects.toThrow();
  });
});
