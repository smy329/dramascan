import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for drama administration.
 *
 * Uses the real PostgreSQL test database. The focus is the structure-type
 * contract: a drama's structure may only change through the conversion
 * workflow, so the ordinary drama update must never move it and must never
 * silently reset it.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for drama integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, like } from 'drizzle-orm';

import { db } from '@/db/client';
import type { ActorContext } from '@/modules/authorization';
import { dramas } from '@/modules/content/schema';
import { closePool } from '@/platform/db/pool';
import { createDrama, listDramas, updateDrama } from '@/workflows/admin/dramas';

const TEST_SLUG_PREFIX = 'it-drama-';

const managerActor: ActorContext = {
  userId: 'it-drama-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.manage'],
};

function testSlug(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

function dramaInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Seasons of Glass',
    slug: testSlug('glass'),
    ...overrides,
  };
}

async function cleanupTestDramas(): Promise<void> {
  await db.delete(dramas).where(like(dramas.slug, `${TEST_SLUG_PREFIX}%`));
}

beforeEach(async () => {
  await cleanupTestDramas();
});

afterEach(async () => {
  await cleanupTestDramas();
});

afterAll(async () => {
  await cleanupTestDramas();
  await closePool();
});

describe('createDrama', () => {
  it('stores the requested structure type and defaults to season-based', async () => {
    const created = await createDrama(managerActor, dramaInput());
    expect(created.ok).toBe(true);

    const flat = await createDrama(managerActor, dramaInput({ structure_type: 'flat' }));
    expect(flat.ok).toBe(true);

    const rows = await db
      .select({ slug: dramas.slug, structureType: dramas.structure_type })
      .from(dramas)
      .where(like(dramas.slug, `${TEST_SLUG_PREFIX}%`));

    expect(rows.find(row => row.slug.startsWith(TEST_SLUG_PREFIX))?.structureType).toBe(
      'season_based'
    );
    expect(rows.find(row => row.structureType === 'flat')).toBeDefined();
  });
});

describe('updateDrama', () => {
  it('preserves the stored structure type when the payload omits it', async () => {
    const created = await createDrama(managerActor, dramaInput({ structure_type: 'flat' }));
    expect(created.ok).toBe(true);

    const dramaId = created.ok ? created.drama.id : '';
    expect(dramaId).not.toBe('');

    const updated = await updateDrama(
      managerActor,
      dramaId,
      dramaInput({ title: 'Seasons of Glass, revisited', structure_type: undefined })
    );

    expect(updated.ok).toBe(true);

    const [row] = await db
      .select({ structureType: dramas.structure_type })
      .from(dramas)
      .where(eq(dramas.id, dramaId));

    expect(row?.structureType).toBe('flat');
  });

  it('rejects a structure change with a conflict', async () => {
    const created = await createDrama(managerActor, dramaInput({ structure_type: 'season_based' }));
    expect(created.ok).toBe(true);

    const dramaId = created.ok ? created.drama.id : '';
    expect(dramaId).not.toBe('');

    const updated = await updateDrama(
      managerActor,
      dramaId,
      dramaInput({ structure_type: 'flat' })
    );

    expect(updated.ok).toBe(false);
    expect(updated.ok === false && updated.error).toMatchObject({ code: 'conflict' });

    const [row] = await db
      .select({ structureType: dramas.structure_type })
      .from(dramas)
      .where(eq(dramas.id, dramaId));

    expect(row?.structureType).toBe('season_based');
  });

  it('accepts a structure type equal to the stored value', async () => {
    const created = await createDrama(managerActor, dramaInput({ structure_type: 'flat' }));
    expect(created.ok).toBe(true);

    const dramaId = created.ok ? created.drama.id : '';
    expect(dramaId).not.toBe('');

    const updated = await updateDrama(
      managerActor,
      dramaId,
      dramaInput({ title: 'Still flat', structure_type: 'flat' })
    );

    expect(updated.ok).toBe(true);
  });

  it('reports a missing drama as not found, not as a structure conflict', async () => {
    const updated = await updateDrama(
      managerActor,
      '00000000-0000-7000-8000-000000000000',
      dramaInput({ structure_type: 'flat' })
    );

    expect(updated.ok).toBe(false);
    expect(updated.ok === false && updated.error).toMatchObject({ code: 'not_found' });
  });
});

