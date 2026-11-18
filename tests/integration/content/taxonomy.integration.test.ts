import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for the category and platform administration workflows.
 *
 * Uses the real PostgreSQL test database. Every row this suite writes carries
 * the `it-taxonomy-admin-` slug prefix, so cleanup can never touch development
 * or unrelated test data.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for taxonomy integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, like } from 'drizzle-orm';

import { db } from '@/db/client';
import { slugFromText } from '@/lib/contracts/slug';
import type { ActorContext } from '@/modules/authorization';
import {
  categories,
  drama_categories as dramaCategories,
  dramas,
  platforms,
} from '@/modules/content/schema';
import { closePool } from '@/platform/db/pool';
import {
  createCategory,
  createPlatform,
  deleteCategory,
  listCategories,
  listPlatforms,
  reorderCategories,
  updateCategory,
} from '@/workflows/admin/taxonomy';

const TEST_SLUG_PREFIX = 'it-taxonomy-admin-';
const NAME_PREFIX = 'IT Taxonomy Admin ';

const managerActor: ActorContext = {
  userId: 'it-taxonomy-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['category.manage', 'platform.manage'],
};

const forbiddenActor: ActorContext = { ...managerActor, permissions: [] };

/** Non-Latin name used to prove an empty derived slug is rejected. */
const NON_LATIN_NAME = '我的家';

function uniqueName(label: string): string {
  return `${NAME_PREFIX}${label} ${randomUUID().slice(0, 8)}`;
}

