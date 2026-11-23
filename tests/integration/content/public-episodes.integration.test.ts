import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Public episode playback lookup integration coverage.
 *
 * The watch page receives a stored video source URL only for an episode that
 * is publicly playable. This test proves the rule against the real PostgreSQL
 * test database: a published hierarchy exposes the source, and every other
 * state hides it.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for public episode integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import { dramas, episodes, seasons } from '@/modules/content/schema';
import {
  getPublicEpisodePlayback,
  listPublicDramaEpisodes,
} from '@/modules/content/public-episodes';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-public-episode-';
const VALID_SOURCE = 'https://media.example.com/episodes/playable.mp4';

type PublicationStatus = 'draft' | 'published' | 'unpublished';

type SeedOptions = {
  dramaPublicationStatus?: PublicationStatus;
  dramaDeleted?: boolean;
  structureType?: 'flat' | 'season_based';
  seasonPublicationStatus?: PublicationStatus;
  seasonDeleted?: boolean;
  episodePublicationStatus?: PublicationStatus;
  episodeDeleted?: boolean;
  videoSource?: string | null;
};

type Seeded = {
  dramaId: string;
  episodeId: string;
  seasonId: string | null;
};

async function seed(options: SeedOptions = {}): Promise<Seeded> {
  const dramaId = randomUUID();
  const slug = `${TEST_PREFIX}${randomUUID().slice(0, 8)}`;
  const structureType = options.structureType ?? 'season_based';

  await db.insert(dramas).values({
    id: dramaId,
    title: 'Public episode drama',
    slug,
    structure_type: structureType,
    status: 'ongoing',
    publication_status: options.dramaPublicationStatus ?? 'published',
    visibility: 'coming_soon',
    deleted_at: options.dramaDeleted ? new Date() : null,
  });

  let seasonId: string | null = null;

  if (structureType === 'season_based') {
    seasonId = randomUUID();

    await db.insert(seasons).values({
      id: seasonId,
      drama_id: dramaId,
      title: 'Season 1',
      position: 0,
      publication_status: options.seasonPublicationStatus ?? 'published',
      deleted_at: options.seasonDeleted ? new Date() : null,
    });
  }

  const episodeId = randomUUID();

  await db.insert(episodes).values({
    id: episodeId,
    drama_id: dramaId,
    season_id: seasonId,
    title: 'Episode 1',
    episode_number: 1,
    position: 0,
    publication_status: options.episodePublicationStatus ?? 'published',
    video_source:
      options.videoSource === undefined ? VALID_SOURCE : options.videoSource,
    deleted_at: options.episodeDeleted ? new Date() : null,
  });

  return { dramaId, episodeId, seasonId };
}

async function cleanup(): Promise<void> {
  const rows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_PREFIX}%`));

  const ids = rows.map(row => row.id);

  if (ids.length > 0) {
    await db.delete(episodes).where(inArray(episodes.drama_id, ids));
    await db.delete(seasons).where(inArray(seasons.drama_id, ids));
    await db.delete(dramas).where(inArray(dramas.id, ids));
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

describe('public episode playback lookup', () => {
  it('returns the stored source for a published episode under a published drama and season', async () => {
    const seeded = await seed();

    const result = await getPublicEpisodePlayback(seeded.dramaId, seeded.episodeId);

    expect(result).toMatchObject({
      id: seeded.episodeId,
      dramaId: seeded.dramaId,
      title: 'Episode 1',
      videoSource: VALID_SOURCE,
    });
  });

  it('returns null for an episode that belongs to another drama', async () => {
    const first = await seed();
    const second = await seed();

    const result = await getPublicEpisodePlayback(second.dramaId, first.episodeId);

    expect(result).toBeNull();
  });

  it.each([
    { label: 'draft', status: 'draft' as const },
    { label: 'unpublished', status: 'unpublished' as const },
  ])('returns null for a $label episode', async options => {
    const seeded = await seed({ episodePublicationStatus: options.status });

    expect(await getPublicEpisodePlayback(seeded.dramaId, seeded.episodeId)).toBeNull();
  });

  it('returns null for a trashed episode', async () => {
    const seeded = await seed({ episodeDeleted: true });

    expect(await getPublicEpisodePlayback(seeded.dramaId, seeded.episodeId)).toBeNull();
  });

  it.each([
    { label: 'draft', status: 'draft' as const },
    { label: 'unpublished', status: 'unpublished' as const },
  ])('returns null for an episode under a $label drama', async options => {
    const seeded = await seed({ dramaPublicationStatus: options.status });

    expect(await getPublicEpisodePlayback(seeded.dramaId, seeded.episodeId)).toBeNull();
  });

  it('returns null for an episode under a trashed drama', async () => {
    const seeded = await seed({ dramaDeleted: true });

    expect(await getPublicEpisodePlayback(seeded.dramaId, seeded.episodeId)).toBeNull();
  });

  it.each([
    { label: 'draft', status: 'draft' as const },
    { label: 'unpublished', status: 'unpublished' as const },
  ])('returns null for an episode under a $label season', async options => {
    const seeded = await seed({ seasonPublicationStatus: options.status });

    expect(await getPublicEpisodePlayback(seeded.dramaId, seeded.episodeId)).toBeNull();
  });

  it('returns null for an episode under a trashed season', async () => {
    const seeded = await seed({ seasonDeleted: true });

    expect(await getPublicEpisodePlayback(seeded.dramaId, seeded.episodeId)).toBeNull();
  });

  it('returns null for an episode without a stored source', async () => {
    const seeded = await seed({ videoSource: null });

    expect(await getPublicEpisodePlayback(seeded.dramaId, seeded.episodeId)).toBeNull();
  });

  it('lists only the publicly playable episodes of a drama', async () => {
    const playable = await seed();
    const draft = await seed({ episodePublicationStatus: 'draft' });

    const result = await listPublicDramaEpisodes(playable.dramaId);

    expect(result.map(item => item.id)).toEqual([playable.episodeId]);
    expect(result).not.toContainEqual(expect.objectContaining({ id: draft.episodeId }));
  });

  it('does not hand out the source URL in an episode listing', async () => {
    const playable = await seed();

    const result = await listPublicDramaEpisodes(playable.dramaId);

    // A listing is not a playback view: only the watch query hands out a
    // media URL.
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('videoSource');
    expect(JSON.stringify(result)).not.toContain('media.example.com');
  });

  it('reports the version of the stored source with the watch data', async () => {
    const seeded = await seed();

    const result = await getPublicEpisodePlayback(seeded.dramaId, seeded.episodeId);

    expect(result?.sourceVersion).toBe(1);
  });
});
