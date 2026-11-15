import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for manual content publication.
 *
 * Uses the real PostgreSQL test database and the ordered SQL migrations. The
 * tests verify single and bulk publish/unpublish behavior, source gating,
 * hierarchy-aware public availability, trashed handling, duplicate reporting,
 * and authorization for dramas, seasons, episodes, and movies.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for publication workflow tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import type { ActorContext } from '@/modules/authorization';
import { AuthorizationError, ValidationError } from '@/platform/errors';
import { closePool } from '@/platform/db/pool';
import {
  dramas,
  episodes,
  movies,
  seasons,
} from '@/modules/content/schema';
import { updatePublication } from '@/workflows/admin/publication';
import { listSeasons } from '@/workflows/admin/seasons';
import { listEpisodes } from '@/workflows/admin/episodes';

const VALID_SOURCE = 'https://media.example.com/episodes/only.mp4';

const managerActor: ActorContext = {
  userId: 'it-pub-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.manage', 'season.manage', 'episode.manage', 'movie.manage'],
};

const readerActor: ActorContext = {
  userId: 'it-pub-reader',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.read', 'season.read', 'episode.read', 'movie.read'],
};

async function insertDrama(publicationStatus: 'draft' | 'published' = 'draft'): Promise<string> {
  const slug = `it-pub-drama-${randomUUID().slice(0, 8)}`;

  await db.insert(dramas).values({
    title: `Published drama ${slug}`,
    slug,
    publication_status: publicationStatus,
  });

  const [row] = await db.select().from(dramas).where(eq(dramas.slug, slug));
  if (!row) {
    throw new Error('Drama insert returned no row.');
  }

  return row.id;
}

async function insertSeason(dramaId: string, publicationStatus: 'draft' | 'published' = 'draft'): Promise<string> {
  const row = await db
    .insert(seasons)
    .values({
      drama_id: dramaId,
      title: `Season ${randomUUID().slice(0, 8)}`,
      position: 0,
      publication_status: publicationStatus,
    })
    .returning();

  if (!row[0]) {
    throw new Error('Season insert returned no row.');
  }

  return row[0].id;
}

async function insertEpisode(
  dramaId: string,
  seasonId: string | null,
  publicationStatus: 'draft' | 'published' | 'unpublished',
  videoSource: string | null
): Promise<string> {
  const row = await db
    .insert(episodes)
    .values({
      drama_id: dramaId,
      season_id: seasonId,
      title: `Episode ${randomUUID().slice(0, 8)}`,
      episode_number: 1,
      position: 0,
      publication_status: publicationStatus,
      video_source: videoSource,
    })
    .returning();

  if (!row[0]) {
    throw new Error('Episode insert returned no row.');
  }

  return row[0].id;
}

async function insertMovie(
  publicationStatus: 'draft' | 'published' | 'unpublished',
  videoSource: string | null
): Promise<string> {
  const slug = `it-pub-movie-${randomUUID().slice(0, 8)}`;

  await db.insert(movies).values({
    title: `Published movie ${slug}`,
    slug,
    publication_status: publicationStatus,
    video_source: videoSource,
  });

  const [row] = await db.select().from(movies).where(eq(movies.slug, slug));
  if (!row) {
    throw new Error('Movie insert returned no row.');
  }

  return row.id;
}