async function cleanupTestTaxonomy(): Promise<void> {
  const dramaRows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_SLUG_PREFIX}drama-%`));

  for (const row of dramaRows) {
    await db.delete(dramas).where(eq(dramas.id, row.id));
  }

  await db.delete(categories).where(like(categories.slug, `${TEST_SLUG_PREFIX}%`));
  await db.delete(platforms).where(like(platforms.slug, `${TEST_SLUG_PREFIX}%`));
}

beforeEach(async () => {
  await cleanupTestTaxonomy();
});

afterEach(async () => {
  await cleanupTestTaxonomy();
});

afterAll(async () => {
  await cleanupTestTaxonomy();
  await closePool();
});

describe('createCategory', () => {
  it('derives the slug, defaults visibility and allocates the next position', async () => {
    const firstName = uniqueName('Romance');
    const first = await createCategory(managerActor, { name: firstName });

    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.category.slug).toBe(slugFromText(firstName));
    expect(first.category.visibility).toBe('visible');
    expect(first.category.usageCount).toBe(0);
    expect(first.category.position).toBeGreaterThanOrEqual(0);

    const secondName = uniqueName('Comedy');
    const second = await createCategory(managerActor, { name: secondName });

    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.category.position).toBe(first.category.position! + 1);
  });

  it('rejects a name differing only by case and leaves one active row', async () => {
    const name = uniqueName('Case');
    const created = await createCategory(managerActor, { name });
    expect(created.ok).toBe(true);

    const duplicate = await createCategory(managerActor, { name: name.toUpperCase() });

    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) return;

    expect(duplicate.error).toMatchObject({
      code: 'validation_error',
      fieldErrors: { name: expect.any(Array) },
    });

    const rows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, slugFromText(name)));

    expect(rows).toHaveLength(1);
  });

  it('rejects two names that derive the same slug', async () => {
    const suffix = randomUUID().slice(0, 8);
    const first = await createCategory(managerActor, {
      name: `${NAME_PREFIX}Sci-Fi ${suffix}`,
    });
    expect(first.ok).toBe(true);

    const second = await createCategory(managerActor, {
      name: `${NAME_PREFIX}Sci Fi ${suffix}`,
    });

    expect(second.ok).toBe(false);
    if (second.ok) return;

    expect(second.error).toMatchObject({
      code: 'validation_error',
      fieldErrors: { name: expect.any(Array) },
    });
  });

  it('rejects a name that derives an empty slug without inserting a row', async () => {
    const result = await createCategory(managerActor, { name: NON_LATIN_NAME });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toMatchObject({
      code: 'validation_error',
      fieldErrors: { name: expect.any(Array) },
    });

    const rows = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, NON_LATIN_NAME));

    expect(rows).toHaveLength(0);
  });

  it('keeps an explicit visibility', async () => {
    const result = await createCategory(managerActor, {
      name: uniqueName('Hidden'),
      visibility: 'hidden',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.category.visibility).toBe('hidden');
  });
});

describe('updateCategory', () => {
  it('rejects renaming to an existing active name', async () => {
    const firstName = uniqueName('First');
    const secondName = uniqueName('Second');
    const first = await createCategory(managerActor, { name: firstName });
    const second = await createCategory(managerActor, { name: secondName });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const result = await updateCategory(managerActor, second.category.id, { name: firstName });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toMatchObject({
      code: 'validation_error',
      fieldErrors: { name: expect.any(Array) },
    });
  });

  it('re-derives the slug from a fresh name and keeps the position', async () => {
    const created = await createCategory(managerActor, { name: uniqueName('Before') });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const nextName = uniqueName('After');
    const result = await updateCategory(managerActor, created.category.id, { name: nextName });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.category.name).toBe(nextName);
    expect(result.category.slug).toBe(slugFromText(nextName));
    expect(result.category.position).toBe(created.category.position);
  });

  it('allows reusing the name and slug of a trashed category', async () => {
    const name = uniqueName('Reusable');
    const created = await createCategory(managerActor, { name });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const deleted = await deleteCategory(managerActor, created.category.id);
    expect(deleted.ok).toBe(true);

    const reused = await createCategory(managerActor, { name });

    expect(reused.ok).toBe(true);
    if (!reused.ok) return;

    expect(reused.category.id).not.toBe(created.category.id);
    expect(reused.category.slug).toBe(slugFromText(name));
  });
});

describe('deleteCategory', () => {
  it('soft deletes, reports the usage count and keeps the association row', async () => {
    const created = await createCategory(managerActor, { name: uniqueName('Used') });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const [drama] = await db
      .insert(dramas)
      .values({
        title: 'Taxonomy usage drama',
        slug: `${TEST_SLUG_PREFIX}drama-${randomUUID().slice(0, 8)}`,
      })
      .returning({ id: dramas.id });

    await db.insert(dramaCategories).values({
      drama_id: drama!.id,
      category_id: created.category.id,
    });

    const result = await deleteCategory(managerActor, created.category.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.usageCount).toBe(1);

    const [stored] = await db
      .select({ deletedAt: categories.deleted_at })
      .from(categories)
      .where(eq(categories.id, created.category.id));

    expect(stored?.deletedAt).not.toBeNull();

    const associations = await db
      .select({ dramaId: dramaCategories.drama_id })
      .from(dramaCategories)
      .where(eq(dramaCategories.category_id, created.category.id));

    expect(associations).toHaveLength(1);
  });

  it('reports a missing category as not found', async () => {
    const result = await deleteCategory(managerActor, randomUUID());

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toMatchObject({ code: 'not_found' });
  });
});

describe('reorderCategories', () => {
  it('writes the given order as positions 0..n-1', async () => {
    const first = await createCategory(managerActor, { name: uniqueName('One') });
    const second = await createCategory(managerActor, { name: uniqueName('Two') });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const result = await reorderCategories(managerActor, [
      second.category.id,
      first.category.id,
    ]);

    expect(result.ok).toBe(true);

    const rows = await db
      .select({ id: categories.id, position: categories.position })
      .from(categories)
      .where(eq(categories.slug, slugFromText(first.category.name)));

    const [secondRow, firstRow] = await Promise.all([
      db
        .select({ position: categories.position })
        .from(categories)
        .where(eq(categories.id, second.category.id)),
      db
        .select({ position: categories.position })
        .from(categories)
        .where(eq(categories.id, first.category.id)),
    ]);

    expect(rows).toHaveLength(1);
    expect(secondRow[0]?.position).toBe(0);
    expect(firstRow[0]?.position).toBe(1);
  });

  it('rejects duplicate ids', async () => {
    const created = await createCategory(managerActor, { name: uniqueName('Duplicate') });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await reorderCategories(managerActor, [
      created.category.id,
      created.category.id,
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toMatchObject({ code: 'validation_error' });
  });

  it('rejects an id that is missing or trashed', async () => {
    const result = await reorderCategories(managerActor, [randomUUID()]);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toMatchObject({ code: 'validation_error' });
  });
});

describe('listCategories', () => {
  it('returns active rows with their usage counts, ordered by position', async () => {
    const firstName = uniqueName('Listed first');
    const secondName = uniqueName('Listed second');
    const first = await createCategory(managerActor, { name: firstName });
    const second = await createCategory(managerActor, { name: secondName });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    await reorderCategories(managerActor, [first.category.id, second.category.id]);

    const result = await listCategories(managerActor);
    const ids = result.categories.map(row => row.id);

    expect(ids.indexOf(first.category.id)).toBeLessThan(ids.indexOf(second.category.id));
    expect(result.categories.find(row => row.id === first.category.id)?.usageCount).toBe(0);
  });
});

describe('createPlatform', () => {
  it('derives the slug and rejects keys platforms do not have', async () => {
    const name = `${NAME_PREFIX}Netflix ${randomUUID().slice(0, 8)}`;
    const created = await createPlatform(managerActor, { name });

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.platform.slug).toBe(slugFromText(name));
    expect(created.platform.visibility).toBeNull();

    await expect(
      createPlatform(managerActor, { name: `${name} Two`, visibility: 'visible' })
    ).rejects.toMatchObject({ code: 'validation_error' });

    const result = await listPlatforms(managerActor);
    expect(result.platforms.map(row => row.id)).toContain(created.platform.id);
  });
});

describe('authorization', () => {
  it('refuses every mutation for an actor without the manage permission', async () => {
    const id = randomUUID();

    const calls = [
      () => createCategory(forbiddenActor, { name: uniqueName('Denied') }),
      () => updateCategory(forbiddenActor, id, { name: 'Denied' }),
      () => deleteCategory(forbiddenActor, id),
      () => reorderCategories(forbiddenActor, [id]),
      () => createPlatform(forbiddenActor, { name: 'Denied' }),
      () => listCategories(forbiddenActor),
      () => listPlatforms(forbiddenActor),
    ];

    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ code: 'forbidden' });
    }
  });
});
