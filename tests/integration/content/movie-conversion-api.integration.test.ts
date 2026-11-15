import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * REST coverage for `POST /admin/api/dramas/convert-to-movie`.
 *
 * `resolveActor` is the only mocked boundary; the route, authorization guard,
 * validation, workflow, and real PostgreSQL writes all execute.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for the movie conversion API tests.');
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

import { POST } from '@/app/admin/api/dramas/convert-to-movie/route';
import { db } from '@/db/client';
import type { ActorContext } from '@/modules/authorization';
import { dramas, episodes, movies, seasons } from '@/modules/content/schema';
import { closePool } from '@/platform/db/pool';

const SLUG_PREFIX = 'it-mcon-api-';

const anonymousActor: ActorContext = {
  userId: null,
  roles: [],
  isSuperAdmin: false,
  permissions: [],
};

const readerActor: ActorContext = {
  userId: 'it-movie-conv-api-reader',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.read'],
};

const managerActor: ActorContext = {
  userId: 'it-movie-conv-api-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.manage'],
};

function testSlug(label: string): string {
  return `${SLUG_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

async function insertDrama(label: string) {
  const [row] = await db
    .insert(dramas)
    .values({
      title: `API test ${label}`,
      slug: testSlug(label),
      structure_type: 'flat',
      publication_status: 'published',
    })
    .returning();

  if (!row) {
    throw new Error('Drama insert returned no row.');
  }

  return row;
}

async function insertEpisode(dramaId: string, overrides: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(episodes)
    .values({
      drama_id: dramaId,
      title: 'The Only Episode',
      episode_number: 1,
      position: 0,
      video_source: 'https://media.example.com/episodes/only.mp4',
      ...overrides,
    })
    .returning();

  if (!row) {
    throw new Error('Episode insert returned no row.');
  }

  return row;
}

async function cleanup(): Promise<void> {
  const dramaRows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${SLUG_PREFIX}%`));
  const dramaIds = dramaRows.map(row => row.id);

  const movieRows = await db
    .select({ id: movies.id })
    .from(movies)
    .where(like(movies.slug, `${SLUG_PREFIX}%`));

  if (movieRows.length > 0) {
    await db.delete(movies).where(
      inArray(
        movies.id,
        movieRows.map(row => row.id)
      )
    );
  }

  if (dramaIds.length > 0) {
    await db.delete(episodes).where(inArray(episodes.drama_id, dramaIds));
    await db.delete(seasons).where(inArray(seasons.drama_id, dramaIds));
    await db.delete(dramas).where(inArray(dramas.id, dramaIds));
  }
}

type ApiBody = {
  data: {
    applied?: boolean;
    movieId?: string;
    fingerprint: string;
    movie: { title: string; slug: string; convertedFromDramaId: string };
  };
  error: { code: string; message: string };
};

