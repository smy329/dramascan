import { randomUUID } from 'node:crypto';
import type { ActorContext } from '@/modules/authorization';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL required');
  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});
vi.mock('server-only', () => ({}));

import { eq, like } from 'drizzle-orm';
import { db } from '@/db/client';
import { dramas, seasons } from '@/modules/content/schema';
import { closePool } from '@/platform/db/pool';
import { createDrama } from '@/workflows/admin/dramas';
import { getDramaForAdmin } from '@/workflows/admin/dramas';
import { createSeason, reorderSeasons } from '@/workflows/admin/seasons';

const TEST_SLUG_PREFIX = 'it-season-admin-drama-';

const managerActor = {
  userId: 'it-season-admin-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.manage', 'season.manage', 'episode.manage'],
} as unknown as ActorContext;

const unauthorizedActor = {
  userId: 'it-season-unauthorized',
  roles: ['viewer'],
  isSuperAdmin: false,
  permissions: [],
} as unknown as ActorContext;

function testSlug(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

async function seedDrama(label: string): Promise<string> {
  const created = await createDrama(managerActor, {
    title: `Season Drama ${label}`,
    slug: testSlug(label),
  });
  if (!created.ok) throw new Error('Failed to seed drama');
  return created.drama.id;
}

async function cleanup(): Promise<void> {
  const dramaRows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_SLUG_PREFIX}%`));

  for (const row of dramaRows) {
    await db.delete(seasons).where(eq(seasons.drama_id, row.id));
    await db.delete(dramas).where(eq(dramas.id, row.id));
  }
}

beforeEach(cleanup);
afterEach(cleanup);
afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('season admin workflow integration', () => {
  it('allocates positions 0 and 1 for two seasons created without explicit position', async () => {
    const dramaId = await seedDrama('pos-alloc');

    // @ts-ignore
    const s1 = await createSeason(managerActor, dramaId, { title: 'First' });
    // @ts-ignore
    const s2 = await createSeason(managerActor, dramaId, { title: 'Second' });

    expect(s1.ok).toBe(true);
    expect(s2.ok).toBe(true);

    const rows = await db
      .select({ position: seasons.position })
      .from(seasons)
      .where(eq(seasons.drama_id, dramaId))
      .orderBy(seasons.position);

    expect(rows.map(r => r.position)).toEqual([0, 1]);
  });

  it('rejects an explicit position that is already taken', async () => {
    const dramaId = await seedDrama('pos-conflict');
    await createSeason(managerActor, dramaId, { title: 'First', position: 0 });

    const s2 = await createSeason(managerActor, dramaId, { title: 'Clash', position: 0 });
    expect(s2.ok).toBe(false);
  });

  it('reorders seasons reversing their positions', async () => {
    const dramaId = await seedDrama('reorder');
    const s1 = (await createSeason(managerActor, dramaId, { title: 'S1', position: 0 })) as any;
    const s2 = (await createSeason(managerActor, dramaId, { title: 'S2', position: 1 })) as any;

    // @ts-ignore
    const result = await reorderSeasons(managerActor, dramaId, [s2.season.id, s1.season.id]);
    expect(result.ok).toBe(true);

    const rows = await db
      .select({ id: seasons.id, position: seasons.position })
      .from(seasons)
      .where(eq(seasons.drama_id, dramaId))
      .orderBy(seasons.position);

    expect(rows.map(r => r.id)).toEqual([s2.season.id, s1.season.id]);
  });

  it('rejects a season reorder from another drama', async () => {
    const d1 = await seedDrama('d1');
    const d2 = await seedDrama('d2');
    const s1 = (await createSeason(managerActor, d1, { title: 'S1', position: 0 })) as any;

    // @ts-ignore
    const result = await reorderSeasons(managerActor, d2, [s1.season.id]);
    expect(result.ok).toBe(false);
  });

  it('getDramaForAdmin denies access to unauthorized actors', async () => {
    const dramaId = await seedDrama('auth');
    // @ts-ignore
    await expect(getDramaForAdmin(unauthorizedActor, dramaId)).rejects.toThrow();
  });

  it('getDramaForAdmin returns null for an unknown drama', async () => {
    // @ts-ignore
    const result = await getDramaForAdmin(managerActor, '00000000-0000-7000-8000-000000000000');
    expect(result).toBeNull();
  });

  it('getDramaForAdmin returns the drama with names and counts', async () => {
    const dramaId = await seedDrama('detail');
    // @ts-ignore
    const result = await getDramaForAdmin(managerActor, dramaId);
    expect(result).not.toBeNull();
    expect(result!.drama.id).toBe(dramaId);
    expect(result!.drama.activeSeasons).toBe(0);
    expect(result!.drama.activeEpisodes).toBe(0);
    expect(result!.categoryNames).toEqual([]);
    expect(result!.platformNames).toEqual([]);
  });
});
