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
import {
  categories,
  drama_categories as dramaCategories,
  drama_platforms as dramaPlatforms,
  dramas,
  episodes,
  platforms,
  seasons,
} from '@/modules/content/schema';
import { closePool } from '@/platform/db/pool';
import { createDrama, listDramas, updateDrama } from '@/workflows/admin/dramas';

const TEST_SLUG_PREFIX = 'it-drama-';
const TEST_TAXONOMY_PREFIX = 'it-taxonomy-';

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
  const dramaRows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_SLUG_PREFIX}%`));

  for (const row of dramaRows) {
    await db.delete(dramaCategories).where(eq(dramaCategories.drama_id, row.id));
    await db.delete(dramaPlatforms).where(eq(dramaPlatforms.drama_id, row.id));
    await db.delete(episodes).where(eq(episodes.drama_id, row.id));
    await db.delete(seasons).where(eq(seasons.drama_id, row.id));
    await db.delete(dramas).where(eq(dramas.id, row.id));
  }

  await db.delete(categories).where(like(categories.slug, `${TEST_TAXONOMY_PREFIX}%`));
  await db.delete(platforms).where(like(platforms.slug, `${TEST_TAXONOMY_PREFIX}%`));
}

async function seedCategory(label: string): Promise<string> {
  const [row] = await db
    .insert(categories)
    .values({
      name: `Category ${label}`,
      slug: `${TEST_TAXONOMY_PREFIX}cat-${label}-${randomUUID().slice(0, 8)}`,
    })
    .returning({ id: categories.id });

  return row!.id;
}

async function seedPlatform(label: string): Promise<string> {
  const [row] = await db
    .insert(platforms)
    .values({
      name: `Platform ${label}`,
      slug: `${TEST_TAXONOMY_PREFIX}plat-${label}-${randomUUID().slice(0, 8)}`,
    })
    .returning({ id: platforms.id });

  return row!.id;
}

async function storedAssociations(
  dramaId: string
): Promise<{ categories: string[]; platforms: string[] }> {
  const categoryRows = await db
    .select({ id: dramaCategories.category_id })
    .from(dramaCategories)
    .where(eq(dramaCategories.drama_id, dramaId));
  const platformRows = await db
    .select({ id: dramaPlatforms.platform_id })
    .from(dramaPlatforms)
    .where(eq(dramaPlatforms.drama_id, dramaId));

  return {
    categories: categoryRows.map(row => row.id).sort(),
    platforms: platformRows.map(row => row.id).sort(),
  };
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
  // `listDramas` is a global administrative query: it returns every drama in
  // the database that matches the filters. Other integration files create
  // dramas in the same database at the same time, so every assertion in this
  // block is scoped by a token that only this file's rows carry. Without it the
  // expected counts depend on which file happens to be running in parallel.
  const scopeToken = randomUUID();

  async function seedDramaWithStatus(
    publicationStatus: 'draft' | 'published' | 'unpublished',
    options: { trashed?: boolean } = {}
  ): Promise<string> {
    const created = await createDrama(
      managerActor,
      dramaInput({ title: `Seasons of Glass ${scopeToken}` })
    );

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

    const result = await listDramas(managerActor, {
      status: 'published',
      search: scopeToken,
      page: 1,
      pageSize: 20,
      sort: 'title',
      order: 'asc',
    });

    expect(result.ok).toBe(true);
    expect(result.dramas).toHaveLength(1);
    expect(result.dramas[0]?.id).toBe(publishedId);
    expect(result.dramas[0]).toMatchObject({
      publicationStatus: 'published',
      publiclyAvailable: true,
    });
  });

  it('returns only unpublished dramas', async () => {
    const unpublishedId = await seedDramaWithStatus('unpublished');
    const draftId = await seedDramaWithStatus('draft');
    expect(draftId).not.toBe(unpublishedId);

    const result = await listDramas(managerActor, {
      status: 'unpublished',
      search: scopeToken,
      page: 1,
      pageSize: 20,
      sort: 'title',
      order: 'asc',
    });

    expect(result.ok).toBe(true);
    expect(result.dramas).toHaveLength(1);
    expect(result.dramas[0]?.id).toBe(unpublishedId);
    expect(result.dramas[0]).toMatchObject({
      publicationStatus: 'unpublished',
      publiclyAvailable: false,
    });
  });

  it('returns only draft dramas', async () => {
    const draftId = await seedDramaWithStatus('draft');
    const publishedId = await seedDramaWithStatus('published');
    expect(draftId).not.toBe(publishedId);

    const result = await listDramas(managerActor, {
      status: 'draft',
      search: scopeToken,
      page: 1,
      pageSize: 20,
      sort: 'title',
      order: 'asc',
    });

    expect(result.ok).toBe(true);
    expect(result.dramas).toHaveLength(1);
    expect(result.dramas[0]?.id).toBe(draftId);
    expect(result.dramas[0]).toMatchObject({
      publicationStatus: 'draft',
      publiclyAvailable: false,
    });
  });

  it('returns only soft-deleted dramas when filtering by trashed', async () => {
    const trashedId = await seedDramaWithStatus('draft', { trashed: true });

    const result = await listDramas(managerActor, {
      status: 'trashed',
      search: scopeToken,
      page: 1,
      pageSize: 20,
      sort: 'title',
      order: 'asc',
    });

    expect(result.ok).toBe(true);
    expect(result.dramas).toHaveLength(1);
    expect(result.dramas[0]?.id).toBe(trashedId);
    expect(result.dramas[0]).toMatchObject({
      publicationStatus: 'draft',
      publiclyAvailable: false,
    });
  });

  it('excludes soft-deleted dramas by default', async () => {
    const trashedId = await seedDramaWithStatus('draft', { trashed: true });
    const activeId = await seedDramaWithStatus('draft');

    const result = await listDramas(managerActor, {
      search: scopeToken,
      page: 1,
      pageSize: 20,
      sort: 'title',
      order: 'asc',
    });

    expect(result.ok).toBe(true);
    expect(result.dramas).toHaveLength(1);
    expect(result.dramas[0]?.id).toBe(activeId);
    expect(result.dramas.some(drama => drama.id === trashedId)).toBe(false);
  });

  it('does not let a search escape the trashed predicate', async () => {
    // `AND` binds tighter than `OR`, so an ungrouped search leaks only through
    // the last alternative. The slug is that alternative for dramas, so the
    // search term has to match it to reproduce the defect.
    const trashed = await createDrama(
      managerActor,
      dramaInput({ title: 'Trashed Drama', slug: testSlug('needle-trash') })
    );
    expect(trashed.ok).toBe(true);

    await db
      .update(dramas)
      .set({ deleted_at: new Date() })
      .where(eq(dramas.id, trashed.ok ? trashed.drama.id : ''));

    const result = await listDramas(managerActor, {
      page: 1,
      pageSize: 20,
      sort: 'title',
      order: 'asc',
      search: 'needle',
    });

    expect(result.dramas).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('does not let a search escape the publication-status filter', async () => {
    const published = await createDrama(
      managerActor,
      dramaInput({ title: 'Published Drama', slug: testSlug('needle-published') })
    );
    expect(published.ok).toBe(true);

    await db
      .update(dramas)
      .set({ publication_status: 'published' })
      .where(eq(dramas.id, published.ok ? published.drama.id : ''));

    const result = await listDramas(managerActor, {
      page: 1,
      pageSize: 20,
      sort: 'title',
      order: 'asc',
      status: 'draft',
      search: 'needle',
    });

    expect(result.dramas).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('still matches a title in scope', async () => {
    const match = await createDrama(
      managerActor,
      dramaInput({ title: 'Needle Found', slug: testSlug('needle-found') })
    );
    await createDrama(managerActor, dramaInput({ title: 'Something Else' }));
    expect(match.ok).toBe(true);

    const result = await listDramas(managerActor, {
      page: 1,
      pageSize: 20,
      sort: 'title',
      order: 'asc',
      search: 'needle',
    });

    expect(result.dramas.map(drama => drama.id)).toEqual([match.ok ? match.drama.id : '']);
  });

  it('pages deterministically when every row shares the sort value', async () => {
    const ids: string[] = [];

    for (let index = 0; index < 6; index += 1) {
      const created = await createDrama(
        managerActor,
        dramaInput({ title: 'Identical Title', slug: testSlug(`identical-${index}`) })
      );
      expect(created.ok).toBe(true);
      ids.push(created.ok ? created.drama.id : '');
    }

    const firstPass = await Promise.all(
      [1, 2, 3].map(page =>
        listDramas(managerActor, {
          page,
          pageSize: 2,
          sort: 'title',
          order: 'asc',
          search: 'Identical',
        })
      )
    );
    const secondPass = await Promise.all(
      [1, 2, 3].map(page =>
        listDramas(managerActor, {
          page,
          pageSize: 2,
          sort: 'title',
          order: 'asc',
          search: 'Identical',
        })
      )
    );

    const firstIds = firstPass.flatMap(result => result.dramas.map(drama => drama.id));
    const secondIds = secondPass.flatMap(result => result.dramas.map(drama => drama.id));

    expect(new Set(firstIds)).toEqual(new Set(ids));
    expect(firstIds).toEqual(secondIds);
  });
});

describe('createDrama associations (H-04)', () => {
  it('persists the requested categories and platforms', async () => {
    const categoryId = await seedCategory('persist');
    const platformId = await seedPlatform('persist');

    const created = await createDrama(
      managerActor,
      dramaInput({ categories: [categoryId], platforms: [platformId] })
    );

    expect(created.ok).toBe(true);

    const stored = await storedAssociations(created.ok ? created.drama.id : '');

    expect(stored).toEqual({ categories: [categoryId], platforms: [platformId] });
  });

  it('deduplicates repeated ids instead of failing on the join primary key', async () => {
    const categoryId = await seedCategory('duplicate');
    const platformId = await seedPlatform('duplicate');

    const created = await createDrama(
      managerActor,
      dramaInput({
        categories: [categoryId, categoryId, categoryId],
        platforms: [platformId, platformId],
      })
    );

    expect(created.ok).toBe(true);

    const stored = await storedAssociations(created.ok ? created.drama.id : '');

    expect(stored).toEqual({ categories: [categoryId], platforms: [platformId] });
  });

  it('rejects an unknown category and stores no drama', async () => {
    const slug = testSlug('unknown-category');
    const created = await createDrama(
      managerActor,
      dramaInput({ slug, categories: ['00000000-0000-7000-8000-000000000000'] })
    );

    expect(created.ok).toBe(false);
    expect(created.ok === false && created.error).toMatchObject({ code: 'validation_error' });

    const rows = await db.select({ id: dramas.id }).from(dramas).where(eq(dramas.slug, slug));
    expect(rows).toEqual([]);
  });

  it('rejects an unknown platform and stores no drama', async () => {
    const slug = testSlug('unknown-platform');
    const created = await createDrama(
      managerActor,
      dramaInput({ slug, platforms: ['00000000-0000-7000-8000-000000000000'] })
    );

    expect(created.ok).toBe(false);
    expect(created.ok === false && created.error).toMatchObject({ code: 'validation_error' });

    const rows = await db.select({ id: dramas.id }).from(dramas).where(eq(dramas.slug, slug));
    expect(rows).toEqual([]);
  });

  it('rejects a trashed category target', async () => {
    const categoryId = await seedCategory('trashed');
    await db
      .update(categories)
      .set({ deleted_at: new Date() })
      .where(eq(categories.id, categoryId));

    const created = await createDrama(managerActor, dramaInput({ categories: [categoryId] }));

    expect(created.ok).toBe(false);
    expect(created.ok === false && created.error).toMatchObject({ code: 'validation_error' });
  });
});

describe('updateDrama associations (H-04)', () => {
  async function seedDramaWithAssociations(): Promise<{
    dramaId: string;
    categoryA: string;
    categoryB: string;
    categoryC: string;
    platformA: string;
  }> {
    const categoryA = await seedCategory('update-a');
    const categoryB = await seedCategory('update-b');
    const categoryC = await seedCategory('update-c');
    const platformA = await seedPlatform('update-a');

    const created = await createDrama(
      managerActor,
      dramaInput({ categories: [categoryA, categoryB], platforms: [platformA] })
    );

    expect(created.ok).toBe(true);

    return {
      dramaId: created.ok ? created.drama.id : '',
      categoryA,
      categoryB,
      categoryC,
      platformA,
    };
  }

  it('replaces the whole set in one transaction', async () => {
    const { dramaId, categoryB, categoryC } = await seedDramaWithAssociations();

    const updated = await updateDrama(
      managerActor,
      dramaId,
      dramaInput({ categories: [categoryB, categoryC] })
    );

    expect(updated.ok).toBe(true);
    expect((await storedAssociations(dramaId)).categories).toEqual([categoryB, categoryC].sort());
  });

  it('leaves associations untouched when the payload omits them', async () => {
    const { dramaId, categoryA, categoryB } = await seedDramaWithAssociations();

    const updated = await updateDrama(
      managerActor,
      dramaId,
      dramaInput({ title: 'Only metadata' })
    );

    expect(updated.ok).toBe(true);
    expect((await storedAssociations(dramaId)).categories).toEqual([categoryA, categoryB].sort());
  });

  it('deduplicates repeated ids on update', async () => {
    const { dramaId, categoryB } = await seedDramaWithAssociations();

    const updated = await updateDrama(
      managerActor,
      dramaId,
      dramaInput({ categories: [categoryB, categoryB] })
    );

    expect(updated.ok).toBe(true);
    expect((await storedAssociations(dramaId)).categories).toEqual([categoryB]);
  });

  it('keeps the previous set when a target is invalid', async () => {
    const { dramaId, categoryA, categoryB } = await seedDramaWithAssociations();

    const updated = await updateDrama(
      managerActor,
      dramaId,
      dramaInput({ categories: [categoryA, '00000000-0000-7000-8000-000000000000'] })
    );

    expect(updated.ok).toBe(false);
    expect(updated.ok === false && updated.error).toMatchObject({ code: 'validation_error' });

    expect((await storedAssociations(dramaId)).categories).toEqual([categoryA, categoryB].sort());
  });

  it('serializes simultaneous replacements so the result is exactly one request', async () => {
    const { dramaId, categoryA, categoryB, categoryC } = await seedDramaWithAssociations();

    await Promise.all([
      updateDrama(managerActor, dramaId, dramaInput({ categories: [categoryB, categoryC] })),
      updateDrama(managerActor, dramaId, dramaInput({ categories: [categoryA] })),
    ]);

    const stored = await storedAssociations(dramaId);

    // Exactly one replacement is visible; never the union of both.
    expect([JSON.stringify([categoryB, categoryC].sort()), JSON.stringify([categoryA])]).toContain(
      JSON.stringify(stored.categories)
    );
  });
});
