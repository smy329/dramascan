import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Anonymous public drama catalogue integration coverage.
 *
 * Uses the real PostgreSQL test database and the real query service. The point
 * is to prove that a caller cannot weaken public visibility through the query
 * string, that hierarchy state is evaluated consistently, that the listing is
 * bounded and deterministic, and that the wire DTO is the approved camelCase
 * shape rather than raw rows.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for public drama integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import { dramas, episodes, seasons } from '@/modules/content/schema';
import { listPublicDramas } from '@/modules/content/public-dramas';
import type { PublicDramaSummary } from '@/modules/content/public-dramas.shared';
import { closePool } from '@/platform/db/pool';
import { GET } from '@/app/public/api/dramas/route';

const TEST_PREFIX = 'it-public-drama-';
const VALID_SOURCE = 'https://media.example.com/episodes/1.mp4';

type PublicationStatus = 'draft' | 'published' | 'unpublished';

type SeasonSeed = {
  publicationStatus?: PublicationStatus;
  deleted?: boolean;
};

type EpisodeSeed = {
  publicationStatus?: PublicationStatus;
  deleted?: boolean;
  videoSource?: string | null;
  seasonIndex?: number | null;
  title?: string;
};

type DramaSeed = {
  label: string;
  title?: string;
  publicationStatus?: PublicationStatus;
  visibility?: 'coming_soon' | 'hidden' | null;
  deleted?: boolean;
  structureType?: 'flat' | 'season_based';
  seasons?: SeasonSeed[];
  episodes?: EpisodeSeed[];
};

type SeededDrama = {
  id: string;
  title: string;
  slug: string;
  seasonIds: string[];
  episodeIds: string[];
};

const seededIds = new Set<string>();

async function cleanupTestContent(): Promise<void> {
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

  seededIds.clear();
}

async function seedDrama(options: DramaSeed): Promise<SeededDrama> {
  const id = randomUUID();
  const slug = `${TEST_PREFIX}${options.label}-${randomUUID().slice(0, 8)}`;
  const title = options.title ?? `Public drama ${options.label}`;

  await db.insert(dramas).values({
    id,
    title,
    slug,
    structure_type: options.structureType ?? 'season_based',
    status: 'ongoing',
    publication_status: options.publicationStatus ?? 'draft',
    visibility: options.visibility === undefined ? 'coming_soon' : options.visibility,
    deleted_at: options.deleted ? new Date() : null,
  });

  const seasonIds: string[] = [];
  const seasonSeeds = options.structureType === 'flat' ? [] : options.seasons ?? [];

  for (const [index, seasonSeed] of seasonSeeds.entries()) {
    const seasonId = randomUUID();
    seasonIds.push(seasonId);

    await db.insert(seasons).values({
      id: seasonId,
      drama_id: id,
      title: `Season ${index + 1}`,
      position: index,
      publication_status: seasonSeed.publicationStatus ?? 'draft',
      deleted_at: seasonSeed.deleted ? new Date() : null,
    });
  }

  const episodeIds: string[] = [];

  for (const [index, episodeSeed] of (options.episodes ?? []).entries()) {
    const episodeId = randomUUID();
    episodeIds.push(episodeId);

    const seasonIndex = episodeSeed.seasonIndex === undefined ? 0 : episodeSeed.seasonIndex;
    const seasonId =
      seasonIndex !== null && seasonIds[seasonIndex] ? seasonIds[seasonIndex]! : null;

    await db.insert(episodes).values({
      id: episodeId,
      drama_id: id,
      season_id: seasonId,
      title: episodeSeed.title ?? `Episode ${index + 1}`,
      episode_number: index + 1,
      position: index,
      publication_status: episodeSeed.publicationStatus ?? 'draft',
      video_source:
        episodeSeed.videoSource === undefined ? VALID_SOURCE : episodeSeed.videoSource,
      deleted_at: episodeSeed.deleted ? new Date() : null,
    });
  }

  seededIds.add(id);

  return { id, title, slug, seasonIds, episodeIds };
}

async function list(query: Record<string, unknown> = {}): Promise<{
  items: PublicDramaSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}> {
  return listPublicDramas(query);
}

