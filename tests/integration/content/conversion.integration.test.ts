import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for drama structure conversion.
 *
 * Uses the real PostgreSQL test database and ordered migrations. It verifies
 * the domain rules, the fingerprint guard, the snapshot lifecycle, stale
 * snapshot rejection, trashed-row isolation, authorization, and rollback.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for conversion integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { and, eq, inArray, isNull, like } from 'drizzle-orm';

import { db } from '@/db/client';
import type { ActorContext } from '@/modules/authorization';
import {
  dramas,
  episodes,
  seasons,
  structureConversionSnapshots,
} from '@/modules/content/schema';
import { playback_progress } from '@/modules/users/schema';
import { computeStructureFingerprint } from '@/modules/content/conversion';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/platform/errors';
import { closePool } from '@/platform/db/pool';
import {
  applyConversion,
  listConversionCandidates,
  loadConversionContext,
  previewConversion,
} from '@/workflows/admin/conversion';

const TEST_SLUG_PREFIX = 'it-conv-wf-';

const anonymousActor: ActorContext = {
  userId: null,
  roles: [],
  isSuperAdmin: false,
  permissions: [],
};

const readerActor: ActorContext = {
  userId: 'it-conv-reader',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.read'],
};

const seasonOnlyActor: ActorContext = {
  userId: 'it-conv-season-only',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['season.manage', 'episode.manage'],
};

const managerActor: ActorContext = {
  userId: 'it-conv-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.manage'],
};

