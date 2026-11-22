import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL required');
  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});
vi.mock('server-only', () => ({}));

import { eq, inArray, like } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { dramas, episodes, movies, seasons } from '@/modules/content/schema';
import { ratings, reviews } from '@/modules/reviews/schema';
import {
  bookmarks,
  playback_progress,
  watched_state,
  watch_history,
} from '@/modules/users/schema';
import { closePool } from '@/platform/db/pool';
import { createDrama } from '@/workflows/admin/dramas';
import { createEpisode } from '@/workflows/admin/episodes';
import { createSeason } from '@/workflows/admin/seasons';
import { runTrashCleanup } from '../../../scripts/trash-cleanup.mjs';

/**
 * Trash expiry command.
 *
 * The command is the only automatic permanent-deletion path, so it is proved
 * against the real database here: an expired hierarchy is removed with its
 * dependent records, an active row is never touched, a hierarchy whose child
 * has not expired yet is skipped, and the retention rules are the same ones
 * the admin surface applies.
 */

const TEST_SLUG_PREFIX = 'it-expiry-drama-';
const TEST_USER_PREFIX = 'it-expiry-user-';

/** 40 days in the past, so the row is older than the 30-day retention. */
const EXPIRED_AT = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

/** Five days in the past, so the row is still inside the retention period. */
const RECENT_AT = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

const managerActor = {
  userId: 'it-expiry-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.manage', 'season.manage', 'episode.manage', 'movie.manage'],
} as never;