async function api(query = ''): Promise<Response> {
  return GET(new Request(`http://localhost:3000/public/api/dramas${query}`));
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

describe('anonymous public drama visibility', () => {
  it('returns a published Show Coming Soon drama without a playable episode', async () => {
    const seeded = await seedDrama({
      label: 'coming-soon-empty',
      publicationStatus: 'published',
      visibility: 'coming_soon',
    });

    const result = await list({ pageSize: 100 });
    const item = result.items.find(candidate => candidate.id === seeded.id);

    expect(item).toMatchObject({ id: seeded.id, comingSoon: true, status: 'ongoing' });
  });

  it('returns a published drama whose only episode is a draft', async () => {
    const seeded = await seedDrama({
      label: 'draft-episode',
      publicationStatus: 'published',
      visibility: 'coming_soon',
      seasons: [{ publicationStatus: 'published' }],
      episodes: [{ publicationStatus: 'draft' }],
    });

    const result = await list({ pageSize: 100 });
    expect(result.items.find(item => item.id === seeded.id)).toMatchObject({
      id: seeded.id,
      comingSoon: true,
    });
  });

  it.each([
    { label: 'draft', publicationStatus: 'draft' as const },
    { label: 'unpublished', publicationStatus: 'unpublished' as const },
  ])('never returns a $label drama, even with a playable episode', async options => {
    const seeded = await seedDrama({
      label: `own-status-${options.label}`,
      publicationStatus: options.publicationStatus,
      visibility: 'coming_soon',
      seasons: [{ publicationStatus: 'published' }],
      episodes: [{ publicationStatus: 'published' }],
    });

    const result = await list({ pageSize: 100 });
    expect(result.items.some(item => item.id === seeded.id)).toBe(false);
  });

  it('never returns a trashed drama', async () => {
    const seeded = await seedDrama({
      label: 'trashed',
      publicationStatus: 'published',
      visibility: 'coming_soon',
      deleted: true,
    });

    const result = await list({ pageSize: 100 });
    expect(result.items.some(item => item.id === seeded.id)).toBe(false);
  });

  it('hides a Hide Until Episodes Available drama until a playable episode exists', async () => {
    const empty = await seedDrama({
      label: 'hidden-empty',
      publicationStatus: 'published',
      visibility: 'hidden',
    });
    const draftOnly = await seedDrama({
      label: 'hidden-draft-only',
      publicationStatus: 'published',
      visibility: 'hidden',
      seasons: [{ publicationStatus: 'published' }],
      episodes: [{ publicationStatus: 'draft' }],
    });

    const result = await list({ pageSize: 100 });
    expect(result.items.some(item => item.id === empty.id)).toBe(false);
    expect(result.items.some(item => item.id === draftOnly.id)).toBe(false);
  });

  it('reveals a hidden season-based drama once a published episode is playable', async () => {
    const seeded = await seedDrama({
      label: 'hidden-playable',
      publicationStatus: 'published',
      visibility: 'hidden',
      seasons: [{ publicationStatus: 'published' }],
      episodes: [{ publicationStatus: 'published', videoSource: VALID_SOURCE }],
    });

    const result = await list({ pageSize: 100 });
    expect(result.items.find(item => item.id === seeded.id)).toMatchObject({
      id: seeded.id,
      comingSoon: false,
    });
  });

  it('reveals a hidden flat drama once a published episode is playable', async () => {
    const seeded = await seedDrama({
      label: 'hidden-flat-playable',
      structureType: 'flat',
      publicationStatus: 'published',
      visibility: 'hidden',
      episodes: [{ publicationStatus: 'published', seasonIndex: null }],
    });

    const result = await list({ pageSize: 100 });
    expect(result.items.some(item => item.id === seeded.id)).toBe(true);
  });

  it('does not treat an unpublished season as a playable ancestor', async () => {
    const seeded = await seedDrama({
      label: 'hidden-draft-season',
      publicationStatus: 'published',
      visibility: 'hidden',
      seasons: [{ publicationStatus: 'draft' }],
      episodes: [{ publicationStatus: 'published' }],
    });

    const result = await list({ pageSize: 100 });
    expect(result.items.some(item => item.id === seeded.id)).toBe(false);
  });

  it('does not treat a trashed season as a playable ancestor', async () => {
    const seeded = await seedDrama({
      label: 'hidden-trashed-season',
      publicationStatus: 'published',
      visibility: 'hidden',
      seasons: [{ publicationStatus: 'published', deleted: true }],
      episodes: [{ publicationStatus: 'published' }],
    });

    const result = await list({ pageSize: 100 });
    expect(result.items.some(item => item.id === seeded.id)).toBe(false);
  });

  it('does not count a trashed episode as playable', async () => {
    const seeded = await seedDrama({
      label: 'hidden-trashed-episode',
      publicationStatus: 'published',
      visibility: 'hidden',
      seasons: [{ publicationStatus: 'published' }],
      episodes: [{ publicationStatus: 'published', deleted: true }],
    });

    const result = await list({ pageSize: 100 });
    expect(result.items.some(item => item.id === seeded.id)).toBe(false);
  });

  it('does not count an episode without a source as playable', async () => {
    const seeded = await seedDrama({
      label: 'hidden-no-source',
      publicationStatus: 'published',
      visibility: 'hidden',
      seasons: [{ publicationStatus: 'published' }],
      episodes: [{ publicationStatus: 'published', videoSource: null }],
    });

    const result = await list({ pageSize: 100 });
    expect(result.items.some(item => item.id === seeded.id)).toBe(false);
  });

  it('does not count a season-based episode without a season as playable', async () => {
    const seeded = await seedDrama({
      label: 'hidden-orphan-episode',
      structureType: 'season_based',
      publicationStatus: 'published',
      visibility: 'hidden',
      episodes: [{ publicationStatus: 'published', seasonIndex: null }],
    });

    const result = await list({ pageSize: 100 });
    expect(result.items.some(item => item.id === seeded.id)).toBe(false);
  });

  it('treats a null visibility as the Show Coming Soon default', async () => {
    const seeded = await seedDrama({
      label: 'null-visibility',
      publicationStatus: 'published',
      visibility: null,
    });

    const result = await list({ pageSize: 100 });
    expect(result.items.find(item => item.id === seeded.id)).toMatchObject({
      id: seeded.id,
      comingSoon: true,
    });
  });
});

describe('public drama API contract', () => {
  it('cannot be weakened by caller-supplied publication or visibility filters', async () => {
    const draft = await seedDrama({
      label: 'api-draft',
      publicationStatus: 'draft',
      visibility: 'hidden',
      seasons: [{ publicationStatus: 'published' }],
      episodes: [{ publicationStatus: 'published' }],
    });
    const hiddenEmpty = await seedDrama({
      label: 'api-hidden-empty',
      publicationStatus: 'published',
      visibility: 'hidden',
    });
    const visible = await seedDrama({
      label: 'api-visible',
      publicationStatus: 'published',
      visibility: 'coming_soon',
    });

    const response = await api(
      '?page=1&pageSize=100&publication_status=draft&visibility=hidden&status=draft'
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as { data: PublicDramaSummary[]; meta: unknown };
    const ids = body.data.map(item => item.id);

    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(hiddenEmpty.id);
    expect(ids).toContain(visible.id);
  });

  it('returns the explicit camelCase DTO and never raw snake_case rows', async () => {
    const seeded = await seedDrama({
      label: 'api-dto',
      publicationStatus: 'published',
      visibility: 'coming_soon',
    });

    const response = await api('?pageSize=100');
    const body = (await response.json()) as { data: PublicDramaSummary[] };

    const item = body.data.find(candidate => candidate.id === seeded.id);

    if (!item) {
      throw new Error('The seeded published drama was absent from the public response.');
    }

    expect(item).toEqual({
      id: seeded.id,
      title: seeded.title,
      slug: seeded.slug,
      description: null,
      poster: null,
      banner: null,
      href: `/drama/${seeded.id}/${seeded.slug}`,
      status: 'ongoing',
      comingSoon: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    const rawKeys = [
      'publication_status',
      'publicationStatus',
      'visibility',
      'created_at',
      'updated_at',
      'video_source',
      'deleted_at',
    ];

    for (const key of rawKeys) {
      expect(item).not.toHaveProperty(key);
    }

    expect(new Date(item.createdAt).toISOString()).toBe(item.createdAt);
    expect(new Date(item.updatedAt).toISOString()).toBe(item.updatedAt);
  });

  it.each(['?page=0', '?page=-1', '?page=1.5', '?page=abc', '?pageSize=0', '?pageSize=101', '?pageSize=abc'])(
    'rejects an out-of-contract pagination query: %s',
    async query => {
      const response = await api(query);

      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('validation_error');
    }
  );

  it('accepts the maximum page size', async () => {
    const response = await api('?page=1&pageSize=100');
    expect(response.status).toBe(200);
  });

  it('returns a bounded, deterministic page with consistent metadata', async () => {
    const a = await seedDrama({
      label: 'page-a',
      title: 'IT Public Pageable A',
      publicationStatus: 'published',
    });
    const b = await seedDrama({
      label: 'page-b',
      title: 'IT Public Pageable B',
      publicationStatus: 'published',
    });
    const c = await seedDrama({
      label: 'page-c',
      title: 'IT Public Pageable C',
      publicationStatus: 'published',
    });
    const d = await seedDrama({
      label: 'page-d',
      title: 'IT Public Pageable D',
      publicationStatus: 'published',
    });
    const e = await seedDrama({
      label: 'page-e',
      title: 'IT Public Pageable E',
      publicationStatus: 'published',
    });

    const expectedOrder = [a, b, c, d, e].sort((left, right) => {
      if (left.title < right.title) return -1;
      if (left.title > right.title) return 1;
      return 0;
    });

    const collected: PublicDramaSummary[] = [];
    let page = 1;
    let total = 0;

    for (;;) {
      const response = await api(`?page=${page}&pageSize=2`);
      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        data: PublicDramaSummary[];
        meta: {
          page: number;
          pageSize: number;
          total: number;
          totalPages: number;
          hasNextPage: boolean;
          hasPreviousPage: boolean;
        };
      };

      expect(body.data.length).toBeLessThanOrEqual(2);
      expect(body.meta.page).toBe(page);
      expect(body.meta.pageSize).toBe(2);
      expect(body.meta.hasPreviousPage).toBe(page > 1 && body.meta.totalPages > 0);
      expect(body.meta.hasNextPage).toBe(page < body.meta.totalPages);

      total = body.meta.total;
      collected.push(...body.data);

      if (!body.meta.hasNextPage || page > 1000) {
        break;
      }

      page += 1;
    }

    expect(total).toBeGreaterThanOrEqual(expectedOrder.length);
    expect(collected).toHaveLength(total);

    const collectedIds = new Set(collected.map(item => item.id));
    expect(collectedIds.size).toBe(collected.length);

    const ourRows = collected.filter(item =>
      expectedOrder.some(seeded => seeded.id === item.id)
    );

    expect(ourRows.map(item => item.id)).toEqual(expectedOrder.map(seeded => seeded.id));
  });

  it('orders equal titles by the unique id tiebreaker', async () => {
    const sameTitle = 'IT Public Tiebreak';
    const first = await seedDrama({
      label: 'tie-1',
      title: sameTitle,
      publicationStatus: 'published',
    });
    const second = await seedDrama({
      label: 'tie-2',
      title: sameTitle,
      publicationStatus: 'published',
    });
    const third = await seedDrama({
      label: 'tie-3',
      title: sameTitle,
      publicationStatus: 'published',
    });

    const expected = [first, second, third]
      .map(seeded => seeded.id)
      .sort((left, right) => {
        if (left < right) return -1;
        if (left > right) return 1;
        return 0;
      });

    const result = await list({ pageSize: 100 });
    const actual = result.items.filter(item => item.title === sameTitle).map(item => item.id);

    expect(actual).toEqual(expected);
  });

  it('sets JSON and request-id response headers', async () => {
    const response = await api('?pageSize=1');

    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });
});
