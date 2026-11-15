import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for the admin content publication API route.
 *
 * Uses the real PostgreSQL test database, the real workflow layer, and the real
 * authorization guard (with only the session resolution mocked).
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for publication API tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

const { resolveActorMock } = vi.hoisted(() => ({ resolveActorMock: vi.fn() }));

vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );
  const permissions = await vi.importActual<typeof import('@/modules/authorization/permissions')>(
    '@/modules/authorization/permissions'
  );
  const actors = await vi.importActual<typeof import('@/modules/authorization/actors')>(
    '@/modules/authorization/actors'
  );
  return { ...permissions, ...guards, ...actors, resolveActor: resolveActorMock };
});

import { eq, like } from 'drizzle-orm';

import { db } from '@/db/client';
import type { ActorContext } from '@/modules/authorization';
import { closePool } from '@/platform/db/pool';
import { dramas } from '@/modules/content/schema';
import { POST } from '@/app/admin/api/publication/route';

const managerActor: ActorContext = {
  userId: 'it-pub-api-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.manage', 'season.manage', 'episode.manage', 'movie.manage'],
};

const readerActor: ActorContext = {
  userId: 'it-pub-api-reader',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.read', 'season.read', 'episode.read', 'movie.read'],
};

async function insertDrama(): Promise<string> {
  const slug = `it-pub-api-drama-${randomUUID().slice(0, 8)}`;

  await db.insert(dramas).values({ title: `API drama ${slug}`, slug, publication_status: 'draft' });

  const [row] = await db.select().from(dramas).where(eq(dramas.slug, slug));
  if (!row) {
    throw new Error('Drama insert returned no row.');
  }

  return row.id;
}

async function cleanup(): Promise<void> {
  const dramaRows = await db.select({ id: dramas.id }).from(dramas).where(like(dramas.slug, 'it-pub-api-%'));
  const dramaIds = dramaRows.map(row => row.id);

  for (const id of dramaIds) {
    await db.delete(dramas).where(eq(dramas.id, id));
  }
}

beforeEach(async () => {
  await cleanup();
  resolveActorMock.mockReset();
  resolveActorMock.mockResolvedValue(managerActor);
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('POST /admin/api/publication', () => {
  it('returns a publication result for an authorized manager', async () => {
    const dramaId = await insertDrama();

    const response = await POST(
      new Request('http://localhost:3000/admin/api/publication', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contentType: 'drama',
          action: 'publish',
          ids: [dramaId],
        }),
      })
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { contentType: string; action: string; summary: { requested: number; succeeded: number; skipped: number; failed: number } };
    };
    expect(body.data.contentType).toBe('drama');
    expect(body.data.summary).toEqual({ requested: 1, succeeded: 1, skipped: 0, failed: 0 });
  });

  it('returns 403 for an actor without the manage permission', async () => {
    const dramaId = await insertDrama();

    resolveActorMock.mockResolvedValue(readerActor);

    const response = await POST(
      new Request('http://localhost:3000/admin/api/publication', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contentType: 'drama',
          action: 'publish',
          ids: [dramaId],
        }),
      })
    );

    expect(response.status).toBe(403);
  });
});
