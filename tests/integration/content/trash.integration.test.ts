import { randomUUID } from 'node:crypto';
import type { ActorContext } from '@/modules/authorization';
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
import { AuthorizationError, ConflictError, ValidationError } from '@/platform/errors';
import { createDrama, deleteDrama } from '@/workflows/admin/dramas';
import { createEpisode, deleteEpisode } from '@/workflows/admin/episodes';
import { createSeason } from '@/workflows/admin/seasons';
import { permanentDelete } from '@/workflows/admin/permanent-delete';
import { restoreDrama, restoreEpisode } from '@/workflows/admin/restore';

/**
 * Content Trash lifecycle.
 *
 * The three operations that make up the lifecycle are proved here against the
 * real database: the cascade that moves a hierarchy into the Trash, the
 * timestamp-matched restore, and the irreversible permanent deletion with its
 * data-retention rules.
 */

const TEST_SLUG_PREFIX = 'it-trash-drama-';
const TEST_MOVIE_PREFIX = 'it-trash-movie-';
const TEST_USER_PREFIX = 'it-trash-user-';

const managerActor = {
  userId: 'it-trash-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.manage', 'season.manage', 'episode.manage', 'movie.manage'],
} as unknown as ActorContext;

const superAdminActor = {
  userId: 'it-trash-super-admin',
  roles: [],
  isSuperAdmin: true,
  permissions: [],
} as unknown as ActorContext;

