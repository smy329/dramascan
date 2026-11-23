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
import { dramas, episodes, movies, seasons } from '@/modules/content/schema';
import { closePool } from '@/platform/db/pool';
import { AuthorizationError } from '@/platform/errors';
import { createDrama } from '@/workflows/admin/dramas';
import { createEpisode } from '@/workflows/admin/episodes';
import { createSeason } from '@/workflows/admin/seasons';
import { listTrashItems, parseTrashListQuery } from '@/workflows/admin/trash';

/**
 * Trash listing.
 *
 * The Trash merges four content types into one list. The listing is proved
 * against the real database here: the merged order, the search filter, the
 * server-side pagination, the per-type filter, and the permission boundary.
 *
 * The merged list is a *global* read: it contains every trashed row in the
 * database, not only the rows this file created. The integration suite shares
 * one database and runs its files in parallel, so another file can trash a row
 * while this file reads the list. Every read below is therefore scoped with a
 * token that only this test's own rows carry. The assertions stay exactly as
 * strong — the merged list still has to contain all four content types in
 * Trash-date order — but they no longer depend on what another file does at
 * the same moment.
 */

const TEST_SLUG_PREFIX = 'it-trash-list-drama-';
const TEST_MOVIE_PREFIX = 'it-trash-list-movie-';

/** A token that appears in the title of this test's own rows and nowhere else. */
function testToken(label: string): string {
  return `tl-${label}-${randomUUID().slice(0, 8)}`;
}

const managerActor = {
  userId: 'it-trash-list-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.manage', 'season.manage', 'episode.manage', 'movie.manage'],
} as unknown as ActorContext;

const dramaOnlyActor = {
  userId: 'it-trash-list-drama-only',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.manage'],
} as unknown as ActorContext;

const viewerActor = {
  userId: 'it-trash-list-viewer',
  roles: [],
  isSuperAdmin: false,
  permissions: [],
} as unknown as ActorContext;

function testSlug(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

function testMovieSlug(label: string): string {
  return `${TEST_MOVIE_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

async function seedDrama(label: string): Promise<string> {
  const created = await createDrama(managerActor, {
    title: `Trash List Drama ${label}`,
    slug: testSlug(label),
  });

  if (!created.ok) {
    throw new Error('Failed to seed drama');
  }

  return created.drama.id;
}

async function seedMovie(label: string): Promise<string> {
  const id = randomUUID();

  await db.insert(movies).values({
    id,
    title: `Trash List Movie ${label}`,
    slug: testMovieSlug(label),
  });

  return id;
}

/** Trashes a row with an exact timestamp, so the merged order is predictable. */
async function trashAt(table: 'dramas' | 'seasons' | 'episodes' | 'movies', id: string, deletedAt: Date) {
  const row = { dramas, seasons, episodes, movies }[table];

  await db.update(row).set({ deleted_at: deletedAt }).where(eq(row.id, id));
}

async function cleanup(): Promise<void> {
  const dramaRows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_SLUG_PREFIX}%`));

  const dramaIds = dramaRows.map(row => row.id);

  if (dramaIds.length > 0) {
    await db.delete(movies).where(inArray(movies.converted_from_drama_id, dramaIds));
    await db.delete(episodes).where(inArray(episodes.drama_id, dramaIds));
    await db.delete(seasons).where(inArray(seasons.drama_id, dramaIds));
    await db.delete(dramas).where(inArray(dramas.id, dramaIds));
  }

  await db.delete(movies).where(like(movies.slug, `${TEST_MOVIE_PREFIX}%`));
}

