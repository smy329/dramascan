import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for similar-drama administration.
 *
 * Uses the real PostgreSQL test database. These tests exist because the
 * previous implementation counted unjoined rows, inserted a bare SELECT into a
 * boolean predicate, and returned flat association rows to a mapper that
 * expected joined drama columns.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for similar-drama integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq, inArray, or } from 'drizzle-orm';

import { db } from '@/db/client';
import type { ActorContext } from '@/modules/authorization';
import { dramas, similar_dramas as similarDramas } from '@/modules/content/schema';
import { closePool } from '@/platform/db/pool';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/platform/errors';
import {
  addSimilarDrama,
  listSimilarDramas,
  loadSimilarDramasPage,
  parseListSimilarDramasQuery,
  removeSimilarDrama,
  reorderSimilarDramas,
  searchSimilarDramaCandidates,
  updateSimilarDramaPosition,
} from '@/workflows/admin/similar-dramas';

const TEST_SLUG_PREFIX = 'it-similar-';
const DRAMA_IDS: string[] = [];

const managerActor: ActorContext = {
  userId: 'it-similar-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['similar_drama.manage'],
};

const readerActor: ActorContext = {
  userId: 'it-similar-reader',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.read'],
};

async function insertDrama(title: string, overrides: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(dramas)
    .values({
      title,
      slug: `${TEST_SLUG_PREFIX}${randomUUID().slice(0, 8)}`,
      ...overrides,
    })
    .returning();

  if (!row) {
    throw new Error('Drama insert returned no row.');
  }

  DRAMA_IDS.push(row.id);
  return row;
}

async function link(dramaId: string, similarDramaId: string, position: number | null) {
  await db
    .insert(similarDramas)
    .values({ drama_id: dramaId, similar_drama_id: similarDramaId, position });
}

async function positions(dramaId: string): Promise<Array<{ id: string; position: number | null }>> {
  return db
    .select({ id: similarDramas.similar_drama_id, position: similarDramas.position })
    .from(similarDramas)
    .where(eq(similarDramas.drama_id, dramaId));
}

