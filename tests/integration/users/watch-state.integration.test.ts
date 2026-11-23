import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Manual watched-state integration coverage.
 *
 * A viewer may mark an episode watched or unwatched by hand. The decision has
 * to move the stored progress with it: an episode that is marked unwatched
 * must not immediately become watched again because the stored position is
 * still at the end, and an episode that is marked watched has to read as
 * watched on every device.
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

import { eq, inArray, like, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { anonymousActor, userActor } from '@/modules/authorization';
import { dramas, episodes, seasons } from '@/modules/content/schema';
import { getEpisodePlaybackState } from '@/modules/users/playback-state';
import { savePlaybackProgress } from '@/modules/users/progress';
import { playback_progress, watched_state } from '@/modules/users/schema';
import { setEpisodeWatchedState } from '@/modules/users/watch-state';
import { closePool } from '@/platform/db/pool';
import { AuthenticationError, NotFoundError } from '@/platform/errors';

const TEST_PREFIX = 'it-watch-state-';

type Seed = {
  userId: string;
  dramaId: string;
  episodeId: string;
};

async function seed(): Promise<Seed> {
  const userId = randomUUID();
  const dramaId = randomUUID();
  const seasonId = randomUUID();
  const episodeId = randomUUID();

  await db.insert(users).values({
    id: userId,
    name: 'Watch-state tester',
    email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
  });

  await db.insert(dramas).values({
    id: dramaId,
    title: 'Watch-state drama',
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

  return { userId, dramaId, episodeId };
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
      await db.delete(episodes).where(inArray(episodes.id, episodeIds));
    }

    await db.delete(seasons).where(inArray(seasons.drama_id, dramaIds));
    await db.delete(dramas).where(inArray(dramas.id, dramaIds));
  }

  await db.delete(users).where(like(users.email, `${TEST_PREFIX}%`));
}

/**
 * Wait until a backend is waiting for a lock on the named table.
 *
 * The concurrency test has to know that one write has reached its first lock
 * before the other one starts, so the interleaving is fixed instead of
 * accidental. The database reports the waiting backend, so the test waits for
 * that condition instead of guessing with a sleep.
 */
async function waitForBlockedWrite(table: 'playback_progress' | 'watched_state'): Promise<void> {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const result = await db.execute(sql`
      select count(*)::int as count
      from pg_stat_activity
      where datname = current_database()
        and wait_event_type = 'Lock'
        and query like ${'%' + table + '%'}
    `);

    const count = Number(result.rows[0]?.count ?? 0);

    if (count > 0) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 25));
  }

  throw new Error(`No write is waiting for the ${table} lock.`);
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

