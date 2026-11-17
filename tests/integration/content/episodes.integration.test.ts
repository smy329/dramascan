import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for episode persistence (TEST-03, H-05, H-07, M-01).
 *
 * Runs against the real PostgreSQL test database through the real workflow
 * layer. The parent scope, numbering, ordering, and search predicates are all
 * asserted against stored rows, because every one of those guarantees is a
 * database property rather than a return value.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for episode integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { and, eq, isNull, like } from 'drizzle-orm';

import { db } from '@/db/client';
import type { ActorContext } from '@/modules/authorization';
import { dramas, episodes, seasons } from '@/modules/content/schema';
import { closePool } from '@/platform/db/pool';
import { createDrama } from '@/workflows/admin/dramas';
import {
  createEpisode,
  listEpisodes,
  renumberEpisodes,
  reorderEpisodes,
  updateEpisode,
} from '@/workflows/admin/episodes';
import { createSeason } from '@/workflows/admin/seasons';

const TEST_SLUG_PREFIX = 'it-episode-drama-';

const managerActor: ActorContext = {
  userId: 'it-episode-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.manage', 'season.manage', 'episode.manage'],
};

function testSlug(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

async function seedDrama(label: string): Promise<string> {
  const created = await createDrama(managerActor, {
    title: `Episode Drama ${label}`,
    slug: testSlug(label),
  });

  expect(created.ok).toBe(true);

  return created.ok ? created.drama.id : '';
}

async function seedEpisode(dramaId: string, input: Record<string, unknown> = {}): Promise<string> {
  const created = await createEpisode(managerActor, dramaId, {
    title: 'Episode',
    ...input,
  });

  expect(created.ok).toBe(true);

  return created.ok ? created.episode.id : '';
}

async function seedSeason(dramaId: string, title: string, position: number): Promise<string> {
  const created = await createSeason(managerActor, dramaId, { title, position });

  expect(created.ok).toBe(true);

  return created.ok ? created.season.id : '';
}

async function cleanup(): Promise<void> {
  const dramaRows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_SLUG_PREFIX}%`));

  for (const row of dramaRows) {
    await db.delete(episodes).where(eq(episodes.drama_id, row.id));
    await db.delete(seasons).where(eq(seasons.drama_id, row.id));
    await db.delete(dramas).where(eq(dramas.id, row.id));
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

describe('createEpisode numbering (H-07)', () => {
  it('assigns the next drama-wide number when the payload omits one', async () => {
    const dramaId = await seedDrama('auto-number');
    await seedEpisode(dramaId, { title: 'One' });
    await seedEpisode(dramaId, { title: 'Two' });

    const third = await createEpisode(managerActor, dramaId, { title: 'Three' });

    expect(third.ok && third.episode.episodeNumber).toBe(3);
  });

  it('rejects an explicit duplicate number in the same drama', async () => {
    const dramaId = await seedDrama('duplicate-number');
    await seedEpisode(dramaId, { episode_number: 1 });

    const created = await createEpisode(managerActor, dramaId, {
      title: 'Clash',
      episode_number: 1,
    });

    expect(created.ok).toBe(false);
    expect(created.ok === false && created.error).toMatchObject({ code: 'validation_error' });
  });

  it('allows the same number in a different drama', async () => {
    const firstDrama = await seedDrama('number-scope-a');
    const secondDrama = await seedDrama('number-scope-b');

    await seedEpisode(firstDrama, { episode_number: 4 });
    const second = await createEpisode(managerActor, secondDrama, {
      title: 'Four',
      episode_number: 4,
    });

    expect(second.ok).toBe(true);
  });

  it('assigns distinct numbers to concurrent creates in one drama', async () => {
    const dramaId = await seedDrama('concurrent-number');

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        createEpisode(managerActor, dramaId, { title: `Concurrent ${index}` })
      )
    );

    expect(results.every(result => result.ok)).toBe(true);

    const numbers = results
      .map(result => (result.ok ? result.episode.episodeNumber : null))
      .sort((left, right) => (left ?? 0) - (right ?? 0));

    expect(numbers).toEqual([1, 2, 3, 4, 5]);
  }, 30000);

  it('stores at most one active episode for a concurrently requested number', async () => {
    const dramaId = await seedDrama('concurrent-explicit');

    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        createEpisode(managerActor, dramaId, {
          title: `Explicit ${index}`,
          episode_number: 9,
        })
      )
    );

    expect(results.filter(result => result.ok)).toHaveLength(1);

    const stored = await db
      .select({ id: episodes.id })
      .from(episodes)
      .where(
        and(
          eq(episodes.drama_id, dramaId),
          eq(episodes.episode_number, 9),
          // Only active rows count: a trashed episode keeps its number for a
          // possible restore.
          isNull(episodes.deleted_at)
        )
      );

    expect(stored).toHaveLength(1);
  }, 30000);
});

describe('updateEpisode parent scope (H-05)', () => {
  it('rejects a number already used by a sibling episode in the same drama', async () => {
    const dramaId = await seedDrama('update-number');
    await seedEpisode(dramaId, { title: 'First', episode_number: 1 });
    const second = await seedEpisode(dramaId, { title: 'Second', episode_number: 2 });

    const updated = await updateEpisode(managerActor, second, { episode_number: 1 });

    expect(updated.ok).toBe(false);
    expect(updated.ok === false && updated.error).toMatchObject({ code: 'validation_error' });

    const [row] = await db
      .select({ number: episodes.episode_number })
      .from(episodes)
      .where(eq(episodes.id, second));

    expect(row?.number).toBe(2);
  });

  it('allows the episode to keep its own number', async () => {
    const dramaId = await seedDrama('update-own-number');
    const episode = await seedEpisode(dramaId, { title: 'Only', episode_number: 3 });

    const updated = await updateEpisode(managerActor, episode, {
      episode_number: 3,
      title: 'Retitled',
    });

    expect(updated.ok).toBe(true);
    expect(updated.ok && updated.episode).toMatchObject({ episodeNumber: 3, title: 'Retitled' });
  });

  it('scopes the duplicate check to the episode and drama it really belongs to', async () => {
    const firstDrama = await seedDrama('update-number-a');
    const secondDrama = await seedDrama('update-number-b');

    const first = await seedEpisode(firstDrama, { title: 'A one', episode_number: 1 });
    await seedEpisode(secondDrama, { title: 'B one', episode_number: 1 });
    await seedEpisode(secondDrama, { title: 'B two', episode_number: 2 });

    // Drama B already uses 2, but numbers are per drama: drama A's episode may
    // take 2 without colliding with drama B.
    const updated = await updateEpisode(managerActor, first, { episode_number: 2 });

    expect(updated.ok).toBe(true);
    expect(updated.ok && updated.episode.episodeNumber).toBe(2);
  });

  it('rejects a season that belongs to a different drama', async () => {
    const dramaId = await seedDrama('update-foreign-season');
    const otherDramaId = await seedDrama('update-other-drama');

    const episode = await seedEpisode(dramaId, { title: 'Homeless' });

    const otherSeason = await createSeason(managerActor, otherDramaId, {
      title: 'Other season',
      position: 0,
    });
    expect(otherSeason.ok).toBe(true);

    const updated = await updateEpisode(managerActor, episode, {
      season_id: otherSeason.ok ? otherSeason.season.id : '',
    });

    expect(updated.ok).toBe(false);
    expect(updated.ok === false && updated.error).toMatchObject({ code: 'not_found' });

    const [row] = await db
      .select({ seasonId: episodes.season_id })
      .from(episodes)
      .where(eq(episodes.id, episode));

    expect(row?.seasonId).toBeNull();
  });

  it('accepts a season that belongs to the same drama', async () => {
    const dramaId = await seedDrama('update-own-season');
    const season = await createSeason(managerActor, dramaId, { title: 'Own', position: 0 });
    const episode = await seedEpisode(dramaId, { title: 'Seasonless' });

    const updated = await updateEpisode(managerActor, episode, {
      season_id: season.ok ? season.season.id : '',
    });

    expect(updated.ok).toBe(true);

    const [row] = await db
      .select({ seasonId: episodes.season_id })
      .from(episodes)
      .where(eq(episodes.id, episode));

    expect(row?.seasonId).toBe(season.ok ? season.season.id : 'missing');
  });

  it('reports a missing episode as not found before validating the season', async () => {
    const updated = await updateEpisode(managerActor, '00000000-0000-7000-8000-000000000000', {
      season_id: '00000000-0000-7000-8000-000000000000',
    });

    expect(updated.ok).toBe(false);
    expect(updated.ok === false && updated.error).toMatchObject({ code: 'not_found' });
  });
});

describe('reorderEpisodes (H-07)', () => {
  it('rejects a duplicate episode id in the requested order', async () => {
    const dramaId = await seedDrama('reorder-duplicate');
    const first = await seedEpisode(dramaId, { title: 'First' });
    const second = await seedEpisode(dramaId, { title: 'Second' });

    const reordered = await reorderEpisodes(managerActor, dramaId, [first, first, second]);

    expect(reordered.ok).toBe(false);
    expect(reordered.ok === false && reordered.error).toMatchObject({ code: 'validation_error' });
  });

  it('persists the requested order', async () => {
    const dramaId = await seedDrama('reorder-persist');
    const first = await seedEpisode(dramaId, { title: 'First' });
    const second = await seedEpisode(dramaId, { title: 'Second' });
    const third = await seedEpisode(dramaId, { title: 'Third' });

    const reordered = await reorderEpisodes(managerActor, dramaId, [third, first, second]);

    expect(reordered).toEqual({ ok: true, episodesReordered: 3 });

    const listed = await listEpisodes(managerActor, dramaId, { sort: 'position', order: 'asc' });

    expect(listed.episodes.map(episode => episode.id)).toEqual([third, first, second]);
  });

  it('refuses an episode from another drama', async () => {
    const dramaId = await seedDrama('reorder-foreign');
    const otherDramaId = await seedDrama('reorder-foreign-other');

    const own = await seedEpisode(dramaId, { title: 'Own' });
    const foreign = await seedEpisode(otherDramaId, { title: 'Foreign' });

    const reordered = await reorderEpisodes(managerActor, dramaId, [own, foreign]);

    expect(reordered.ok).toBe(false);
    expect(reordered.ok === false && reordered.error).toMatchObject({ code: 'not_found' });
  });
});

describe('renumberEpisodes (H-07)', () => {
  it('numbers the episodes across the whole drama, season by season', async () => {
    const dramaId = await seedDrama('renumber-drama-wide');
    const firstSeason = await seedSeason(dramaId, 'First', 0);
    const secondSeason = await seedSeason(dramaId, 'Second', 1);

    await seedEpisode(dramaId, { title: 'S1E1', season_id: firstSeason });
    await seedEpisode(dramaId, { title: 'S1E2', season_id: firstSeason });
    await seedEpisode(dramaId, { title: 'S2E1', season_id: secondSeason });
    await seedEpisode(dramaId, { title: 'S2E2', season_id: secondSeason });

    const renumbered = await renumberEpisodes(managerActor, dramaId);

    expect(renumbered).toEqual({ ok: true, episodesModified: 4 });

    const rows = await db
      .select({ title: episodes.title, number: episodes.episode_number })
      .from(episodes)
      .where(eq(episodes.drama_id, dramaId));

    // The second season continues after the first one: episode numbers are
    // unique per drama, not per season.
    expect(rows.map(row => row.number).sort()).toEqual([1, 2, 3, 4]);
    expect(Object.fromEntries(rows.map(row => [row.title, row.number]))).toEqual({
      S1E1: 1,
      S1E2: 2,
      S2E1: 3,
      S2E2: 4,
    });
  });

  it('refuses a season-scoped renumber because the numbering is drama-wide', async () => {
    const dramaId = await seedDrama('renumber-season-scope');
    const seasonId = await seedSeason(dramaId, 'First', 0);
    await seedEpisode(dramaId, { title: 'S1E1', season_id: seasonId });

    const renumbered = await renumberEpisodes(managerActor, dramaId, seasonId);

    expect(renumbered.ok).toBe(false);
    expect(renumbered.ok === false && renumbered.error).toMatchObject({
      code: 'validation_error',
    });
  });
});

describe('listEpisodes search scope (M-01)', () => {
  it('does not return an episode from another drama whose number matches the search', async () => {
    const dramaId = await seedDrama('search-scope');
    const otherDramaId = await seedDrama('search-scope-other');

    await seedEpisode(dramaId, { title: 'Alpha', episode_number: 1 });
    await seedEpisode(otherDramaId, { title: 'Beta', episode_number: 7 });

    const listed = await listEpisodes(managerActor, dramaId, { search: '7' });

    expect(listed.total).toBe(0);
    expect(listed.episodes).toEqual([]);
  });

  it('does not return a soft-deleted episode whose number matches the search', async () => {
    const dramaId = await seedDrama('search-trash');
    const ghost = await seedEpisode(dramaId, { title: 'Ghost', episode_number: 7 });

    await db.update(episodes).set({ deleted_at: new Date() }).where(eq(episodes.id, ghost));

    const listed = await listEpisodes(managerActor, dramaId, { search: '7' });

    expect(listed.total).toBe(0);
    expect(listed.episodes).toEqual([]);
  });

  it('still matches a title in the same drama', async () => {
    const dramaId = await seedDrama('search-match');
    const match = await seedEpisode(dramaId, { title: 'Lantern Keeper' });
    await seedEpisode(dramaId, { title: 'Something Else' });

    const listed = await listEpisodes(managerActor, dramaId, { search: 'lantern' });

    expect(listed.episodes.map(episode => episode.id)).toEqual([match]);
  });
});