function testSlug(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

async function insertDrama(
  label: string,
  structureType: 'flat' | 'season_based' = 'season_based'
) {
  const [row] = await db
    .insert(dramas)
    .values({ title: `Test ${label}`, slug: testSlug(label), structure_type: structureType })
    .returning();

  if (!row) {
    throw new Error('Drama insert returned no row.');
  }

  return row;
}

async function insertSeason(dramaId: string, title: string, position: number | null = 0) {
  const [row] = await db
    .insert(seasons)
    .values({ drama_id: dramaId, title, position })
    .returning();

  if (!row) {
    throw new Error('Season insert returned no row.');
  }

  return row;
}

async function insertEpisode(
  dramaId: string,
  seasonId: string | null,
  title: string,
  episodeNumber: number | null,
  position: number | null,
  overrides: Record<string, unknown> = {}
) {
  const [row] = await db
    .insert(episodes)
    .values({
      drama_id: dramaId,
      season_id: seasonId,
      title,
      episode_number: episodeNumber,
      position,
      publication_status: 'ongoing',
      video_source: null,
      ...overrides,
    })
    .returning();

  if (!row) {
    throw new Error('Episode insert returned no row.');
  }

  return row;
}

async function cleanupTestContent(): Promise<void> {
  const rows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_SLUG_PREFIX}%`));
  const ids = rows.map(row => row.id);

  if (ids.length === 0) {
    return;
  }

  await db.delete(playback_progress).where(inArray(playback_progress.content_id, ids));
  await db.delete(episodes).where(inArray(episodes.drama_id, ids));
  await db.delete(seasons).where(inArray(seasons.drama_id, ids));
  await db
    .delete(structureConversionSnapshots)
    .where(inArray(structureConversionSnapshots.drama_id, ids));
  await db.delete(dramas).where(inArray(dramas.id, ids));
}

async function snapshotRows(dramaId: string) {
  return db
    .select()
    .from(structureConversionSnapshots)
    .where(eq(structureConversionSnapshots.drama_id, dramaId));
}

async function activeSeasonRows(dramaId: string) {
  return db
    .select()
    .from(seasons)
    .where(and(eq(seasons.drama_id, dramaId), isNull(seasons.deleted_at)));
}

beforeEach(async () => {
  await cleanupTestContent();
});

afterEach(async () => {
  await cleanupTestContent();
});

afterAll(async () => {
  await cleanupTestContent();
  await closePool();
});

describe('authorization', () => {
  it('rejects anonymous actors', async () => {
    const drama = await insertDrama('auth-anon');

    await expect(
      previewConversion(anonymousActor, {
        dramaId: drama.id,
        mode: 'preview',
        targetStructureType: 'flat',
      })
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it('rejects actors without drama.manage, including season/episode managers', async () => {
    const drama = await insertDrama('auth-reader');

    await expect(
      previewConversion(readerActor, {
        dramaId: drama.id,
        mode: 'preview',
        targetStructureType: 'flat',
      })
    ).rejects.toBeInstanceOf(AuthorizationError);

    await expect(
      previewConversion(seasonOnlyActor, {
        dramaId: drama.id,
        mode: 'preview',
        targetStructureType: 'flat',
      })
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('season-based → flat', () => {
  it('previews the ordered renumbering without writing', async () => {
    const drama = await insertDrama('preview-flat');
    const s1 = await insertSeason(drama.id, 'Season 1', 0);
    const s2 = await insertSeason(drama.id, 'Season 2', 1);
    const e1 = await insertEpisode(drama.id, s1.id, 'E1', 1, 0);
    const e2 = await insertEpisode(drama.id, s1.id, 'E2', 2, 1);
    const e3 = await insertEpisode(drama.id, s2.id, 'E3', 1, 0);

    const plan = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });

    expect(plan.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.episodes.map(row => [row.id, row.toEpisodeNumber, row.toPosition])).toEqual([
      [e1.id, 1, 0],
      [e2.id, 2, 1],
      [e3.id, 3, 2],
    ]);
    expect(plan.episodes.every(row => row.toSeasonKey === null)).toBe(true);
    expect(plan.counts).toEqual({ activeEpisodes: 3, seasonsAffected: 2, seasonsCreated: 0 });

    const [dramaRow] = await db.select().from(dramas).where(eq(dramas.id, drama.id));
    expect(dramaRow?.structure_type).toBe('season_based');
    expect(await snapshotRows(drama.id)).toHaveLength(0);
  });

  it('applies the conversion, preserves IDs and metadata, and stores a snapshot', async () => {
    const drama = await insertDrama('apply-flat');
    const s1 = await insertSeason(drama.id, 'Season 1', 0);
    const s2 = await insertSeason(drama.id, 'Season 2', 1);
    const e1 = await insertEpisode(drama.id, s1.id, 'E1', 1, 0, {
      video_source: 'https://media.example.com/e1.mp4',
      description: 'First episode',
    });
    const e2 = await insertEpisode(drama.id, s1.id, 'E2', 2, 1);
    const e3 = await insertEpisode(drama.id, s2.id, 'E3', 1, 0);

    await db.insert(playback_progress).values({
      user_id: randomUUID(),
      content_type: 'drama',
      content_id: drama.id,
      episode_id: e1.id,
      position: 42,
      duration: 600,
    });

    const plan = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });
    const result = await applyConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      targetStructureType: 'flat',
      fingerprint: plan.fingerprint,
    });

    expect(result.newFingerprint).toMatch(/^[a-f0-9]{64}$/);

    const [dramaRow] = await db.select().from(dramas).where(eq(dramas.id, drama.id));
    expect(dramaRow?.structure_type).toBe('flat');

    const episodeRows = await db
      .select()
      .from(episodes)
      .where(eq(episodes.drama_id, drama.id));
    const byId = new Map(episodeRows.map(row => [row.id, row]));

    expect(byId.get(e1.id)).toMatchObject({
      season_id: null,
      episode_number: 1,
      position: 0,
      title: 'E1',
      description: 'First episode',
      video_source: 'https://media.example.com/e1.mp4',
    });
    expect(byId.get(e2.id)).toMatchObject({ season_id: null, episode_number: 2, position: 1 });
    expect(byId.get(e3.id)).toMatchObject({ season_id: null, episode_number: 3, position: 2 });

    const seasonRows = await db.select().from(seasons).where(eq(seasons.drama_id, drama.id));
    expect(seasonRows).toHaveLength(2);
    expect(seasonRows.every(row => row.deleted_at !== null)).toBe(true);

    const snapshots = await snapshotRows(drama.id);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      status: 'available',
      source_structure_type: 'season_based',
      target_structure_type: 'flat',
      post_conversion_fingerprint: result.newFingerprint,
    });
    expect(snapshots[0]?.season_data).toHaveLength(2);
    expect(snapshots[0]?.episode_data).toHaveLength(3);

    const progress = await db
      .select()
      .from(playback_progress)
      .where(eq(playback_progress.episode_id, e1.id));
    expect(progress).toHaveLength(1);
    expect(progress[0]?.position).toBe(42);
  });

  it('rejects a stale fingerprint and writes nothing', async () => {
    const drama = await insertDrama('stale-fingerprint');
    const season = await insertSeason(drama.id, 'Season 1', 0);
    const episode = await insertEpisode(drama.id, season.id, 'E1', 1, 0);

    const plan = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });

    await db
      .update(episodes)
      .set({ episode_number: 9 })
      .where(eq(episodes.id, episode.id));

    await expect(
      applyConversion(managerActor, {
        dramaId: drama.id,
        mode: 'apply',
        targetStructureType: 'flat',
        fingerprint: plan.fingerprint,
      })
    ).rejects.toBeInstanceOf(ConflictError);

    const [dramaRow] = await db.select().from(dramas).where(eq(dramas.id, drama.id));
    expect(dramaRow?.structure_type).toBe('season_based');
    expect(await snapshotRows(drama.id)).toHaveLength(0);
    expect(await activeSeasonRows(drama.id)).toHaveLength(1);
  });

  it('rejects a missing fingerprint', async () => {
    const drama = await insertDrama('missing-fingerprint');

    await expect(
      applyConversion(managerActor, {
        dramaId: drama.id,
        mode: 'apply',
        targetStructureType: 'flat',
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('leaves trashed seasons and episodes untouched', async () => {
    const drama = await insertDrama('trashed');
    const activeSeason = await insertSeason(drama.id, 'Season 1', 0);
    const trashedSeason = await insertSeason(drama.id, 'Season Trashed', 1);
    const activeEpisode = await insertEpisode(drama.id, activeSeason.id, 'E1', 1, 0);
    const trashedEpisode = await insertEpisode(drama.id, trashedSeason.id, 'E2', 99, 7, {
      deleted_at: new Date('2026-01-01T00:00:00.000Z'),
    });

    await db
      .update(seasons)
      .set({ deleted_at: new Date('2026-01-01T00:00:00.000Z') })
      .where(eq(seasons.id, trashedSeason.id));

    const plan = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });
    await applyConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      targetStructureType: 'flat',
      fingerprint: plan.fingerprint,
    });

    const [trashedSeasonRow] = await db
      .select()
      .from(seasons)
      .where(eq(seasons.id, trashedSeason.id));
    expect(trashedSeasonRow).toMatchObject({
      title: 'Season Trashed',
      position: 1,
      deleted_at: new Date('2026-01-01T00:00:00.000Z'),
    });

    const [trashedEpisodeRow] = await db
      .select()
      .from(episodes)
      .where(eq(episodes.id, trashedEpisode.id));
    expect(trashedEpisodeRow).toMatchObject({
      title: 'E2',
      season_id: trashedSeason.id,
      episode_number: 99,
      position: 7,
      deleted_at: new Date('2026-01-01T00:00:00.000Z'),
    });

    const snapshots = await snapshotRows(drama.id);
    const seasonData = snapshots[0]?.season_data as unknown[];
    const episodeData = snapshots[0]?.episode_data as Array<{ id: string }>;
    expect(seasonData).toHaveLength(1);
    expect(episodeData).toHaveLength(1);
    expect(episodeData[0]?.id).toBe(activeEpisode.id);
  });
});

describe('flat → season-based', () => {
  it('defaults to Season 1 and preserves episode numbers and positions', async () => {
    const drama = await insertDrama('default-season', 'flat');
    const e1 = await insertEpisode(drama.id, null, 'E1', 4, 0);
    const e2 = await insertEpisode(drama.id, null, 'E2', 5, 1);

    const plan = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'season_based',
    });
    expect(plan.seasons).toEqual([
      { key: 'season-1', id: null, title: 'Season 1', position: 0, episodeCount: 2 },
    ]);

    const result = await applyConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      targetStructureType: 'season_based',
      fingerprint: plan.fingerprint,
    });

    const [dramaRow] = await db.select().from(dramas).where(eq(dramas.id, drama.id));
    expect(dramaRow?.structure_type).toBe('season_based');

    const seasonRows = await activeSeasonRows(drama.id);
    expect(seasonRows).toHaveLength(1);
    expect(seasonRows[0]?.title).toBe('Season 1');
    expect(seasonRows[0]?.position).toBe(0);

    const episodeRows = await db
      .select()
      .from(episodes)
      .where(eq(episodes.drama_id, drama.id));
    expect(episodeRows.find(row => row.id === e1.id)).toMatchObject({
      season_id: seasonRows[0]?.id,
      episode_number: 4,
      position: 0,
    });
    expect(episodeRows.find(row => row.id === e2.id)).toMatchObject({
      season_id: seasonRows[0]?.id,
      episode_number: 5,
      position: 1,
    });

    expect(await snapshotRows(drama.id)).toHaveLength(0);
    expect(result.snapshotStatus).toBeNull();
  });

  it('applies a full distribution map', async () => {
    const drama = await insertDrama('distribution', 'flat');
    const e1 = await insertEpisode(drama.id, null, 'E1', 1, 0);
    const e2 = await insertEpisode(drama.id, null, 'E2', 2, 1);
    const e3 = await insertEpisode(drama.id, null, 'E3', 3, 2);

    const plan = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'season_based',
      strategy: 'convert',
      distribution: {
        seasons: [
          { key: 's1', title: 'First', position: 0 },
          { key: 's2', title: 'Second', position: 1 },
        ],
        assignments: [
          { episodeId: e1.id, seasonKey: 's1' },
          { episodeId: e3.id, seasonKey: 's1' },
          { episodeId: e2.id, seasonKey: 's2' },
        ],
      },
    });

    expect(plan.seasons).toEqual([
      { key: 's1', id: null, title: 'First', position: 0, episodeCount: 2 },
      { key: 's2', id: null, title: 'Second', position: 1, episodeCount: 1 },
    ]);

    await applyConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      targetStructureType: 'season_based',
      strategy: 'convert',
      fingerprint: plan.fingerprint,
      distribution: {
        seasons: [
          { key: 's1', title: 'First', position: 0 },
          { key: 's2', title: 'Second', position: 1 },
        ],
        assignments: [
          { episodeId: e1.id, seasonKey: 's1' },
          { episodeId: e3.id, seasonKey: 's1' },
          { episodeId: e2.id, seasonKey: 's2' },
        ],
      },
    });

    const seasonRows = await activeSeasonRows(drama.id);
    const first = seasonRows.find(row => row.title === 'First');
    const second = seasonRows.find(row => row.title === 'Second');
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    const episodeRows = await db
      .select()
      .from(episodes)
      .where(eq(episodes.drama_id, drama.id));
    const byId = new Map(episodeRows.map(row => [row.id, row]));
    expect(byId.get(e1.id)?.season_id).toBe(first?.id);
    expect(byId.get(e3.id)?.season_id).toBe(first?.id);
    expect(byId.get(e2.id)?.season_id).toBe(second?.id);
  });

  it('rejects incomplete or invalid distributions without writing', async () => {
    const drama = await insertDrama('invalid-distribution', 'flat');
    const e1 = await insertEpisode(drama.id, null, 'E1', 1, 0);
    const e2 = await insertEpisode(drama.id, null, 'E2', 2, 1);

    const base = {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'season_based',
      strategy: 'convert',
    } as const;

    await expect(
      previewConversion(managerActor, {
        ...base,
        distribution: {
          seasons: [{ key: 's1', title: 'Season 1' }],
          assignments: [{ episodeId: e1.id, seasonKey: 's1' }],
        },
      })
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      previewConversion(managerActor, {
        ...base,
        distribution: {
          seasons: [{ key: 's1', title: 'Season 1' }],
          assignments: [
            { episodeId: e1.id, seasonKey: 's1' },
            { episodeId: e1.id, seasonKey: 's1' },
            { episodeId: e2.id, seasonKey: 's1' },
          ],
        },
      })
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      previewConversion(managerActor, {
        ...base,
        distribution: {
          seasons: [{ key: 's1', title: 'Season 1' }],
          assignments: [
            { episodeId: e1.id, seasonKey: 's1' },
            { episodeId: e2.id, seasonKey: 'missing' },
          ],
        },
      })
    ).rejects.toBeInstanceOf(ValidationError);

    const [dramaRow] = await db.select().from(dramas).where(eq(dramas.id, drama.id));
    expect(dramaRow?.structure_type).toBe('flat');
    expect(await activeSeasonRows(drama.id)).toHaveLength(0);
  });

  it('requires an explicit strategy when a snapshot is available', async () => {
    const drama = await insertDrama('strategy-required');
    const season = await insertSeason(drama.id, 'Season 1', 0);
    await insertEpisode(drama.id, season.id, 'E1', 1, 0);

    const flatPlan = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });
    await applyConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      targetStructureType: 'flat',
      fingerprint: flatPlan.fingerprint,
    });

    await expect(
      previewConversion(managerActor, {
        dramaId: drama.id,
        mode: 'preview',
        targetStructureType: 'season_based',
      })
    ).rejects.toBeInstanceOf(ValidationError);

    const restorePlan = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'season_based',
      strategy: 'restore_snapshot',
    });
    expect(restorePlan.snapshot?.restorable).toBe(true);
    expect(restorePlan.strategy).toBe('restore_snapshot');

    const convertPlan = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'season_based',
      strategy: 'convert',
    });
    expect(convertPlan.strategy).toBe('convert');
  });
});

describe('snapshot restore', () => {
  it('restores exact season IDs, metadata, assignments, and episode order', async () => {
    const drama = await insertDrama('restore');
    const s1 = await insertSeason(drama.id, 'Season One', 0);
    const s2 = await insertSeason(drama.id, 'Season Two', 1);
    const e1 = await insertEpisode(drama.id, s1.id, 'E1', 7, 3, {
      description: 'Keep this description',
    });
    const e2 = await insertEpisode(drama.id, s1.id, 'E2', 8, 4);
    const e3 = await insertEpisode(drama.id, s2.id, 'E3', 1, 0);

    const flatPlan = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });
    await applyConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      targetStructureType: 'flat',
      fingerprint: flatPlan.fingerprint,
    });

    const restorePreview = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'season_based',
      strategy: 'restore_snapshot',
    });
    expect(restorePreview.snapshot?.restorable).toBe(true);
    expect(restorePreview.episodes.map(row => [row.id, row.toSeasonKey])).toEqual([
      [e1.id, s1.id],
      [e2.id, s1.id],
      [e3.id, s2.id],
    ]);

    const result = await applyConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      targetStructureType: 'season_based',
      strategy: 'restore_snapshot',
      fingerprint: restorePreview.fingerprint,
    });

    expect(result.snapshotStatus).toBe('restored');

    const seasonRows = await activeSeasonRows(drama.id);
    expect(seasonRows.find(row => row.id === s1.id)).toMatchObject({
      title: 'Season One',
      position: 0,
    });
    expect(seasonRows.find(row => row.id === s2.id)).toMatchObject({
      title: 'Season Two',
      position: 1,
    });

    const episodeRows = await db
      .select()
      .from(episodes)
      .where(eq(episodes.drama_id, drama.id));
    const byId = new Map(episodeRows.map(row => [row.id, row]));
    expect(byId.get(e1.id)).toMatchObject({
      season_id: s1.id,
      episode_number: 7,
      position: 3,
      description: 'Keep this description',
    });
    expect(byId.get(e2.id)).toMatchObject({ season_id: s1.id, episode_number: 8, position: 4 });
    expect(byId.get(e3.id)).toMatchObject({ season_id: s2.id, episode_number: 1, position: 0 });

    const snapshots = await snapshotRows(drama.id);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.status).toBe('restored');
    expect(snapshots[0]?.restored_at).not.toBeNull();
  });

  it('rejects restore after an episode is added', async () => {
    const drama = await insertDrama('stale-add');
    const season = await insertSeason(drama.id, 'Season 1', 0);
    await insertEpisode(drama.id, season.id, 'E1', 1, 0);

    const flatPlan = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });
    await applyConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      targetStructureType: 'flat',
      fingerprint: flatPlan.fingerprint,
    });

    await insertEpisode(drama.id, null, 'New episode', 4, 3);

    const stalePreview = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'season_based',
      strategy: 'restore_snapshot',
    });
    expect(stalePreview.snapshot?.restorable).toBe(false);
    expect(stalePreview.warnings.join(' ')).toContain('changed');

    await expect(
      applyConversion(managerActor, {
        dramaId: drama.id,
        mode: 'apply',
        targetStructureType: 'season_based',
        strategy: 'restore_snapshot',
        fingerprint: stalePreview.fingerprint,
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects restore after an episode is trashed, reordered, or renumbered', async () => {
    async function freshFlatDrama(label: string) {
      const drama = await insertDrama(label);
      const season = await insertSeason(drama.id, 'Season 1', 0);
      const e1 = await insertEpisode(drama.id, season.id, 'E1', 1, 0);
      const e2 = await insertEpisode(drama.id, season.id, 'E2', 2, 1);

      const plan = await previewConversion(managerActor, {
        dramaId: drama.id,
        mode: 'preview',
        targetStructureType: 'flat',
      });
      await applyConversion(managerActor, {
        dramaId: drama.id,
        mode: 'apply',
        targetStructureType: 'flat',
        fingerprint: plan.fingerprint,
      });

      return { drama, e1, e2 };
    }

    const trashed = await freshFlatDrama('stale-trash');
    await db
      .update(episodes)
      .set({ deleted_at: new Date() })
      .where(eq(episodes.id, trashed.e2.id));

    const trashedPreview = await previewConversion(managerActor, {
      dramaId: trashed.drama.id,
      mode: 'preview',
      targetStructureType: 'season_based',
      strategy: 'restore_snapshot',
    });
    expect(trashedPreview.snapshot?.restorable).toBe(false);
    await expect(
      applyConversion(managerActor, {
        dramaId: trashed.drama.id,
        mode: 'apply',
        targetStructureType: 'season_based',
        strategy: 'restore_snapshot',
        fingerprint: trashedPreview.fingerprint,
      })
    ).rejects.toBeInstanceOf(ConflictError);

    const reordered = await freshFlatDrama('stale-reorder');
    await db
      .update(episodes)
      .set({ position: 9 })
      .where(eq(episodes.id, reordered.e1.id));

    const reorderedPreview = await previewConversion(managerActor, {
      dramaId: reordered.drama.id,
      mode: 'preview',
      targetStructureType: 'season_based',
      strategy: 'restore_snapshot',
    });
    expect(reorderedPreview.snapshot?.restorable).toBe(false);
    await expect(
      applyConversion(managerActor, {
        dramaId: reordered.drama.id,
        mode: 'apply',
        targetStructureType: 'season_based',
        strategy: 'restore_snapshot',
        fingerprint: reorderedPreview.fingerprint,
      })
    ).rejects.toBeInstanceOf(ConflictError);

    const renumbered = await freshFlatDrama('stale-renumber');
    await db
      .update(episodes)
      .set({ episode_number: 42 })
      .where(eq(episodes.id, renumbered.e1.id));

    const renumberedPreview = await previewConversion(managerActor, {
      dramaId: renumbered.drama.id,
      mode: 'preview',
      targetStructureType: 'season_based',
      strategy: 'restore_snapshot',
    });
    expect(renumberedPreview.snapshot?.restorable).toBe(false);
    await expect(
      applyConversion(managerActor, {
        dramaId: renumbered.drama.id,
        mode: 'apply',
        targetStructureType: 'season_based',
        strategy: 'restore_snapshot',
        fingerprint: renumberedPreview.fingerprint,
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('keeps the snapshot after a rejected restore', async () => {
    const drama = await insertDrama('stale-kept');
    const season = await insertSeason(drama.id, 'Season 1', 0);
    await insertEpisode(drama.id, season.id, 'E1', 1, 0);

    const flatPlan = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });
    await applyConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      targetStructureType: 'flat',
      fingerprint: flatPlan.fingerprint,
    });

    await insertEpisode(drama.id, null, 'New', 2, 1);

    const preview = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'season_based',
      strategy: 'restore_snapshot',
    });
    await expect(
      applyConversion(managerActor, {
        dramaId: drama.id,
        mode: 'apply',
        targetStructureType: 'season_based',
        strategy: 'restore_snapshot',
        fingerprint: preview.fingerprint,
      })
    ).rejects.toBeInstanceOf(ConflictError);

    const snapshots = await snapshotRows(drama.id);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.status).toBe('available');
  });

  it('supersedes the previous snapshot on a repeated conversion', async () => {
    const drama = await insertDrama('supersede');
    const s1 = await insertSeason(drama.id, 'Season 1', 0);
    await insertEpisode(drama.id, s1.id, 'E1', 1, 0);

    const firstFlat = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });
    await applyConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      targetStructureType: 'flat',
      fingerprint: firstFlat.fingerprint,
    });

    const restore = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'season_based',
      strategy: 'restore_snapshot',
    });
    await applyConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      targetStructureType: 'season_based',
      strategy: 'restore_snapshot',
      fingerprint: restore.fingerprint,
    });

    const secondFlat = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });
    await applyConversion(managerActor, {
      dramaId: drama.id,
      mode: 'apply',
      targetStructureType: 'flat',
      fingerprint: secondFlat.fingerprint,
    });

    const snapshots = await snapshotRows(drama.id);
    expect(snapshots).toHaveLength(2);
    expect(snapshots.filter(row => row.status === 'available')).toHaveLength(1);
    expect(snapshots.filter(row => row.status === 'restored')).toHaveLength(1);
  });
});

describe('concurrency and database constraints', () => {
  it('allows only one concurrent apply to succeed', async () => {
    const drama = await insertDrama('concurrent');
    const season = await insertSeason(drama.id, 'Season 1', 0);
    await insertEpisode(drama.id, season.id, 'E1', 1, 0);

    const plan = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });

    const results = await Promise.allSettled([
      applyConversion(managerActor, {
        dramaId: drama.id,
        mode: 'apply',
        targetStructureType: 'flat',
        fingerprint: plan.fingerprint,
      }),
      applyConversion(managerActor, {
        dramaId: drama.id,
        mode: 'apply',
        targetStructureType: 'flat',
        fingerprint: plan.fingerprint,
      }),
    ]);

    const fulfilled = results.filter(result => result.status === 'fulfilled');
    const rejected = results.filter(result => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    const snapshots = await snapshotRows(drama.id);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.status).toBe('available');
  });

  it('enforces one available snapshot per drama at the database level', async () => {
    const drama = await insertDrama('db-unique');

    const values = {
      drama_id: drama.id,
      source_structure_type: 'season_based',
      target_structure_type: 'flat',
      season_data: [],
      episode_data: [],
      post_conversion_fingerprint: 'a'.repeat(64),
      status: 'available',
    };

    await db.insert(structureConversionSnapshots).values(values);

    await expect(
      db.insert(structureConversionSnapshots).values(values)
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });
});

describe('admin reads', () => {
  it('lists active dramas with active episode counts and search', async () => {
    const first = await insertDrama('list-one');
    const second = await insertDrama('list-two');
    await insertEpisode(first.id, null, 'E1', 1, 0);
    await insertEpisode(first.id, null, 'E2', 2, 1);
    await insertEpisode(first.id, null, 'Trashed', 3, 2, {
      deleted_at: new Date('2026-01-01T00:00:00.000Z'),
    });

    const all = await listConversionCandidates(managerActor, {
      page: 1,
      pageSize: 20,
      sortBy: 'title',
      sortDirection: 'asc',
      search: '',
    });

    const firstRow = all.items.find(row => row.id === first.id);
    const secondRow = all.items.find(row => row.id === second.id);
    expect(firstRow?.activeEpisodes).toBe(2);
    expect(secondRow?.activeEpisodes).toBe(0);

    const searched = await listConversionCandidates(managerActor, {
      page: 1,
      pageSize: 20,
      sortBy: 'title',
      sortDirection: 'asc',
      search: 'list-one',
    });
    expect(searched.items.map(row => row.id)).toContain(first.id);
    expect(searched.items.map(row => row.id)).not.toContain(second.id);
  });

  it('loads the conversion context with its available snapshot', async () => {
    const drama = await insertDrama('context');
    const season = await insertSeason(drama.id, 'Season 1', 0);
    const episode = await insertEpisode(drama.id, season.id, 'E1', 1, 0);

    const context = await loadConversionContext(managerActor, drama.id);
    expect(context.drama.structureType).toBe('season_based');
    expect(context.seasons).toHaveLength(1);
    expect(context.episodes.map(row => row.id)).toEqual([episode.id]);
    expect(context.availableSnapshot).toBeNull();
  });

  it('returns NotFoundError for a missing drama', async () => {
    await expect(loadConversionContext(managerActor, randomUUID())).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe('fingerprint helper', () => {
  it('matches the workflow preview fingerprint', async () => {
    const drama = await insertDrama('fingerprint');
    const season = await insertSeason(drama.id, 'Season 1', 0);
    await insertEpisode(drama.id, season.id, 'E1', 1, 0);

    const plan = await previewConversion(managerActor, {
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });

    const context = await loadConversionContext(managerActor, drama.id);
    const fingerprint = computeStructureFingerprint({
      dramaId: drama.id,
      structureType: context.drama.structureType,
      seasons: context.seasons,
      episodes: context.episodes,
    });

    expect(fingerprint).toBe(plan.fingerprint);
  });
});
