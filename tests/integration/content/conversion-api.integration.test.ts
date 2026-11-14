import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * REST coverage for `POST /admin/api/dramas/convert`.
 *
 * `resolveActor` is the only mocked boundary; the workflow, authorization
 * guard, validation, and real PostgreSQL writes all execute.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for conversion API tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

const authMock = vi.hoisted(() => ({ actor: undefined as unknown }));

vi.mock('@/modules/authorization', async () => {
  const actual = await vi.importActual<typeof import('@/modules/authorization')>(
    '@/modules/authorization'
  );

  return {
    ...actual,
    resolveActor: async () => authMock.actor,
  };
});

vi.mock('server-only', () => ({}));

import { eq, inArray, like } from 'drizzle-orm';

import { POST } from '@/app/admin/api/dramas/convert/route';
import type { ActorContext } from '@/modules/authorization';
import { db } from '@/db/client';
import { dramas, episodes, seasons, structureConversionSnapshots } from '@/modules/content/schema';
import { closePool } from '@/platform/db/pool';

const TEST_SLUG_PREFIX = 'it-conv-api-';

const anonymousActor: ActorContext = {
  userId: null,
  roles: [],
  isSuperAdmin: false,
  permissions: [],
};

const readerActor: ActorContext = {
  userId: 'it-conv-api-reader',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.read'],
};

const managerActor: ActorContext = {
  userId: 'it-conv-api-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.manage'],
};