describe('setEpisodeWatchedState', () => {
  it('marks an episode watched without a playback record', async () => {
    const seeded = await seed();

    const result = await setEpisodeWatchedState(
      userActor(seeded.userId),
      seeded.episodeId,
      true,
      { now: new Date('2026-01-02T10:00:00.000Z') }
    );

    expect(result.watched).toBe(true);

    const state = await getEpisodePlaybackState(seeded.userId, seeded.episodeId);

    expect(state?.watched).toBe(true);
  });

  it('keeps the first completion date of a manual change', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.userId);

    await setEpisodeWatchedState(actor, seeded.episodeId, true, {
      now: new Date('2026-01-02T10:00:00.000Z'),
    });

    const [first] = await db
      .select()
      .from(watched_state)
      .where(eq(watched_state.episode_id, seeded.episodeId));

    const firstCompletion = first?.completed_at;

    expect(firstCompletion).not.toBeNull();

    await setEpisodeWatchedState(actor, seeded.episodeId, true, {
      now: new Date('2026-01-03T10:00:00.000Z'),
    });

    const [second] = await db
      .select()
      .from(watched_state)
      .where(eq(watched_state.episode_id, seeded.episodeId));

    expect(second?.completed_at?.toISOString()).toBe(firstCompletion?.toISOString());
  });

  it('returns the position to the beginning when the episode is marked unwatched', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.userId);

    await savePlaybackProgress(
      actor,
      {
        episodeId: seeded.episodeId,
        positionSeconds: 950,
        durationSeconds: 1000,
        sourceVersion: 1,
        watchedAt: '2026-01-02T10:00:00.000Z',
      },
      { now: new Date('2026-01-02T10:00:05.000Z') }
    );

    const [before] = await db
      .select()
      .from(watched_state)
      .where(eq(watched_state.episode_id, seeded.episodeId));

    const firstCompletion = before?.completed_at;

    expect(firstCompletion).not.toBeNull();

    const result = await setEpisodeWatchedState(actor, seeded.episodeId, false, {
      now: new Date('2026-01-02T11:00:00.000Z'),
    });

    expect(result.watched).toBe(false);

    const state = await getEpisodePlaybackState(seeded.userId, seeded.episodeId);

    // The position is reset, so the next heartbeat cannot immediately mark the
    // episode watched again.
    expect(state?.positionSeconds).toBe(0);
    expect(state?.watched).toBe(false);

    const [row] = await db
      .select()
      .from(watched_state)
      .where(eq(watched_state.episode_id, seeded.episodeId));

    expect(row?.threshold_met).toBe(false);
    // The first completion date is never rewritten: the moment the episode was
    // first completed stays the moment it was first completed, and the reset
    // is recorded separately.
    expect(row?.completed_at?.toISOString()).toBe(firstCompletion?.toISOString());
    expect(row?.completed_at_reset_at).not.toBeNull();
  });

  it('keeps the episode unwatched when a report from before the decision arrives', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.userId);

    await savePlaybackProgress(
      actor,
      {
        episodeId: seeded.episodeId,
        positionSeconds: 950,
        durationSeconds: 1000,
        sourceVersion: 1,
        watchedAt: '2026-01-02T10:00:00.000Z',
      },
      { now: new Date('2026-01-02T10:00:05.000Z') }
    );

    await setEpisodeWatchedState(actor, seeded.episodeId, false, {
      now: new Date('2026-01-02T11:00:00.000Z'),
    });

    // A heartbeat that was already in flight when the viewer marked the
    // episode unwatched. It describes the position from before the decision,
    // so it is stale and must not restore the position or the completion.
    const inFlight = await savePlaybackProgress(
      actor,
      {
        episodeId: seeded.episodeId,
        positionSeconds: 950,
        durationSeconds: 1000,
        sourceVersion: 1,
        watchedAt: '2026-01-02T10:00:30.000Z',
      },
      { now: new Date('2026-01-02T11:00:05.000Z') }
    );

    expect(inFlight.applied).toBe(false);

    const state = await getEpisodePlaybackState(seeded.userId, seeded.episodeId);

    expect(state?.positionSeconds).toBe(0);
    expect(state?.watched).toBe(false);
  });

  it('does not deadlock when a playback report and a manual change overlap', async () => {
    const seeded = await seed();
    const actor = userActor(seeded.userId);

    // Both rows exist, so both writes can lock them.
    await savePlaybackProgress(
      actor,
      {
        episodeId: seeded.episodeId,
        positionSeconds: 300,
        durationSeconds: 1000,
        sourceVersion: 1,
        watchedAt: '2026-01-02T10:00:00.000Z',
      },
      { now: new Date('2026-01-02T10:00:05.000Z') }
    );

    // Hold the watched-state row so the two writes queue behind it and reach
    // their first lock in a fixed order.
    let release: () => void = () => {};
    const released = new Promise<void>(resolve => {
      release = resolve;
    });

    const blocker = db.transaction(async tx => {
      await tx
        .select({ id: watched_state.id })
        .from(watched_state)
        .where(eq(watched_state.episode_id, seeded.episodeId))
        .for('update');

      await released;
    });

    // The manual change starts first. It takes the progress row and then
    // waits for the watched-state row.
    const manual = setEpisodeWatchedState(actor, seeded.episodeId, false, {
      now: new Date('2026-01-02T11:00:00.000Z'),
    });

    await waitForBlockedWrite('watched_state');

    // The playback report starts while the manual change is waiting. It waits
    // for the progress row.
    const report = savePlaybackProgress(
      actor,
      {
        episodeId: seeded.episodeId,
        positionSeconds: 950,
        durationSeconds: 1000,
        sourceVersion: 1,
        watchedAt: '2026-01-02T12:00:00.000Z',
      },
      { now: new Date('2026-01-02T12:00:05.000Z') }
    );

    await waitForBlockedWrite('playback_progress');

    release();

    // Both writes finish. Two paths that lock the same rows in the same order
    // cannot deadlock, so neither one is rejected by the database.
    await expect(Promise.all([manual, report, blocker])).resolves.toBeDefined();

    // The newer observation wins, and the two rows agree with each other.
    const [progressRow] = await db
      .select()
      .from(playback_progress)
      .where(eq(playback_progress.episode_id, seeded.episodeId));

    const [watchedRow] = await db
      .select()
      .from(watched_state)
      .where(eq(watched_state.episode_id, seeded.episodeId));

    expect(progressRow?.position).toBe(950);
    expect(progressRow?.completed).toBe(true);
    expect(watchedRow?.threshold_met).toBe(true);
  });

  it('refuses an episode that is not publicly playable', async () => {
    const seeded = await seed();

    await db
      .update(episodes)
      .set({ publication_status: 'unpublished' })
      .where(eq(episodes.id, seeded.episodeId));

    await expect(
      setEpisodeWatchedState(userActor(seeded.userId), seeded.episodeId, true)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses an anonymous viewer', async () => {
    const seeded = await seed();

    await expect(
      setEpisodeWatchedState(anonymousActor(), seeded.episodeId, true)
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});