function testSlug(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

async function seedDrama(label: string): Promise<string> {
  const created = await createDrama(managerActor, {
    title: `Expiry Drama ${label}`,
    slug: testSlug(label),
  });

  if (!created.ok) {
    throw new Error('Failed to seed drama');
  }

  return created.drama.id;
}

async function seedUser(): Promise<string> {
  const id = randomUUID();

  await db.insert(users).values({
    id,
    name: 'Expiry Viewer',
    email: `${TEST_USER_PREFIX}${id}@example.test`,
  });

  return id;
}

/** Trashes the drama and backdates the whole cascade. */
async function trashWithDate(dramaId: string, deletedAt: Date): Promise<void> {
  await db
    .update(dramas)
    .set({ deleted_at: deletedAt })
    .where(eq(dramas.id, dramaId));
  await db
    .update(seasons)
    .set({ deleted_at: deletedAt })
    .where(eq(seasons.drama_id, dramaId));
  await db
    .update(episodes)
    .set({ deleted_at: deletedAt })
    .where(eq(episodes.drama_id, dramaId));
}

async function cleanup(): Promise<void> {
  const dramaRows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_SLUG_PREFIX}%`));

  const dramaIds = dramaRows.map(row => row.id);

  if (dramaIds.length > 0) {
    await db.delete(movies).where(inArray(movies.converted_from_drama_id, dramaIds));
    await db.delete(ratings).where(inArray(ratings.drama_id, dramaIds));
    await db.delete(reviews).where(inArray(reviews.drama_id, dramaIds));
    await db.delete(bookmarks).where(inArray(bookmarks.drama_id, dramaIds));
    await db.delete(playback_progress).where(inArray(playback_progress.drama_id, dramaIds));
    await db.delete(watched_state).where(inArray(watched_state.drama_id, dramaIds));
    await db.delete(watch_history).where(inArray(watch_history.drama_id, dramaIds));
    await db.delete(episodes).where(inArray(episodes.drama_id, dramaIds));
    await db.delete(seasons).where(inArray(seasons.drama_id, dramaIds));
    await db.delete(dramas).where(inArray(dramas.id, dramaIds));
  }

  await db.delete(users).where(like(users.email, `${TEST_USER_PREFIX}%`));
}

function runCleanup(dryRun = false) {
  return runTrashCleanup({
    connectionString: process.env.DATABASE_URL,
    retentionDays: 30,
    batchSize: 100,
    dryRun,
    log: () => {},
  });
}

beforeEach(cleanup);
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('trash expiry command', () => {
  it('removes an expired hierarchy with its dependent records', async () => {
    const dramaId = await seedDrama('expired');
    const userId = await seedUser();

    const season = await createSeason(managerActor, dramaId, { title: 'Season 1' });
    const seasonId = season.ok ? season.season.id : '';

    const episode = await createEpisode(managerActor, dramaId, {
      title: 'Episode 1',
      season_id: seasonId,
    });
    const episodeId = episode.ok ? episode.episode.id : '';

    await db.insert(bookmarks).values({
      id: randomUUID(),
      user_id: userId,
      content_type: 'drama',
      content_id: dramaId,
      drama_id: dramaId,
    });
    await db.insert(playback_progress).values({
      id: randomUUID(),
      user_id: userId,
      content_type: 'drama',
      content_id: dramaId,
      drama_id: dramaId,
      episode_id: episodeId,
    });
    await db.insert(watched_state).values({
      id: randomUUID(),
      user_id: userId,
      content_type: 'drama',
      content_id: dramaId,
      drama_id: dramaId,
      episode_id: episodeId,
    });
    await db.insert(watch_history).values({
      id: randomUUID(),
      user_id: userId,
      content_type: 'drama',
      content_id: dramaId,
      drama_id: dramaId,
      episode_id: episodeId,
    });

    const ratingId = randomUUID();
    await db.insert(ratings).values({
      id: ratingId,
      user_id: userId,
      drama_id: dramaId,
      value: 5,
    });
    const reviewId = randomUUID();
    await db.insert(reviews).values({
      id: reviewId,
      user_id: userId,
      drama_id: dramaId,
      title: 'Great',
      content: 'Great series.',
    });

    await trashWithDate(dramaId, EXPIRED_AT);

    const report = await runCleanup();

    expect(report.failures).toHaveLength(0);
    expect(report.removed.some(entry => entry.id === dramaId)).toBe(true);

    const [dramaRow] = await db
      .select({ id: dramas.id })
      .from(dramas)
      .where(eq(dramas.id, dramaId));
    const [seasonRow] = await db
      .select({ id: seasons.id })
      .from(seasons)
      .where(eq(seasons.id, seasonId));
    const [episodeRow] = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.id, episodeId));

    expect(dramaRow).toBeUndefined();
    expect(seasonRow).toBeUndefined();
    expect(episodeRow).toBeUndefined();

    const personalRecords = await Promise.all([
      db.select({ id: bookmarks.id }).from(bookmarks).where(eq(bookmarks.drama_id, dramaId)),
      db
        .select({ id: playback_progress.id })
        .from(playback_progress)
        .where(eq(playback_progress.drama_id, dramaId)),
      db.select({ id: watched_state.id }).from(watched_state).where(eq(watched_state.drama_id, dramaId)),
      db.select({ id: watch_history.id }).from(watch_history).where(eq(watch_history.drama_id, dramaId)),
    ]);

    for (const records of personalRecords) {
      expect(records).toHaveLength(0);
    }

    const [ratingRow] = await db
      .select({
        userId: ratings.user_id,
        dramaId: ratings.drama_id,
        anonymizedAt: ratings.anonymized_at,
      })
      .from(ratings)
      .where(eq(ratings.id, ratingId));
    const [reviewRow] = await db
      .select({
        userId: reviews.user_id,
        dramaId: reviews.drama_id,
        anonymizedAt: reviews.anonymized_at,
      })
      .from(reviews)
      .where(eq(reviews.id, reviewId));

    expect(ratingRow?.userId).toBeNull();
    expect(ratingRow?.dramaId).toBeNull();
    expect(ratingRow?.anonymizedAt).not.toBeNull();
    expect(reviewRow?.userId).toBeNull();
    expect(reviewRow?.dramaId).toBeNull();
    expect(reviewRow?.anonymizedAt).not.toBeNull();
  });

  it('never touches active content', async () => {
    const dramaId = await seedDrama('active');

    const report = await runCleanup();

    expect(report.removed.some(entry => entry.id === dramaId)).toBe(false);

    const [dramaRow] = await db
      .select({ id: dramas.id, deletedAt: dramas.deleted_at })
      .from(dramas)
      .where(eq(dramas.id, dramaId));

    expect(dramaRow).toBeDefined();
    expect(dramaRow?.deletedAt).toBeNull();
  });

  it('skips a hierarchy whose child has not expired yet', async () => {
    const dramaId = await seedDrama('child-retained');

    const season = await createSeason(managerActor, dramaId, { title: 'Season 1' });
    const seasonId = season.ok ? season.season.id : '';

    const episode = await createEpisode(managerActor, dramaId, {
      title: 'Episode 1',
      season_id: seasonId,
    });
    const episodeId = episode.ok ? episode.episode.id : '';

    await db
      .update(dramas)
      .set({ deleted_at: EXPIRED_AT })
      .where(eq(dramas.id, dramaId));
    await db
      .update(seasons)
      .set({ deleted_at: EXPIRED_AT })
      .where(eq(seasons.id, seasonId));
    await db
      .update(episodes)
      .set({ deleted_at: RECENT_AT })
      .where(eq(episodes.id, episodeId));

    const report = await runCleanup();

    expect(report.removed.some(entry => entry.id === dramaId)).toBe(false);
    expect(report.skipped.some(entry => entry.id === dramaId)).toBe(true);

    const [episodeRow] = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.id, episodeId));

    expect(episodeRow).toBeDefined();
  });

  it('reports what a dry run would remove without removing it', async () => {
    const dramaId = await seedDrama('dry-run');

    await trashWithDate(dramaId, EXPIRED_AT);

    const report = await runCleanup(true);

    expect(report.dryRun).toBe(true);
    expect(report.removed.some(entry => entry.id === dramaId)).toBe(true);

    const [dramaRow] = await db
      .select({ id: dramas.id })
      .from(dramas)
      .where(eq(dramas.id, dramaId));

    expect(dramaRow).toBeDefined();
  });

  it('leaves a drama whose provenance is kept by a converted movie', async () => {
    const dramaId = await seedDrama('provenance');

    await trashWithDate(dramaId, EXPIRED_AT);

    const movieId = randomUUID();
    await db.insert(movies).values({
      id: movieId,
      title: `Converted ${randomUUID().slice(0, 6)}`,
      slug: `it-expiry-movie-${randomUUID().slice(0, 8)}`,
      converted_from_drama_id: dramaId,
    });

    try {
      const report = await runCleanup();

      expect(report.failures).toHaveLength(0);
      expect(report.removed.some(entry => entry.id === dramaId)).toBe(false);
      expect(report.skipped.some(entry => entry.id === dramaId)).toBe(true);

      const [dramaRow] = await db
        .select({ id: dramas.id })
        .from(dramas)
        .where(eq(dramas.id, dramaId));

      expect(dramaRow).toBeDefined();
    } finally {
      await db.delete(movies).where(eq(movies.id, movieId));
    }
  });
});