async function cleanup(): Promise<void> {
  const movieRows = await db.select({ id: movies.id }).from(movies).where(like(movies.slug, 'it-pub-%'));
  const dramaRows = await db.select({ id: dramas.id }).from(dramas).where(like(dramas.slug, 'it-pub-%'));

  if (movieRows.length > 0) {
    await db.delete(movies).where(inArray(movies.id, movieRows.map(row => row.id)));
  }

  if (dramaRows.length > 0) {
    const dramaIds = dramaRows.map(row => row.id);
    await db.delete(episodes).where(inArray(episodes.drama_id, dramaIds));
    await db.delete(seasons).where(inArray(seasons.drama_id, dramaIds));
    await db.delete(dramas).where(inArray(dramas.id, dramaIds));
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

describe('publication workflows', () => {
  it('publishes a draft drama and reports public availability', async () => {
    const dramaId = await insertDrama('draft');

    const result = await updatePublication(managerActor, {
      contentType: 'drama',
      action: 'publish',
      ids: [dramaId],
    });

    expect(result.contentType).toBe('drama');
    expect(result.action).toBe('publish');
    expect(result.summary).toEqual({ requested: 1, succeeded: 1, skipped: 0, failed: 0 });
    expect(result.results[0]).toMatchObject({
      id: dramaId,
      status: 'succeeded',
      reason: null,
      publicationStatus: 'published',
      publiclyAvailable: true,
    });

    const [row] = await db.select().from(dramas).where(eq(dramas.id, dramaId));
    expect(row?.publication_status).toBe('published');
  });

  it('unpublishes a published drama without changing its children', async () => {
    const dramaId = await insertDrama('published');
    const seasonId = await insertSeason(dramaId, 'published');
    const episodeId = await insertEpisode(dramaId, seasonId, 'published', VALID_SOURCE);

    const result = await updatePublication(managerActor, {
      contentType: 'drama',
      action: 'unpublish',
      ids: [dramaId],
    });

    expect(result.summary.succeeded).toBe(1);
    expect(result.results[0]).toMatchObject({
      id: dramaId,
      status: 'succeeded',
      publicationStatus: 'unpublished',
      publiclyAvailable: false,
    });

    const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
    const [episode] = await db.select().from(episodes).where(eq(episodes.id, episodeId));

    expect(season?.publication_status).toBe('published');
    expect(episode?.publication_status).toBe('published');
  });

  it('publishes a season from draft and reports ancestor-gated availability', async () => {
    const dramaId = await insertDrama('draft');
    const seasonId = await insertSeason(dramaId, 'draft');

    const result = await updatePublication(managerActor, {
      contentType: 'season',
      action: 'publish',
      ids: [seasonId],
    });

    expect(result.summary).toEqual({ requested: 1, succeeded: 1, skipped: 0, failed: 0 });
    expect(result.results[0]).toMatchObject({
      id: seasonId,
      status: 'succeeded',
      publicationStatus: 'published',
      publiclyAvailable: false,
    });

    const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
    expect(season?.publication_status).toBe('published');
  });

  it('publishes an episode with a valid source and gates availability on ancestors', async () => {
    const dramaId = await insertDrama('draft');
    const seasonId = await insertSeason(dramaId, 'published');
    const episodeId = await insertEpisode(dramaId, seasonId, 'draft', VALID_SOURCE);

    const result = await updatePublication(managerActor, {
      contentType: 'episode',
      action: 'publish',
      ids: [episodeId],
    });

    expect(result.summary.succeeded).toBe(1);
    expect(result.results[0]).toMatchObject({
      id: episodeId,
      status: 'succeeded',
      publicationStatus: 'published',
      publiclyAvailable: false,
    });
  });

  it('skips an episode without a source with reason missing_source', async () => {
    const dramaId = await insertDrama('draft');
    const seasonId = await insertSeason(dramaId, 'published');
    const episodeId = await insertEpisode(dramaId, seasonId, 'draft', null);

    const result = await updatePublication(managerActor, {
      contentType: 'episode',
      action: 'publish',
      ids: [episodeId],
    });

    expect(result.summary).toEqual({ requested: 1, succeeded: 0, skipped: 1, failed: 0 });
    expect(result.results[0]).toMatchObject({
      id: episodeId,
      status: 'skipped',
      reason: 'missing_source',
    });
  });

  it('skips an episode with a non-HTTPS source with reason invalid_source', async () => {
    const dramaId = await insertDrama('draft');
    const seasonId = await insertSeason(dramaId, 'published');
    const episodeId = await insertEpisode(dramaId, seasonId, 'draft', 'http://media.example.com/episodes/1.mp4');

    const result = await updatePublication(managerActor, {
      contentType: 'episode',
      action: 'publish',
      ids: [episodeId],
    });

    expect(result.results[0]).toMatchObject({
      id: episodeId,
      status: 'skipped',
      reason: 'invalid_source',
    });
  });

  it('skips an already published episode and an already unpublished drama', async () => {
    const dramaId = await insertDrama('published');
    const seasonId = await insertSeason(dramaId, 'published');
    const episodeId = await insertEpisode(dramaId, seasonId, 'published', VALID_SOURCE);

    const publishResult = await updatePublication(managerActor, {
      contentType: 'episode',
      action: 'publish',
      ids: [episodeId],
    });
    expect(publishResult.results[0]).toMatchObject({ status: 'skipped', reason: 'already_published' });

    const unpublishResult = await updatePublication(managerActor, {
      contentType: 'drama',
      action: 'unpublish',
      ids: [dramaId],
    });
    expect(unpublishResult.results[0]).toMatchObject({
      id: dramaId,
      status: 'succeeded',
      publicationStatus: 'unpublished',
    });

    const secondUnpublish = await updatePublication(managerActor, {
      contentType: 'drama',
      action: 'unpublish',
      ids: [dramaId],
    });
    expect(secondUnpublish.results[0]).toMatchObject({
      status: 'skipped',
      reason: 'already_unpublished',
    });
  });

  it('skips trashed content when publishing', async () => {
    const dramaId = await insertDrama('draft');
    const [row] = await db
      .update(dramas)
      .set({ deleted_at: new Date() })
      .where(eq(dramas.id, dramaId))
      .returning();

    expect(row).toBeDefined();
    const result = await updatePublication(managerActor, {
      contentType: 'drama',
      action: 'publish',
      ids: [dramaId],
    });

    expect(result.results[0]).toMatchObject({ status: 'skipped', reason: 'trashed' });
  });

  it('reports duplicates once and does not apply the operation twice', async () => {
    const dramaId = await insertDrama('draft');

    const result = await updatePublication(managerActor, {
      contentType: 'drama',
      action: 'publish',
      ids: [dramaId, dramaId],
    });

    expect(result.summary).toEqual({ requested: 2, succeeded: 1, skipped: 1, failed: 0 });
    expect(result.results.map(item => item.reason)).toEqual([null, 'duplicate_id']);
  });

  it('reports malformed ids as failed without blocking valid ids', async () => {
    const dramaId = await insertDrama('draft');

    const result = await updatePublication(managerActor, {
      contentType: 'drama',
      action: 'publish',
      ids: [dramaId, 'not-a-uuid'],
    });

    expect(result.summary).toEqual({ requested: 2, succeeded: 1, skipped: 0, failed: 1 });
    expect(result.results.find(item => item.id === 'not-a-uuid')).toMatchObject({
      status: 'failed',
      reason: 'invalid_id',
    });
  });

  it('publishes multiple eligible episodes and skips invalid ones', async () => {
    const dramaId = await insertDrama('draft');
    const seasonId = await insertSeason(dramaId, 'published');

    // Episode with valid source
    const validEp = await insertEpisode(dramaId, seasonId, 'draft', VALID_SOURCE);
    // Episode without source
    const noSourceEp = await insertEpisode(dramaId, seasonId, 'draft', null);
    // Episode with non-HTTPS source
    const badSourceEp = await insertEpisode(dramaId, seasonId, 'draft', 'http://example.com/e.mp4');

    const result = await updatePublication(managerActor, {
      contentType: 'episode',
      action: 'publish',
      ids: [validEp, noSourceEp, badSourceEp],
    });

    expect(result.summary).toEqual({ requested: 3, succeeded: 1, skipped: 2, failed: 0 });
    expect(result.results.some(r => r.status === 'succeeded')).toBe(true);
    expect(result.results.some(r => r.reason === 'missing_source')).toBe(true);
    expect(result.results.some(r => r.reason === 'invalid_source')).toBe(true);
  });

  it('unpublishes multiple eligible items', async () => {
    const publishedId = await insertDrama('published');
    await db
      .update(dramas)
      .set({ publication_status: 'published' })
      .where(eq(dramas.id, publishedId));

    const result = await updatePublication(managerActor, {
      contentType: 'drama',
      action: 'unpublish',
      ids: [publishedId],
    });

    expect(result.summary.succeeded).toBe(1);
    expect(result.results[0]!.publicationStatus).toBe('unpublished');

    // Now test bulk unpublish of duplicate IDs where item is already unpublished
    const result2 = await updatePublication(managerActor, {
      contentType: 'drama',
      action: 'unpublish',
      ids: [publishedId, publishedId],
    });

    // First item: already unpublished (status changed by first unpublish above)
    // Second item: duplicate ID ignored
    expect(result2.summary).toEqual({ requested: 2, succeeded: 0, skipped: 2, failed: 0 });
    expect(result2.results.map(r => r.reason)).toEqual(['already_unpublished', 'duplicate_id']);
  });

  it('publishes multiple movies: some with source, some without', async () => {
    const movieWithSource = await insertMovie('draft', VALID_SOURCE);
    const movieWithoutSource = await insertMovie('draft', null);

    const result = await updatePublication(managerActor, {
      contentType: 'movie',
      action: 'publish',
      ids: [movieWithSource, movieWithoutSource],
    });

    expect(result.summary).toEqual({ requested: 2, succeeded: 1, skipped: 1, failed: 0 });
    expect(result.results.find(r => r.status === 'succeeded')?.publicationStatus).toBe('published');
    expect(result.results.find(r => r.status === 'skipped')?.reason).toBe('missing_source');
  });

  it('reports mixed results for episodes with varying eligibility', async () => {
    const dramaId = await insertDrama('draft');
    const seasonId = await insertSeason(dramaId, 'published');

    // Episode with valid source
    const validEp = await insertEpisode(dramaId, seasonId, 'draft', VALID_SOURCE);
    // Episode without source
    const noSourceEp = await insertEpisode(dramaId, seasonId, 'draft', null);
    // Episode with non-HTTPS source
    const badSourceEp = await insertEpisode(dramaId, seasonId, 'draft', 'http://example.com/e.mp4');

    const result = await updatePublication(managerActor, {
      contentType: 'episode',
      action: 'publish',
      ids: [validEp, noSourceEp, badSourceEp],
    });

    expect(result.summary).toEqual({ requested: 3, succeeded: 1, skipped: 2, failed: 0 });
    expect(result.results.find(r => r.status === 'succeeded')?.reason).toBeNull();
    expect(result.results.find(r => r.reason === 'missing_source')?.id).toBe(noSourceEp);
    expect(result.results.find(r => r.reason === 'invalid_source')?.id).toBe(badSourceEp);
  });

  it('rejects an actor without the manage permission', async () => {
    const dramaId = await insertDrama('draft');

    await expect(
      updatePublication(readerActor, {
        contentType: 'drama',
        action: 'publish',
        ids: [dramaId],
      })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('lists seasons with ancestor-gated public availability', async () => {
    const draftDramaId = await insertDrama('draft');
    const draftSeasonId = await insertSeason(draftDramaId, 'published');
    const publishedDramaId = await insertDrama('published');
    const publishedSeasonId = await insertSeason(publishedDramaId, 'published');

    const listed = await listSeasons(managerActor, draftDramaId);
    expect(listed.ok).toBe(true);
    expect(listed.seasons).toHaveLength(1);
    expect(listed.seasons[0]).toMatchObject({
      id: draftSeasonId,
      publicationStatus: 'published',
      publiclyAvailable: false,
    });

    const publishedListed = await listSeasons(managerActor, publishedDramaId);
    expect(publishedListed.ok).toBe(true);
    expect(publishedListed.seasons).toHaveLength(1);
    expect(publishedListed.seasons[0]).toMatchObject({
      id: publishedSeasonId,
      publicationStatus: 'published',
      publiclyAvailable: true,
    });
  });

  it('lists episodes with ancestor-gated public availability', async () => {
    const dramaId = await insertDrama('draft');
    const seasonId = await insertSeason(dramaId, 'published');
    const episodeId = await insertEpisode(dramaId, seasonId, 'published', VALID_SOURCE);

    const listed = await listEpisodes(managerActor, dramaId, { publication_status: 'published' });

    expect(listed.ok).toBe(true);
    expect(listed.episodes).toHaveLength(1);
    expect(listed.episodes[0]).toMatchObject({
      id: episodeId,
      publicationStatus: 'published',
      publiclyAvailable: false,
    });
  });

  it('rejects a legacy episode publication status filter', async () => {
    const dramaId = await insertDrama('draft');

    await expect(listEpisodes(managerActor, dramaId, { publication_status: 'ongoing' })).rejects.toBeInstanceOf(
      ValidationError
    );
  });
});