beforeEach(cleanup);
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('listTrashItems', () => {
  it('merges the four content types in one list ordered by the Trash date', async () => {
    const token = testToken('merged');

    const dramaId = await seedDrama(token);
    const season = await createSeason(managerActor, dramaId, {
      title: `Merged Season ${token}`,
    });
    const seasonId = season.ok ? season.season.id : '';
    const episode = await createEpisode(managerActor, dramaId, {
      title: `Merged Episode ${token}`,
      season_id: seasonId,
    });
    const episodeId = episode.ok ? episode.episode.id : '';
    const movieId = await seedMovie(token);

    await trashAt('dramas', dramaId, new Date('2026-01-01T00:00:00.000Z'));
    await trashAt('seasons', seasonId, new Date('2026-01-04T00:00:00.000Z'));
    await trashAt('episodes', episodeId, new Date('2026-01-02T00:00:00.000Z'));
    await trashAt('movies', movieId, new Date('2026-01-03T00:00:00.000Z'));

    const result = await listTrashItems(
      managerActor,
      parseTrashListQuery({ type: 'all', search: token })
    );

    expect(result.total).toBe(4);
    expect(result.items.map(item => item.contentType)).toEqual([
      'season',
      'movie',
      'episode',
      'drama',
    ]);
    expect(result.items.map(item => item.id)).toEqual([seasonId, movieId, episodeId, dramaId]);
  });

  it('reports the parent title and the trashed child counts of a drama', async () => {
    const token = testToken('children');

    const dramaId = await seedDrama(token);
    const season = await createSeason(managerActor, dramaId, {
      title: `Child Season ${token}`,
    });
    const seasonId = season.ok ? season.season.id : '';
    const episode = await createEpisode(managerActor, dramaId, {
      title: `Child Episode ${token}`,
      season_id: seasonId,
    });
    const episodeId = episode.ok ? episode.episode.id : '';

    await trashAt('dramas', dramaId, new Date('2026-01-01T00:00:00.000Z'));
    await trashAt('seasons', seasonId, new Date('2026-01-01T00:00:00.000Z'));
    await trashAt('episodes', episodeId, new Date('2026-01-01T00:00:00.000Z'));

    const result = await listTrashItems(
      managerActor,
      parseTrashListQuery({ type: 'drama', search: token })
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.childCounts).toEqual({ seasons: 1, episodes: 1 });
    expect(result.items[0]?.parentTitle).toBeNull();

    const seasonResult = await listTrashItems(
      managerActor,
      parseTrashListQuery({ type: 'season', search: token })
    );

    expect(seasonResult.items[0]?.parentTitle).toBe(`Trash List Drama ${token}`);
    expect(seasonResult.items[0]?.childCounts).toEqual({ seasons: 0, episodes: 1 });
  });

  it('filters the merged list by the search term', async () => {
    const token = testToken('searchable');

    const dramaId = await seedDrama(token);
    const movieId = await seedMovie('other');

    await trashAt('dramas', dramaId, new Date('2026-01-01T00:00:00.000Z'));
    await trashAt('movies', movieId, new Date('2026-01-02T00:00:00.000Z'));

    const result = await listTrashItems(
      managerActor,
      parseTrashListQuery({ type: 'all', search: token })
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe(dramaId);
  });

  it('pages the merged list in the database', async () => {
    const token = testToken('paged');

    const dramaId = await seedDrama(token);
    const movieId = await seedMovie(token);

    await trashAt('dramas', dramaId, new Date('2026-01-01T00:00:00.000Z'));
    await trashAt('movies', movieId, new Date('2026-01-02T00:00:00.000Z'));

    const firstPage = await listTrashItems(
      managerActor,
      parseTrashListQuery({ type: 'all', search: token, page: 1, pageSize: 1 })
    );

    expect(firstPage.total).toBe(2);
    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.hasNextPage).toBe(true);
    expect(firstPage.hasPreviousPage).toBe(false);
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]?.id).toBe(movieId);

    const secondPage = await listTrashItems(
      managerActor,
      parseTrashListQuery({ type: 'all', search: token, page: 2, pageSize: 1 })
    );

    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.id).toBe(dramaId);
    expect(secondPage.hasNextPage).toBe(false);
    expect(secondPage.hasPreviousPage).toBe(true);
  });

  it('shows only the requested content type', async () => {
    const token = testToken('typed');

    const dramaId = await seedDrama(token);
    const movieId = await seedMovie(token);

    await trashAt('dramas', dramaId, new Date('2026-01-01T00:00:00.000Z'));
    await trashAt('movies', movieId, new Date('2026-01-02T00:00:00.000Z'));

    const result = await listTrashItems(
      managerActor,
      parseTrashListQuery({ type: 'movie', search: token })
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe(movieId);
  });

  it('never shows a content type the actor may not manage', async () => {
    const token = testToken('permission');

    const dramaId = await seedDrama(token);
    const movieId = await seedMovie(token);

    await trashAt('dramas', dramaId, new Date('2026-01-01T00:00:00.000Z'));
    await trashAt('movies', movieId, new Date('2026-01-02T00:00:00.000Z'));

    const result = await listTrashItems(
      dramaOnlyActor,
      parseTrashListQuery({ type: 'all', search: token })
    );

    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe(dramaId);

    await expect(
      listTrashItems(dramaOnlyActor, parseTrashListQuery({ type: 'movie', search: token }))
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('refuses an actor without any content management permission', async () => {
    await expect(
      listTrashItems(viewerActor, parseTrashListQuery({ type: 'all' }))
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