describe('listDramas', () => {
  async function seedDramaWithStatus(
    publicationStatus: 'draft' | 'published' | 'unpublished',
    options: { trashed?: boolean } = {}
  ): Promise<string> {
    const created = await createDrama(managerActor, dramaInput());

    expect(created.ok).toBe(true);
    const dramaId = created.ok ? created.drama.id : '';

    await db
      .update(dramas)
      .set({
        publication_status: publicationStatus,
        deleted_at: options.trashed ? new Date() : null,
        updated_at: new Date(),
      })
      .where(eq(dramas.id, dramaId));

    return dramaId;
  }

  it('returns only published dramas and reports public availability', async () => {
    const publishedId = await seedDramaWithStatus('published');
    const draftId = await seedDramaWithStatus('draft');
    expect(draftId).not.toBe(publishedId);

    const result = await listDramas(managerActor, { status: 'published', page: 1, pageSize: 20, sort: 'title', order: 'asc' });

    expect(result.ok).toBe(true);
    expect(result.dramas).toHaveLength(1);
    expect(result.dramas[0]?.id).toBe(publishedId);
    expect(result.dramas[0]).toMatchObject({ publicationStatus: 'published', publiclyAvailable: true });
  });

  it('returns only unpublished dramas', async () => {
    const unpublishedId = await seedDramaWithStatus('unpublished');
    const draftId = await seedDramaWithStatus('draft');
    expect(draftId).not.toBe(unpublishedId);

    const result = await listDramas(managerActor, { status: 'unpublished', page: 1, pageSize: 20, sort: 'title', order: 'asc' });

    expect(result.ok).toBe(true);
    expect(result.dramas).toHaveLength(1);
    expect(result.dramas[0]?.id).toBe(unpublishedId);
    expect(result.dramas[0]).toMatchObject({ publicationStatus: 'unpublished', publiclyAvailable: false });
  });

  it('returns only draft dramas', async () => {
    const draftId = await seedDramaWithStatus('draft');
    const publishedId = await seedDramaWithStatus('published');
    expect(draftId).not.toBe(publishedId);

    const result = await listDramas(managerActor, { status: 'draft', page: 1, pageSize: 20, sort: 'title', order: 'asc' });

    expect(result.ok).toBe(true);
    expect(result.dramas).toHaveLength(1);
    expect(result.dramas[0]?.id).toBe(draftId);
    expect(result.dramas[0]).toMatchObject({ publicationStatus: 'draft', publiclyAvailable: false });
  });

  it('returns only soft-deleted dramas when filtering by trashed', async () => {
    const trashedId = await seedDramaWithStatus('draft', { trashed: true });

    const result = await listDramas(managerActor, { status: 'trashed', page: 1, pageSize: 20, sort: 'title', order: 'asc' });

    expect(result.ok).toBe(true);
    expect(result.dramas).toHaveLength(1);
    expect(result.dramas[0]?.id).toBe(trashedId);
    expect(result.dramas[0]).toMatchObject({ publicationStatus: 'draft', publiclyAvailable: false });
  });

  it('excludes soft-deleted dramas by default', async () => {
    const trashedId = await seedDramaWithStatus('draft', { trashed: true });
    const activeId = await seedDramaWithStatus('draft');

    const result = await listDramas(managerActor, { page: 1, pageSize: 20, sort: 'title', order: 'asc' });

    expect(result.ok).toBe(true);
    expect(result.dramas).toHaveLength(1);
    expect(result.dramas[0]?.id).toBe(activeId);
    expect(result.dramas.some(drama => drama.id === trashedId)).toBe(false);
  });
});
