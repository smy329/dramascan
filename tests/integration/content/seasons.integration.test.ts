import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for season persistence (TEST-03, M-02, H-06).
 *
 * Runs against the real PostgreSQL test database through the real workflow
 * layer, so every assertion is about stored rows rather than returned
 * placeholders.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for season integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, like } from 'drizzle-orm';
import { Client } from 'pg';

import { db } from '@/db/client';
import type { ActorContext } from '@/modules/authorization';
import { dramas, episodes, seasons } from '@/modules/content/schema';
import { closePool } from '@/platform/db/pool';
import { createDrama } from '@/workflows/admin/dramas';
import { createEpisode } from '@/workflows/admin/episodes';
import { createSeason, deleteSeason, listSeasons, updateSeason } from '@/workflows/admin/seasons';

const TEST_SLUG_PREFIX = 'it-season-drama-';

const managerActor: ActorContext = {
  userId: 'it-season-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.manage', 'season.manage', 'episode.manage'],
};

function testSlug(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

async function seedDrama(label: string): Promise<string> {
  const created = await createDrama(managerActor, {
    title: `Season Drama ${label}`,
    slug: testSlug(label),
  });

  expect(created.ok).toBe(true);

  return created.ok ? created.drama.id : '';
}

async function seedSeason(dramaId: string, label: string, position: number): Promise<string> {
  const created = await createSeason(managerActor, dramaId, {
    title: `Season ${label}`,
    position,
  });

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

describe('createSeason', () => {
  it('stores the season under its drama with the requested position', async () => {
    const dramaId = await seedDrama('create');

    const created = await createSeason(managerActor, dramaId, {
      title: 'Arrival',
      position: 3,
    });

    expect(created.ok).toBe(true);

    const [row] = await db
      .select()
      .from(seasons)
      .where(eq(seasons.id, created.ok ? created.season.id : ''));

    expect(row).toMatchObject({ drama_id: dramaId, title: 'Arrival', position: 3 });
  });

  it('rejects a duplicate position within the same drama', async () => {
    const dramaId = await seedDrama('duplicate');
    await seedSeason(dramaId, 'First', 0);

    const created = await createSeason(managerActor, dramaId, { title: 'Clash', position: 0 });

    expect(created.ok).toBe(false);
    expect(created.ok === false && created.error).toMatchObject({
      code: 'validation_error',
    });

    const listed = await listSeasons(managerActor, dramaId);
    expect(listed.total).toBe(1);
  });

  it('allows the same position in a different drama', async () => {
    const firstDrama = await seedDrama('scope-a');
    const secondDrama = await seedDrama('scope-b');

    await seedSeason(firstDrama, 'First', 0);
    const second = await createSeason(managerActor, secondDrama, { title: 'Second', position: 0 });

    expect(second.ok).toBe(true);
  });

  it('rejects a missing drama', async () => {
    const created = await createSeason(managerActor, '00000000-0000-7000-8000-000000000000', {
      title: 'Nowhere',
      position: 0,
    });

    expect(created.ok).toBe(false);
    expect(created.ok === false && created.error).toMatchObject({ code: 'not_found' });
  });
});

describe('updateSeason (M-02)', () => {
  it('rejects a position already taken by a sibling season in the same drama', async () => {
    const dramaId = await seedDrama('update-conflict');
    await seedSeason(dramaId, 'First', 0);
    const second = await seedSeason(dramaId, 'Second', 1);

    const updated = await updateSeason(managerActor, second, { position: 0 });

    expect(updated.ok).toBe(false);
    expect(updated.ok === false && updated.error).toMatchObject({ code: 'validation_error' });

    const rows = await db
      .select({ id: seasons.id, position: seasons.position })
      .from(seasons)
      .where(eq(seasons.drama_id, dramaId))
      .orderBy(seasons.position);

    expect(rows.map(row => row.position)).toEqual([0, 1]);
    expect(rows.find(row => row.id === second)?.position).toBe(1);
  });

  it('excludes the season itself from the conflict check', async () => {
    const dramaId = await seedDrama('update-self');
    const only = await seedSeason(dramaId, 'Only', 0);

    const updated = await updateSeason(managerActor, only, { position: 0, title: 'Renamed' });

    expect(updated.ok).toBe(true);
    expect(updated.ok && updated.season).toMatchObject({ title: 'Renamed', position: 0 });
  });

  it('allows a position that another drama already uses', async () => {
    const firstDrama = await seedDrama('update-cross-a');
    const secondDrama = await seedDrama('update-cross-b');

    await seedSeason(firstDrama, 'First', 0);
    const second = await seedSeason(secondDrama, 'Second', 5);

    const updated = await updateSeason(managerActor, second, { position: 0 });

    expect(updated.ok).toBe(true);
  });

  it('reports a missing season as not found', async () => {
    const updated = await updateSeason(managerActor, '00000000-0000-7000-8000-000000000000', {
      position: 1,
    });

    expect(updated.ok).toBe(false);
    expect(updated.ok === false && updated.error).toMatchObject({ code: 'not_found' });
  });

  it('only checks the position when the payload supplies one', async () => {
    const dramaId = await seedDrama('update-title-only');
    const first = await seedSeason(dramaId, 'First', 0);
    await seedSeason(dramaId, 'Second', 1);

    const updated = await updateSeason(managerActor, first, { title: 'Retitled' });

    expect(updated.ok).toBe(true);
    expect(updated.ok && updated.season).toMatchObject({ title: 'Retitled', position: 0 });
  });

  it('waits for the parent drama lock before it checks the position', async () => {
    const dramaId = await seedDrama('update-lock');
    const seasonId = await seedSeason(dramaId, 'Only', 0);

    // The position conflict check reads the sibling seasons of the drama, so it
    // must run under the drama lock. Without that lock two updates can read the
    // same free position at the same time and the second write reaches the
    // unique index as an unhandled database error.
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();

    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM dramas WHERE id = $1 FOR NO KEY UPDATE', [dramaId]);

      let settled = false;
      const pending = updateSeason(managerActor, seasonId, { position: 3 }).then(result => {
        settled = true;
        return result;
      });

      await new Promise(resolve => setTimeout(resolve, 300));

      expect(settled).toBe(false);

      await blocker.query('COMMIT');

      const result = await pending;

      expect(result.ok).toBe(true);
      expect(result.ok && result.season).toMatchObject({ position: 3 });
    } finally {
      await blocker.query('ROLLBACK').catch(() => {});
      await blocker.end();
    }
  });
});

describe('deleteSeason (H-06)', () => {
  it('trashes the season and its active episodes together, preserving membership', async () => {
    const dramaId = await seedDrama('delete');
    const seasonId = await seedSeason(dramaId, 'Doomed', 0);

    const first = await createEpisode(managerActor, dramaId, {
      title: 'Episode One',
      season_id: seasonId,
    });
    const second = await createEpisode(managerActor, dramaId, {
      title: 'Episode Two',
      season_id: seasonId,
    });
    const unseasoned = await createEpisode(managerActor, dramaId, { title: 'Unseasoned' });

    expect(first.ok && second.ok && unseasoned.ok).toBe(true);

    const firstId = first.ok ? first.episode.id : '';
    const secondId = second.ok ? second.episode.id : '';
    const unseasonedId = unseasoned.ok ? unseasoned.episode.id : '';

    const result = await deleteSeason(managerActor, seasonId);

    expect(result).toEqual({ ok: true, affectedEpisodes: 2 });

    const [seasonRow] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
    expect(seasonRow?.deleted_at).toBeInstanceOf(Date);

    const episodeRows = await db
      .select({ id: episodes.id, seasonId: episodes.season_id, deletedAt: episodes.deleted_at })
      .from(episodes)
      .where(eq(episodes.drama_id, dramaId));

    const trashed = episodeRows.filter(row => row.deletedAt !== null).map(row => row.id);
    expect(new Set(trashed)).toEqual(new Set([firstId, secondId]));

    // The parent relationship survives so restoring the season restores the
    // episode hierarchy instead of leaving orphaned episodes behind.
    expect(episodeRows.find(row => row.id === firstId)?.seasonId).toBe(seasonId);
    expect(episodeRows.find(row => row.id === unseasonedId)).toMatchObject({
      seasonId: null,
      deletedAt: null,
    });
  });

  it('counts only active episodes and leaves already-trashed episodes untouched', async () => {
    const dramaId = await seedDrama('delete-count');
    const seasonId = await seedSeason(dramaId, 'Counted', 0);

    const active = await createEpisode(managerActor, dramaId, {
      title: 'Active',
      season_id: seasonId,
    });
    const trashed = await createEpisode(managerActor, dramaId, {
      title: 'Already trashed',
      season_id: seasonId,
    });

    const activeId = active.ok ? active.episode.id : '';
    const trashedId = trashed.ok ? trashed.episode.id : '';

    const trashedAt = new Date('2020-01-01T00:00:00.000Z');
    await db.update(episodes).set({ deleted_at: trashedAt }).where(eq(episodes.id, trashedId));

    const result = await deleteSeason(managerActor, seasonId);

    expect(result).toEqual({ ok: true, affectedEpisodes: 1 });

    const [trashedRow] = await db
      .select({ deletedAt: episodes.deleted_at })
      .from(episodes)
      .where(eq(episodes.id, trashedId));

    expect(trashedRow?.deletedAt?.toISOString()).toBe(trashedAt.toISOString());

    const [activeRow] = await db
      .select({ deletedAt: episodes.deleted_at })
      .from(episodes)
      .where(eq(episodes.id, activeId));

    expect(activeRow?.deletedAt).toBeInstanceOf(Date);
  });

  it('does not touch episodes that belong to another season', async () => {
    const dramaId = await seedDrama('delete-isolation');
    const doomed = await seedSeason(dramaId, 'Doomed', 0);
    const kept = await seedSeason(dramaId, 'Kept', 1);

    const keptEpisode = await createEpisode(managerActor, dramaId, {
      title: 'Kept episode',
      season_id: kept,
    });

    await deleteSeason(managerActor, doomed);

    const [row] = await db
      .select({ deletedAt: episodes.deleted_at, seasonId: episodes.season_id })
      .from(episodes)
      .where(eq(episodes.id, keptEpisode.ok ? keptEpisode.episode.id : ''));

    expect(row).toMatchObject({ deletedAt: null, seasonId: kept });
  });

  it('changes nothing when the season does not exist', async () => {
    const dramaId = await seedDrama('delete-missing');
    const seasonId = await seedSeason(dramaId, 'Alive', 0);
    const episode = await createEpisode(managerActor, dramaId, {
      title: 'Still here',
      season_id: seasonId,
    });

    const result = await deleteSeason(managerActor, '00000000-0000-7000-8000-000000000000');

    expect(result.ok).toBe(false);
    expect(result.affectedEpisodes).toBe(0);

    const [episodeRow] = await db
      .select({ deletedAt: episodes.deleted_at })
      .from(episodes)
      .where(eq(episodes.id, episode.ok ? episode.episode.id : ''));

    expect(episodeRow?.deletedAt).toBeNull();
  });

  it('refuses to delete an already-trashed season a second time', async () => {
    const dramaId = await seedDrama('delete-twice');
    const seasonId = await seedSeason(dramaId, 'Once', 0);

    expect((await deleteSeason(managerActor, seasonId)).ok).toBe(true);
    const second = await deleteSeason(managerActor, seasonId);

    expect(second).toMatchObject({ ok: false, affectedEpisodes: 0 });
  });
});