async function post(
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: ApiBody }> {
  const response = await POST(
    new Request('http://localhost:3000/admin/api/dramas/convert-to-movie', {
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

describe('POST /admin/api/dramas/convert-to-movie', () => {
  it('previews the conversion without writing', async () => {
    const drama = await insertDrama('preview');
    await insertEpisode(drama.id);

    const { status, body } = await post({ dramaId: drama.id, mode: 'preview' });

    expect(status).toBe(200);
    expect(body.data.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(body.data.movie).toMatchObject({
      title: drama.title,
      slug: drama.slug,
      convertedFromDramaId: drama.id,
    });

    const [dramaRow] = await db.select().from(dramas).where(eq(dramas.id, drama.id));
    expect(dramaRow?.id).toBe(drama.id);
    expect(dramaRow?.deleted_at).toBeNull();
  });

  it('applies a valid fingerprint and returns the created movie', async () => {
    const drama = await insertDrama('apply');
    await insertEpisode(drama.id);

    const preview = await post({ dramaId: drama.id, mode: 'preview' });
    expect(preview.status).toBe(200);

    const applied = await post({
      dramaId: drama.id,
      mode: 'apply',
      fingerprint: preview.body.data.fingerprint,
    });

    expect(applied.status).toBe(200);
    expect(applied.body.data.applied).toBe(true);
    expect(typeof applied.body.data.movieId).toBe('string');
    expect(applied.body.data.movieId).not.toBe(drama.id);
    expect(applied.body.data.movie.slug).toBe(drama.slug);

    const [dramaRow] = await db.select().from(dramas).where(eq(dramas.id, drama.id));
    expect(dramaRow?.deleted_at).not.toBeNull();
  });

  it('returns 409 for a drama without exactly one active episode', async () => {
    const drama = await insertDrama('empty');

    const { status, body } = await post({ dramaId: drama.id, mode: 'preview' });

    expect(status).toBe(409);
    expect(body.error.code).toBe('conflict');
    expect(body.error.message).toMatch(/exactly one episode/i);
  });

  it('returns 409 with the conflicting slug when a movie uses it', async () => {
    const drama = await insertDrama('slug');
    await insertEpisode(drama.id);
    await db.insert(movies).values({
      title: 'Conflicting Movie',
      slug: drama.slug,
      publication_status: 'published',
    });

    const { status, body } = await post({ dramaId: drama.id, mode: 'preview' });

    expect(status).toBe(409);
    expect(body.error.code).toBe('conflict');
    expect(body.error.message).toContain(drama.slug);
    expect(body.error.message).toContain('Conflicting Movie');
  });

  it('returns 409 for a stale fingerprint', async () => {
    const drama = await insertDrama('stale');
    await insertEpisode(drama.id);
    const preview = await post({ dramaId: drama.id, mode: 'preview' });

    await db
      .update(dramas)
      .set({ title: 'Edited Between Preview and Apply' })
      .where(eq(dramas.id, drama.id));

    const stale = await post({
      dramaId: drama.id,
      mode: 'apply',
      fingerprint: preview.body.data.fingerprint,
    });

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('conflict');
    expect(stale.body.error.message).toMatch(/changed after the preview/i);
  });

  it('returns 404 for an unknown or trashed drama', async () => {
    const { status, body } = await post({ dramaId: randomUUID(), mode: 'preview' });

    expect(status).toBe(404);
    expect(body.error.code).toBe('not_found');
  });

  it('returns 400 for an invalid mode, a missing fingerprint, or malformed JSON', async () => {
    const drama = await insertDrama('invalid');
    await insertEpisode(drama.id);

    const invalidMode = await post({ dramaId: drama.id, mode: 'convert' });
    expect(invalidMode.status).toBe(400);
    expect(invalidMode.body.error.code).toBe('validation_error');

    const missingFingerprint = await post({ dramaId: drama.id, mode: 'apply' });
    expect(missingFingerprint.status).toBe(400);
    expect(missingFingerprint.body.error.code).toBe('validation_error');

    const malformed = await POST(
      new Request('http://localhost:3000/admin/api/dramas/convert-to-movie', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ not json',
      })
    );
    expect(malformed.status).toBe(400);
  });

  it('returns 401 for anonymous actors and 403 without drama.manage', async () => {
    const drama = await insertDrama('authz');
    await insertEpisode(drama.id);

    authMock.actor = anonymousActor;
    const anonymous = await post({ dramaId: drama.id, mode: 'preview' });
    expect(anonymous.status).toBe(401);

    authMock.actor = readerActor;
    const forbidden = await post({ dramaId: drama.id, mode: 'preview' });
    expect(forbidden.status).toBe(403);
  });

  it('rejects cross-site mutations', async () => {
    const drama = await insertDrama('cross-site');
    await insertEpisode(drama.id);

    const { status, body } = await post(
      { dramaId: drama.id, mode: 'preview' },
      { 'sec-fetch-site': 'cross-site' }
    );

    expect(status).toBe(403);
    expect(body.error.code).toBe('forbidden');
  });
});