async function cleanupTestContent(): Promise<void> {
  const ids = [...DRAMA_IDS];

  if (ids.length === 0) {
    return;
  }

  await db
    .delete(similarDramas)
    .where(or(inArray(similarDramas.drama_id, ids), inArray(similarDramas.similar_drama_id, ids)));
  await db.delete(dramas).where(inArray(dramas.id, ids));
  DRAMA_IDS.length = 0;
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

const defaultQuery = () => parseListSimilarDramasQuery({});

describe('authorization', () => {
  it('rejects every mutation for an actor without similar_drama.manage', async () => {
    const drama = await insertDrama('Parent');
    const target = await insertDrama('Target');

    await expect(listSimilarDramas(readerActor, drama.id, defaultQuery())).rejects.toBeInstanceOf(
      AuthorizationError
    );
    await expect(addSimilarDrama(readerActor, drama.id, target.id)).rejects.toBeInstanceOf(
      AuthorizationError
    );
    await expect(removeSimilarDrama(readerActor, drama.id, target.id)).rejects.toBeInstanceOf(
      AuthorizationError
    );
    await expect(
      updateSimilarDramaPosition(readerActor, drama.id, target.id, 0)
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(reorderSimilarDramas(readerActor, drama.id, [target.id])).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });
});

describe('listSimilarDramas', () => {
  it('returns only the requested drama associations ordered by position then title', async () => {
    const parent = await insertDrama('Parent');
    const otherParent = await insertDrama('Other parent');
    const alpha = await insertDrama('Alpha');
    const beta = await insertDrama('Beta');
    const foreign = await insertDrama('Foreign');

    await link(parent.id, beta.id, 1);
    await link(parent.id, alpha.id, 0);
    await link(otherParent.id, foreign.id, 0);

    const result = await listSimilarDramas(managerActor, parent.id, defaultQuery());

    expect(result.total).toBe(2);
    expect(result.items.map(item => item.title)).toEqual(['Alpha', 'Beta']);
    expect(result.items.map(item => item.position)).toEqual([0, 1]);
  });

  it('filters by target title without escaping the parent scope', async () => {
    const parent = await insertDrama('Parent');
    const otherParent = await insertDrama('Other parent');
    const match = await insertDrama('Glass House');
    const noMatch = await insertDrama('Stone Wall');
    const foreignMatch = await insertDrama('Glass Foreign');

    await link(parent.id, match.id, 0);
    await link(parent.id, noMatch.id, 1);
    await link(otherParent.id, foreignMatch.id, 0);

    const result = await listSimilarDramas(
      managerActor,
      parent.id,
      parseListSimilarDramasQuery({ search: 'glass' })
    );

    expect(result.total).toBe(1);
    expect(result.items.map(item => item.id)).toEqual([match.id]);
  });

  it('excludes soft-deleted targets from the list and the count', async () => {
    const parent = await insertDrama('Parent');
    const active = await insertDrama('Active');
    const deleted = await insertDrama('Deleted', { deleted_at: new Date() });

    await link(parent.id, active.id, 0);
    await link(parent.id, deleted.id, 1);

    const result = await listSimilarDramas(managerActor, parent.id, defaultQuery());

    expect(result.total).toBe(1);
    expect(result.items.map(item => item.id)).toEqual([active.id]);
  });

  it('throws NotFoundError for a missing or trashed parent instead of returning empty success', async () => {
    const trashed = await insertDrama('Trashed parent', { deleted_at: new Date() });

    await expect(
      listSimilarDramas(managerActor, randomUUID(), defaultQuery())
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      listSimilarDramas(managerActor, trashed.id, defaultQuery())
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('paginates with a deterministic tiebreaker', async () => {
    const parent = await insertDrama('Parent');
    const targets = [];

    for (let index = 0; index < 5; index += 1) {
      targets.push(await insertDrama(`Same title ${index + 1}`));
      await link(parent.id, targets[index]!.id, 0);
    }

    const first = await listSimilarDramas(
      managerActor,
      parent.id,
      parseListSimilarDramasQuery({ page: 1, pageSize: 2 })
    );
    const second = await listSimilarDramas(
      managerActor,
      parent.id,
      parseListSimilarDramasQuery({ page: 2, pageSize: 2 })
    );

    expect(first.total).toBe(5);
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);

    const ids = [...first.items, ...second.items].map(item => item.id);
    expect(new Set(ids).size).toBe(4);
  });
});

describe('addSimilarDrama', () => {
  it('appends after the current maximum and returns the joined target', async () => {
    const parent = await insertDrama('Parent');
    const first = await insertDrama('First');
    const second = await insertDrama('Second');

    const addedFirst = await addSimilarDrama(managerActor, parent.id, first.id);
    const addedSecond = await addSimilarDrama(managerActor, parent.id, second.id);

    expect(addedFirst).toMatchObject({ id: first.id, title: 'First', position: 0 });
    expect(addedSecond).toMatchObject({ id: second.id, title: 'Second', position: 1 });
  });

  it('accepts an explicit non-negative position', async () => {
    const parent = await insertDrama('Parent');
    const target = await insertDrama('Target');

    const added = await addSimilarDrama(managerActor, parent.id, target.id, 7);

    expect(added.position).toBe(7);
  });

  it('rejects a duplicate association as a conflict', async () => {
    const parent = await insertDrama('Parent');
    const target = await insertDrama('Target');
    await addSimilarDrama(managerActor, parent.id, target.id);

    await expect(addSimilarDrama(managerActor, parent.id, target.id)).rejects.toBeInstanceOf(
      ConflictError
    );
  });

  it('rejects self-reference as validation failure', async () => {
    const parent = await insertDrama('Parent');

    await expect(addSimilarDrama(managerActor, parent.id, parent.id)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('rejects a missing or trashed target', async () => {
    const parent = await insertDrama('Parent');
    const trashed = await insertDrama('Trashed target', { deleted_at: new Date() });

    await expect(addSimilarDrama(managerActor, parent.id, randomUUID())).rejects.toBeInstanceOf(
      NotFoundError
    );
    await expect(addSimilarDrama(managerActor, parent.id, trashed.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it('rejects a missing parent and leaves no association behind', async () => {
    const target = await insertDrama('Target');

    await expect(addSimilarDrama(managerActor, randomUUID(), target.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(await positions(target.id)).toEqual([]);
  });

  it('rejects a negative or fractional position', async () => {
    const parent = await insertDrama('Parent');
    const target = await insertDrama('Target');

    await expect(addSimilarDrama(managerActor, parent.id, target.id, -1)).rejects.toBeInstanceOf(
      ValidationError
    );
    await expect(addSimilarDrama(managerActor, parent.id, target.id, 1.5)).rejects.toBeInstanceOf(
      ValidationError
    );
  });
});

describe('removeSimilarDrama', () => {
  it('deletes the association', async () => {
    const parent = await insertDrama('Parent');
    const target = await insertDrama('Target');
    await addSimilarDrama(managerActor, parent.id, target.id);

    await removeSimilarDrama(managerActor, parent.id, target.id);

    expect(await positions(parent.id)).toEqual([]);
  });

  it('throws NotFoundError when the association does not exist', async () => {
    const parent = await insertDrama('Parent');
    const target = await insertDrama('Target');

    await expect(removeSimilarDrama(managerActor, parent.id, target.id)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});

describe('updateSimilarDramaPosition', () => {
  it('persists the position and returns the joined target', async () => {
    const parent = await insertDrama('Parent');
    const target = await insertDrama('Target');
    await addSimilarDrama(managerActor, parent.id, target.id, 0);

    const updated = await updateSimilarDramaPosition(managerActor, parent.id, target.id, 3);

    expect(updated).toMatchObject({ id: target.id, title: 'Target', position: 3 });
    expect(await positions(parent.id)).toEqual([{ id: target.id, position: 3 }]);
  });

  it('rejects an invalid position before writing', async () => {
    const parent = await insertDrama('Parent');
    const target = await insertDrama('Target');
    await addSimilarDrama(managerActor, parent.id, target.id, 0);

    await expect(
      updateSimilarDramaPosition(managerActor, parent.id, target.id, -2)
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await positions(parent.id)).toEqual([{ id: target.id, position: 0 }]);
  });
});

describe('reorderSimilarDramas', () => {
  it('assigns contiguous positions in the requested order', async () => {
    const parent = await insertDrama('Parent');
    const first = await insertDrama('First');
    const second = await insertDrama('Second');
    const third = await insertDrama('Third');
    await addSimilarDrama(managerActor, parent.id, first.id, 0);
    await addSimilarDrama(managerActor, parent.id, second.id, 1);
    await addSimilarDrama(managerActor, parent.id, third.id, 2);

    const reordered = await reorderSimilarDramas(managerActor, parent.id, [
      third.id,
      first.id,
      second.id,
    ]);

    expect(reordered.map(item => item.id)).toEqual([third.id, first.id, second.id]);
    expect(reordered.map(item => item.position)).toEqual([0, 1, 2]);

    const persisted = await positions(parent.id);
    expect(persisted.find(row => row.id === third.id)?.position).toBe(0);
    expect(persisted.find(row => row.id === first.id)?.position).toBe(1);
    expect(persisted.find(row => row.id === second.id)?.position).toBe(2);
  });

  it('rejects duplicate ids without changing persisted positions', async () => {
    const parent = await insertDrama('Parent');
    const target = await insertDrama('Target');
    await addSimilarDrama(managerActor, parent.id, target.id, 0);

    await expect(
      reorderSimilarDramas(managerActor, parent.id, [target.id, target.id])
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await positions(parent.id)).toEqual([{ id: target.id, position: 0 }]);
  });

  it('rejects an id that is not associated with the parent', async () => {
    const parent = await insertDrama('Parent');
    const target = await insertDrama('Target');
    const foreign = await insertDrama('Foreign');
    await addSimilarDrama(managerActor, parent.id, target.id, 0);

    await expect(
      reorderSimilarDramas(managerActor, parent.id, [target.id, foreign.id])
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await positions(parent.id)).toEqual([{ id: target.id, position: 0 }]);
  });
});

describe('searchSimilarDramaCandidates', () => {
  it('returns active dramas that are not the parent or already associated', async () => {
    const parent = await insertDrama('Parent');
    const existing = await insertDrama('Glass Existing');
    const candidate = await insertDrama('Glass Candidate');
    const trashed = await insertDrama('Glass Trashed', { deleted_at: new Date() });
    await link(parent.id, existing.id, 0);

    const results = await searchSimilarDramaCandidates(managerActor, parent.id, 'glass');

    expect(results.map(item => item.id)).toEqual([candidate.id]);
    expect(results.some(item => item.id === parent.id || item.id === trashed.id)).toBe(false);
  });

  it('throws NotFoundError for a missing parent', async () => {
    await expect(
      searchSimilarDramaCandidates(managerActor, randomUUID(), 'glass')
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('loadSimilarDramasPage', () => {
  it('returns the parent title with the filtered list', async () => {
    const parent = await insertDrama('Parent');
    const target = await insertDrama('Target');
    await link(parent.id, target.id, 0);

    const page = await loadSimilarDramasPage(managerActor, parent.id, defaultQuery());

    expect(page.drama).toEqual({ id: parent.id, title: 'Parent' });
    expect(page.result.items.map(item => item.id)).toEqual([target.id]);
  });

  it('throws NotFoundError for an unparseable drama id', async () => {
    await expect(
      loadSimilarDramasPage(managerActor, 'not-a-uuid', defaultQuery())
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
