import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The publishable content references (D-076).
 *
 * The publication workflow announces what it published. It must not read the
 * content tables itself: the content module owns them, and a workflow that
 * queries another module's tables is a workflow that breaks when that module
 * changes (ARCHITECTURE §5.2).
 *
 * The content module therefore answers the question itself — "what are the
 * title and the deep link of the rows that just became public?" — and the
 * workflow only coordinates.
 *
 * These tests run against the real PostgreSQL test database.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for publication reference tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { dramas, episodes, seasons } from '@/modules/content/schema';
import {
  listPublishedDramaReferences,
  listPublishedEpisodeReferences,
  listPublishedSeasonReferences,
} from '@/modules/content/publication-references';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-publication-references-';

type Seed = {
  dramaId: string;
  seasonId: string;
  episodeId: string;
  trashedDramaId: string;
};

async function seed(): Promise<Seed> {
  const dramaId = randomUUID();
  const seasonId = randomUUID();
  const episodeId = randomUUID();
  const trashedDramaId = randomUUID();

  await db.insert(dramas).values([
    {
      id: dramaId,
      title: 'Reference drama',
      slug: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
      structure_type: 'season_based',
      status: 'ongoing',
      publication_status: 'published',
      visibility: 'coming_soon',
    },
    {
      id: trashedDramaId,
      title: 'Trashed drama',
      slug: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
      structure_type: 'season_based',
      status: 'ongoing',
      publication_status: 'published',
      visibility: 'coming_soon',
      deleted_at: new Date(),
    },
  ]);

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

  return { dramaId, seasonId, episodeId, trashedDramaId };
}

async function cleanup(seeded: Seed): Promise<void> {
  await db.delete(episodes).where(eq(episodes.id, seeded.episodeId));
  await db.delete(seasons).where(eq(seasons.id, seeded.seasonId));
  await db
    .delete(dramas)
    .where(inArray(dramas.id, [seeded.dramaId, seeded.trashedDramaId]));
}

describe('the publishable content references', () => {
  let seeded: Seed;

  beforeEach(async () => {
    seeded = await seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
  });

  it('names the drama that was published', async () => {
    const rows = await listPublishedDramaReferences([seeded.dramaId]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(seeded.dramaId);
    expect(rows[0]?.title).toBe('Reference drama');
    expect(rows[0]?.slug.length).toBeGreaterThan(0);
  });

  it('names the season and the drama it belongs to', async () => {
    const rows = await listPublishedSeasonReferences([seeded.seasonId]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(seeded.seasonId);
    expect(rows[0]?.title).toBe('Season 1');
    expect(rows[0]?.dramaId).toBe(seeded.dramaId);
    expect(rows[0]?.dramaTitle).toBe('Reference drama');
    expect(rows[0]?.dramaSlug.length).toBeGreaterThan(0);
  });

  it('names the episode and the drama it belongs to', async () => {
    const rows = await listPublishedEpisodeReferences([seeded.episodeId]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(seeded.episodeId);
    expect(rows[0]?.title).toBe('Episode 1');
    expect(rows[0]?.dramaId).toBe(seeded.dramaId);
    expect(rows[0]?.dramaTitle).toBe('Reference drama');
  });

  it('never names a trashed drama', async () => {
    const rows = await listPublishedDramaReferences([seeded.trashedDramaId]);

    expect(rows).toHaveLength(0);
  });

  it('answers nothing for an empty list', async () => {
    expect(await listPublishedDramaReferences([])).toEqual([]);
    expect(await listPublishedSeasonReferences([])).toEqual([]);
    expect(await listPublishedEpisodeReferences([])).toEqual([]);
  });
});

afterAll(async () => {
  await closePool();
});