function testSlug(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

async function insertDrama(label: string) {
  const [row] = await db
    .insert(dramas)
    .values({ title: `Test ${label}`, slug: testSlug(label), structure_type: 'season_based' })
    .returning();

  if (!row) {
    throw new Error('Drama insert returned no row.');
  }

  return row;
}

async function insertSeason(dramaId: string) {
  const [row] = await db
    .insert(seasons)
    .values({ drama_id: dramaId, title: 'Season 1', position: 0 })
    .returning();

  if (!row) {
    throw new Error('Season insert returned no row.');
  }

  return row;
}

async function insertEpisode(dramaId: string, seasonId: string) {
  const [row] = await db
    .insert(episodes)
    .values({
      drama_id: dramaId,
      season_id: seasonId,
      title: 'E1',
      episode_number: 1,
      position: 0,
    })
    .returning();

  if (!row) {
    throw new Error('Episode insert returned no row.');
  }

  return row;
}

async function cleanup(): Promise<void> {
  const rows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_SLUG_PREFIX}%`));
  const ids = rows.map(row => row.id);

  if (ids.length === 0) {
    return;
  }

  await db.delete(episodes).where(inArray(episodes.drama_id, ids));
  await db.delete(seasons).where(inArray(seasons.drama_id, ids));
  await db
    .delete(structureConversionSnapshots)
    .where(inArray(structureConversionSnapshots.drama_id, ids));
  await db.delete(dramas).where(inArray(dramas.id, ids));
}

type ApiBody = {
  data: {
    fingerprint: string;
    targetStructureType: string;
    applied?: boolean;
    newFingerprint?: string;
    snapshotId?: string | null;
    snapshotStatus?: string | null;
    episodes?: Array<{ id: string }>;
  };
  error: { code: string; message: string };
};

async function post(
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: ApiBody }> {
  const response = await POST(
    new Request('http://localhost:3000/admin/api/dramas/convert', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  );

  return { status: response.status, body: (await response.json()) as ApiBody };
}

beforeEach(async () => {
  authMock.actor = managerActor;
  await cleanup();
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('POST /admin/api/dramas/convert', () => {
  it('previews without writing', async () => {
    const drama = await insertDrama('preview');
    const season = await insertSeason(drama.id);
    await insertEpisode(drama.id, season.id);

    const { status, body } = await post({
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });

    expect(status).toBe(200);
    expect(body.data.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(body.data.targetStructureType).toBe('flat');

    const [row] = await db.select().from(dramas).where(eq(dramas.id, drama.id));
    expect(row?.structure_type).toBe('season_based');
  });

  it('applies a valid fingerprint and returns the applied plan', async () => {
    const drama = await insertDrama('apply-success');
    const season = await insertSeason(drama.id);
    const episode = await insertEpisode(drama.id, season.id);

    const preview = await post({
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });

    expect(preview.status).toBe(200);

    const applied = await post({
      dramaId: drama.id,
      mode: 'apply',
      targetStructureType: 'flat',
      fingerprint: preview.body.data.fingerprint,
    });

    expect(applied.status).toBe(200);
    // The apply response is the plan shape plus the applied marker, the new
    // fingerprint, and the snapshot lifecycle fields.
    expect(applied.body.data.applied).toBe(true);
    expect(applied.body.data.newFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(applied.body.data.snapshotStatus).toBe('available');
    expect(typeof applied.body.data.snapshotId).toBe('string');
    expect(applied.body.data.targetStructureType).toBe('flat');
    expect(applied.body.data.episodes?.map(row => row.id)).toEqual([episode.id]);

    const [row] = await db.select().from(dramas).where(eq(dramas.id, drama.id));
    expect(row?.structure_type).toBe('flat');
  });

  it('rejects a stale fingerprint with 409 and writes nothing', async () => {
    const drama = await insertDrama('apply');
    const season = await insertSeason(drama.id);
    const episode = await insertEpisode(drama.id, season.id);

    const preview = await post({
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });

    await db
      .update(episodes)
      .set({ episode_number: 12 })
      .where(eq(episodes.id, episode.id));

    const stale = await post({
      dramaId: drama.id,
      mode: 'apply',
      targetStructureType: 'flat',
      fingerprint: preview.body.data.fingerprint,
    });

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('conflict');
    expect(stale.body.error.message).toMatch(/changed/i);

    const [row] = await db.select().from(dramas).where(eq(dramas.id, drama.id));
    expect(row?.structure_type).toBe('season_based');
  });

  it('rejects an invalid mode with 400', async () => {
    const drama = await insertDrama('invalid-mode');

    const { status, body } = await post({
      dramaId: drama.id,
      mode: 'delete',
      targetStructureType: 'flat',
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe('validation_error');
  });

  it('rejects an apply without a fingerprint with 400', async () => {
    const drama = await insertDrama('missing-fingerprint');

    const { status } = await post({
      dramaId: drama.id,
      mode: 'apply',
      targetStructureType: 'flat',
    });

    expect(status).toBe(400);
  });

  it('rejects a malformed request body with 400', async () => {
    const response = await POST(
      new Request('http://localhost:3000/admin/api/dramas/convert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ not json',
      })
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as ApiBody;
    expect(body.error.code).toBe('validation_error');
  });

  it('rejects a missing drama with 404', async () => {
    const { status, body } = await post({
      dramaId: '00000000-0000-7000-8000-000000000000',
      mode: 'preview',
      targetStructureType: 'flat',
    });

    expect(status).toBe(404);
    expect(body.error.code).toBe('not_found');
  });

  it('rejects anonymous callers with 401', async () => {
    authMock.actor = anonymousActor;
    const drama = await insertDrama('anonymous');

    const { status, body } = await post({
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });

    expect(status).toBe(401);
    expect(body.error.code).toBe('authentication_required');
  });

  it('rejects actors without drama.manage with 403', async () => {
    authMock.actor = readerActor;
    const drama = await insertDrama('forbidden');

    const { status, body } = await post({
      dramaId: drama.id,
      mode: 'preview',
      targetStructureType: 'flat',
    });

    expect(status).toBe(403);
    expect(body.error.code).toBe('forbidden');
  });

  it('rejects cross-site requests with 403', async () => {
    const drama = await insertDrama('cross-site');

    const { status, body } = await post(
      {
        dramaId: drama.id,
        mode: 'preview',
        targetStructureType: 'flat',
      },
      { 'sec-fetch-site': 'cross-site' }
    );

    expect(status).toBe(403);
    expect(body.error.code).toBe('forbidden');
  });
});