function testSlug(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

async function seedDrama(label: string): Promise<string> {
  const created = await createDrama(managerActor, {
    title: `Trash Drama ${label}`,
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
    name: 'Trash Viewer',
    email: `${TEST_USER_PREFIX}${id}@example.test`,
  });

  return id;
}

async function cleanup(): Promise<void> {
  const dramaRows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_SLUG_PREFIX}%`));

  const dramaIds = dramaRows.map(row => row.id);

  // A converted movie keeps a permanent reference to its source drama, so the
  // movie has to go first: the foreign key is `restrict` by design.
  if (dramaIds.length > 0) {
    await db.delete(movies).where(inArray(movies.converted_from_drama_id, dramaIds));
  }

  await db.delete(movies).where(like(movies.slug, `${TEST_MOVIE_PREFIX}%`));

  for (const dramaId of dramaIds) {
    await db.delete(ratings).where(eq(ratings.drama_id, dramaId));
    await db.delete(reviews).where(eq(reviews.drama_id, dramaId));
    await db.delete(bookmarks).where(eq(bookmarks.drama_id, dramaId));
    await db.delete(playback_progress).where(eq(playback_progress.drama_id, dramaId));
    await db.delete(watched_state).where(eq(watched_state.drama_id, dramaId));
    await db.delete(watch_history).where(eq(watch_history.drama_id, dramaId));
    await db.delete(episodes).where(eq(episodes.drama_id, dramaId));
    await db.delete(seasons).where(eq(seasons.drama_id, dramaId));
    await db.delete(dramas).where(eq(dramas.id, dramaId));
  }

  await db.delete(users).where(like(users.email, `${TEST_USER_PREFIX}%`));
}

beforeEach(cleanup);
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('drama Trash cascade', () => {
  it('trashes the drama, its seasons, and its episodes with one timestamp', async () => {
    const dramaId = await seedDrama('cascade');

    const season = await createSeason(managerActor, dramaId, { title: 'Season 1' });
    expect(season.ok).toBe(true);

    const episode = await createEpisode(managerActor, dramaId, {
      title: 'Episode 1',
      season_id: season.ok ? season.season.id : undefined,
    });
    expect(episode.ok).toBe(true);

    const result = await deleteDrama(managerActor, dramaId);

    expect(result.ok).toBe(true);
    expect(result.affectedSeasons).toBe(1);
    expect(result.affectedEpisodes).toBe(1);

    const [dramaRow] = await db
      .select({ deletedAt: dramas.deleted_at })
      .from(dramas)
      .where(eq(dramas.id, dramaId));
    const [seasonRow] = await db
      .select({ deletedAt: seasons.deleted_at })
      .from(seasons)
      .where(eq(seasons.drama_id, dramaId));
    const [episodeRow] = await db
      .select({ deletedAt: episodes.deleted_at })
      .from(episodes)
      .where(eq(episodes.drama_id, dramaId));

    expect(dramaRow?.deletedAt).not.toBeNull();
    expect(seasonRow?.deletedAt).not.toBeNull();
    expect(episodeRow?.deletedAt).not.toBeNull();
    expect(seasonRow?.deletedAt?.getTime()).toBe(dramaRow?.deletedAt?.getTime());
    expect(episodeRow?.deletedAt?.getTime()).toBe(dramaRow?.deletedAt?.getTime());
  });

  it('refuses to trash the same drama twice', async () => {
    const dramaId = await seedDrama('twice');

    expect((await deleteDrama(managerActor, dramaId)).ok).toBe(true);
    expect((await deleteDrama(managerActor, dramaId)).ok).toBe(false);
  });
});

describe('Trash restoration', () => {
  it('restores only the children that were trashed with the drama', async () => {
    const dramaId = await seedDrama('restore');

    const season = await createSeason(managerActor, dramaId, { title: 'Season 1' });
    const seasonId = season.ok ? season.season.id : '';

    const first = await createEpisode(managerActor, dramaId, {
      title: 'Episode 1',
      season_id: seasonId,
    });
    const second = await createEpisode(managerActor, dramaId, {
      title: 'Episode 2',
      season_id: seasonId,
    });

    const firstEpisodeId = first.ok ? first.episode.id : '';
    const secondEpisodeId = second.ok ? second.episode.id : '';

    // An episode trashed on its own keeps its own timestamp.
    expect((await deleteEpisode(managerActor, firstEpisodeId)).ok).toBe(true);
    await db
      .update(episodes)
      .set({ deleted_at: new Date('2026-01-01T00:00:00.000Z') })
      .where(eq(episodes.id, firstEpisodeId));

    expect((await deleteDrama(managerActor, dramaId)).ok).toBe(true);

    const result = await restoreDrama(managerActor, dramaId);

    expect(result.restoredSeasons).toBe(1);
    expect(result.restoredEpisodes).toBe(1);

    const episodeRows = await db
      .select({ id: episodes.id, deletedAt: episodes.deleted_at })
      .from(episodes)
      .where(eq(episodes.drama_id, dramaId));

    const restored = episodeRows.find(row => row.id === secondEpisodeId);
    const stillTrashed = episodeRows.find(row => row.id === firstEpisodeId);

    expect(restored?.deletedAt).toBeNull();
    expect(stillTrashed?.deletedAt).not.toBeNull();
  });

  it('refuses to restore an episode while its drama is still in the Trash', async () => {
    const dramaId = await seedDrama('restore-order');

    const episode = await createEpisode(managerActor, dramaId, { title: 'Episode 1' });
    const episodeId = episode.ok ? episode.episode.id : '';

    expect((await deleteDrama(managerActor, dramaId)).ok).toBe(true);

    await expect(restoreEpisode(managerActor, episodeId)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('permanent deletion', () => {
  it('refuses a non-Super-Admin actor', async () => {
    const dramaId = await seedDrama('not-super');
    expect((await deleteDrama(managerActor, dramaId)).ok).toBe(true);

    await expect(permanentDelete(managerActor, 'drama', dramaId)).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it('refuses content that is not in the Trash', async () => {
    const dramaId = await seedDrama('not-trashed');

    await expect(permanentDelete(superAdminActor, 'drama', dramaId)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('removes the hierarchy and the personal records, and anonymizes the ratings and reviews', async () => {
    const dramaId = await seedDrama('permanent');
    const userId = await seedUser();

    const season = await createSeason(managerActor, dramaId, { title: 'Season 1' });
    const seasonId = season.ok ? season.season.id : '';

    const episode = await createEpisode(managerActor, dramaId, {
      title: 'Episode 1',
      season_id: seasonId,
    });
    const episodeId = episode.ok ? episode.episode.id : '';

    await db.insert(bookmarks).values({
      user_id: userId,
      content_type: 'drama',
      content_id: dramaId,
      drama_id: dramaId,
    });
    await db.insert(playback_progress).values({
      user_id: userId,
      content_type: 'drama',
      content_id: dramaId,
      drama_id: dramaId,
      episode_id: episodeId,
      position: 10,
    });
    await db.insert(watched_state).values({
      user_id: userId,
      content_type: 'drama',
      content_id: dramaId,
      drama_id: dramaId,
      episode_id: episodeId,
      watched_minutes: 20,
    });
    await db.insert(watch_history).values({
      user_id: userId,
      content_type: 'drama',
      content_id: dramaId,
      drama_id: dramaId,
      episode_id: episodeId,
      watch_duration: 20,
    });
    const [rating] = await db
      .insert(ratings)
      .values({
        user_id: userId,
        drama_id: dramaId,
        value: 4,
      })
      .returning({ id: ratings.id });
    const [review] = await db
      .insert(reviews)
      .values({
        user_id: userId,
        drama_id: dramaId,
        title: 'A review',
        content: 'The review text is retained for aggregate analytics.',
      })
      .returning({ id: reviews.id });

    expect((await deleteDrama(managerActor, dramaId)).ok).toBe(true);

    const impact = await permanentDelete(superAdminActor, 'drama', dramaId);

    expect(impact.seasons).toBe(1);
    expect(impact.episodes).toBe(1);
    expect(impact.bookmarks).toBe(1);
    expect(impact.playbackProgress).toBe(1);
    expect(impact.ratings).toBe(1);
    expect(impact.reviews).toBe(1);

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

    const [bookmarkRow] = await db
      .select({ id: bookmarks.id })
      .from(bookmarks)
      .where(eq(bookmarks.drama_id, dramaId));
    const [progressRow] = await db
      .select({ id: playback_progress.id })
      .from(playback_progress)
      .where(eq(playback_progress.drama_id, dramaId));
    const [watchedRow] = await db
      .select({ id: watched_state.id })
      .from(watched_state)
      .where(eq(watched_state.drama_id, dramaId));
    const [historyRow] = await db
      .select({ id: watch_history.id })
      .from(watch_history)
      .where(eq(watch_history.drama_id, dramaId));

    expect(bookmarkRow).toBeUndefined();
    expect(progressRow).toBeUndefined();
    expect(watchedRow).toBeUndefined();
    expect(historyRow).toBeUndefined();

    const [ratingRow] = await db
      .select({
        userId: ratings.user_id,
        dramaId: ratings.drama_id,
        value: ratings.value,
        anonymizedAt: ratings.anonymized_at,
      })
      .from(ratings)
      .where(eq(ratings.id, rating!.id));
    const [reviewRow] = await db
      .select({
        userId: reviews.user_id,
        dramaId: reviews.drama_id,
        content: reviews.content,
        anonymizedAt: reviews.anonymized_at,
      })
      .from(reviews)
      .where(eq(reviews.id, review!.id));

    expect(ratingRow?.userId).toBeNull();
    expect(ratingRow?.dramaId).toBeNull();
    expect(ratingRow?.anonymizedAt).not.toBeNull();
    expect(ratingRow?.value).toBe(4);
    expect(reviewRow?.userId).toBeNull();
    expect(reviewRow?.dramaId).toBeNull();
    expect(reviewRow?.anonymizedAt).not.toBeNull();
    expect(reviewRow?.content).toContain('aggregate analytics');
  });

  it('refuses to delete a drama that was converted into a movie', async () => {
    const dramaId = await seedDrama('provenance');

    await db.insert(movies).values({
      title: 'Converted Movie',
      slug: `${TEST_MOVIE_PREFIX}${randomUUID().slice(0, 8)}`,
      converted_from_drama_id: dramaId,
    });

    expect((await deleteDrama(managerActor, dramaId)).ok).toBe(true);

    await expect(permanentDelete(superAdminActor, 'drama', dramaId)).rejects.toBeInstanceOf(
      ConflictError
    );
  });
});
