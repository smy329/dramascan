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

import { and, eq, like } from 'drizzle-orm';
import { db } from '@/db/client';
import { dramas, episodes, seasons } from '@/modules/content/schema';
import { closePool } from '@/platform/db/pool';
import { createDrama } from '@/workflows/admin/dramas';
import {
  createEpisode,
  deleteEpisode,
  listEpisodes,
  renumberEpisodes,
  reorderEpisodes,
  updateEpisode,
} from '@/workflows/admin/episodes';
import { createSeason } from '@/workflows/admin/seasons';

const TEST_SLUG_PREFIX = 'it-episode-admin-drama-';

const managerActor = {
  userId: 'it-episode-admin-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['drama.manage', 'season.manage', 'episode.manage'],
} as unknown as ActorContext;

const viewerActor = {
  userId: 'it-episode-admin-viewer',
  roles: ['viewer'],
  isSuperAdmin: false,
  permissions: [],
} as unknown as ActorContext;

function testSlug(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

async function seedDrama(label: string): Promise<string> {
  const created = await createDrama(managerActor, {
    title: `Episode Admin Drama ${label}`,
    slug: testSlug(label),
  });
  if (!created.ok) throw new Error('Failed to seed drama');
  return created.drama.id;
}

async function seedEpisode(
  dramaId: string,
  input: Record<string, unknown> = {}
): Promise<string> {
  const created = await createEpisode(managerActor, dramaId, { title: 'Episode', ...input });
  if (!created.ok) throw new Error('Failed to seed episode');
  return created.episode.id;
}

async function seedSeason(dramaId: string, title: string): Promise<string> {
  const created = await createSeason(managerActor, dramaId, { title, position: 0 });
  if (!created.ok) throw new Error('Failed to seed season');
  return created.season.id;
}

async function cleanup(): Promise<void> {
  const dramaRows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_SLUG_PREFIX}%`));

  for (const row of dramaRows) {
    await db.delete(episodes).where(eq(episodes.drama_id, row.id));
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

describe('episode admin workflow integration', () => {
  it('creates an episode and lists it for the drama', async () => {
    const dramaId = await seedDrama('create-list');

    const created = await createEpisode(managerActor, dramaId, { title: 'First' });
    expect(created.ok).toBe(true);

    const listed = await listEpisodes(managerActor, dramaId, { page: 1, pageSize: 100 });
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('Unexpected failure');

    expect(listed.total).toBe(1);
    expect(listed.episodes[0]?.title).toBe('First');
  });

  it('refuses episode management without episode.manage', async () => {
    const dramaId = await seedDrama('unauthorized');

    await expect(createEpisode(viewerActor, dramaId, { title: 'Forbidden' })).rejects.toThrow();
  });

  it('renames an episode without clearing its existing fields', async () => {
    const dramaId = await seedDrama('rename-keep');
    const seasonId = await seedSeason(dramaId, 'S1');
    const episodeId = await seedEpisode(dramaId, {
      title: 'Original',
      description: 'keep me',
      season_id: seasonId,
      episode_number: 2,
    });

    const updated = await updateEpisode(managerActor, episodeId, { title: 'Renamed' });
    expect(updated.ok).toBe(true);

    const [row] = await db
      .select()
      .from(episodes)
      .where(eq(episodes.id, episodeId));

    // A partial update must not NULL the fields the payload omits.
    expect(row?.title).toBe('Renamed');
    expect(row?.description).toBe('keep me');
    expect(row?.season_id).toBe(seasonId);
    expect(row?.episode_number).toBe(2);
    expect(row?.position).toBe(0);
  });

  it('rejects an update to a duplicate episode number in the same drama', async () => {
    const dramaId = await seedDrama('update-dup');
    await seedEpisode(dramaId, { episode_number: 1 });
    const second = await seedEpisode(dramaId, { episode_number: 2 });

    const updated = await updateEpisode(managerActor, second, { episode_number: 1 });
    expect(updated.ok).toBe(false);
  });

  it('reorders episodes and renumbers them drama-wide', async () => {
    const dramaId = await seedDrama('reorder-renumber');
    const first = await seedEpisode(dramaId, { episode_number: 1 });
    const second = await seedEpisode(dramaId, { episode_number: 2 });

    const reordered = await reorderEpisodes(managerActor, dramaId, [second, first]);
    expect(reordered.ok).toBe(true);

    const rows = await db
      .select({ id: episodes.id, position: episodes.position })
      .from(episodes)
      .where(eq(episodes.drama_id, dramaId))
      .orderBy(episodes.position);

    expect(rows.map(row => row.id)).toEqual([second, first]);

    // Renumbering follows the stored order: the first row in position order
    // becomes episode 1.
    const renumbered = await renumberEpisodes(managerActor, dramaId);
    expect(renumbered.ok).toBe(true);

    const [topRow] = await db
      .select({ id: episodes.id, number: episodes.episode_number })
      .from(episodes)
      .where(and(eq(episodes.drama_id, dramaId), eq(episodes.position, 0)));

    expect(topRow?.id).toBe(second);
    expect(topRow?.number).toBe(1);
  });

  it('soft-deletes an episode and keeps it out of active listings', async () => {
    const dramaId = await seedDrama('soft-delete');
    const episodeId = await seedEpisode(dramaId, { title: 'Victim' });

    const deleted = await deleteEpisode(managerActor, episodeId);
    expect(deleted.ok).toBe(true);

    const [row] = await db
      .select({ deletedAt: episodes.deleted_at })
      .from(episodes)
      .where(eq(episodes.id, episodeId));

    expect(row?.deletedAt).not.toBeNull();

    const listed = await listEpisodes(managerActor, dramaId, { page: 1, pageSize: 100 });
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('Unexpected failure');
    expect(listed.total).toBe(0);
  });
});
