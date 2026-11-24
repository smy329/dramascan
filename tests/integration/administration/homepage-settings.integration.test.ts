import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Homepage settings integration coverage.
 *
 * The homepage reads three settings: the featured item, the hero rotation, and
 * the Trending pins. An administrator changes them through Server Actions that
 * re-check the permission and the availability of every referenced item, write
 * the setting, and leave an operational record.
 *
 * These tests exercise the real PostgreSQL test database, the real workflow,
 * and the real audit trail. Only the session resolution is mocked, because a
 * session cannot exist outside a request.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for homepage settings integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

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

import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import type { ActorContext } from '@/modules/authorization';
import { admin_audit_log, system_settings } from '@/modules/administration/schema';
import { dramas } from '@/modules/content/schema';
import { closePool } from '@/platform/db/pool';
import {
  clearFeaturedContentAction,
  updateFeaturedContentAction,
  updateHeroRotationAction,
  updateTrendingPinsAction,
} from '@/workflows/admin/homepage-settings';

const TEST_PREFIX = 'it-homepage-';

/** The setting keys the homepage pages write. */
const SETTING_KEYS = [
  'featured_content_id',
  'featured_content_type',
  'hero_rotation_enabled',
  'hero_rotation_item_ids',
  'trending_pinned_item_ids',
];

let adminId: string | null = null;
let dramaId: string | null = null;
let draftId: string | null = null;
let settingsSnapshot: Array<typeof system_settings.$inferSelect> = [];

/** The Super Admin the workflow acts as. */
function adminActor(userId: string): ActorContext {
  return {
    userId,
    roles: ['admin'],
    isSuperAdmin: true,
    permissions: ['settings.manage'],
  };
}

async function seed(): Promise<void> {
  adminId = randomUUID();
  dramaId = randomUUID();
  draftId = randomUUID();

  await db.insert(users).values({
    id: adminId,
    name: 'Homepage administrator',
    email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
  });

  await db.insert(dramas).values([
    {
      id: dramaId,
      title: `Homepage drama ${randomUUID().slice(0, 8)}`,
      slug: `${TEST_PREFIX}drama-${randomUUID().slice(0, 12)}`,
      structure_type: 'season_based',
      status: 'ongoing',
      publication_status: 'published',
      visibility: 'coming_soon',
    },
    {
      id: draftId,
      title: `Homepage draft ${randomUUID().slice(0, 8)}`,
      slug: `${TEST_PREFIX}draft-${randomUUID().slice(0, 12)}`,
      structure_type: 'season_based',
      status: 'ongoing',
      publication_status: 'draft',
      visibility: 'coming_soon',
    },
  ]);

  settingsSnapshot = await db
    .select()
    .from(system_settings)
    .where(inArray(system_settings.key, SETTING_KEYS));

  resolveActorMock.mockResolvedValue(adminActor(adminId));
}

async function cleanup(): Promise<void> {
  if (adminId) {
    await db
      .delete(admin_audit_log)
      .where(eq(admin_audit_log.actor_id, adminId));
  }

  if (dramaId || draftId) {
    await db.delete(dramas).where(inArray(dramas.id, [dramaId ?? randomUUID(), draftId ?? randomUUID()]));
  }

  // The setting rows are shared by the whole test database, so the rows this
  // test wrote are removed and the rows it found are written back.
  await db.delete(system_settings).where(inArray(system_settings.key, SETTING_KEYS));

  for (const row of settingsSnapshot) {
    await db.insert(system_settings).values(row);
  }

  settingsSnapshot = [];
  adminId = null;
  dramaId = null;
  draftId = null;
  resolveActorMock.mockReset();
}

beforeEach(async () => {
  await cleanup();
  await seed();
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('the homepage settings workflow', () => {
  it('saves the hero rotation and records the change', async () => {
    const result = await updateHeroRotationAction({
      enabled: true,
      items: [{ type: 'drama', id: dramaId }],
    });

    expect(result.ok).toBe(true);

    const rows = await db
      .select()
      .from(system_settings)
      .where(inArray(system_settings.key, ['hero_rotation_enabled', 'hero_rotation_item_ids']));

    const enabled = rows.find(row => row.key === 'hero_rotation_enabled');
    const items = rows.find(row => row.key === 'hero_rotation_item_ids');

    expect(enabled?.boolean_value).toBe(true);
    expect(items?.value).toEqual([{ type: 'drama', id: dramaId }]);

    const auditRows = await db
      .select()
      .from(admin_audit_log)
      .where(
        and(
          eq(admin_audit_log.actor_id, adminId ?? randomUUID()),
          eq(admin_audit_log.action, 'homepage.hero_rotation.updated')
        )
      );

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.entity_type).toBe('homepage_setting');
  });

  it('saves the Trending pins and records the change', async () => {
    const result = await updateTrendingPinsAction({ items: [{ type: 'drama', id: dramaId }] });

    expect(result.ok).toBe(true);

    const [row] = await db
      .select()
      .from(system_settings)
      .where(eq(system_settings.key, 'trending_pinned_item_ids'));

    expect(row?.value).toEqual([{ type: 'drama', id: dramaId }]);

    const auditRows = await db
      .select()
      .from(admin_audit_log)
      .where(
        and(
          eq(admin_audit_log.actor_id, adminId ?? randomUUID()),
          eq(admin_audit_log.action, 'homepage.trending_pins.updated')
        )
      );

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.entity_type).toBe('homepage_setting');
  });

  it('features a published drama and clears the selection', async () => {
    const featured = await updateFeaturedContentAction({ type: 'drama', id: dramaId });

    expect(featured.ok).toBe(true);

    const [row] = await db
      .select()
      .from(system_settings)
      .where(eq(system_settings.key, 'featured_content_id'));

    expect(row?.string_value).toBe(dramaId);

    const cleared = await clearFeaturedContentAction();

    expect(cleared.ok).toBe(true);

    const clearedRows = await db
      .select()
      .from(system_settings)
      .where(inArray(system_settings.key, ['featured_content_id', 'featured_content_type']));

    expect(clearedRows.every(setting => setting.string_value === null)).toBe(true);

    const auditRows = await db
      .select()
      .from(admin_audit_log)
      .where(
        and(
          eq(admin_audit_log.actor_id, adminId ?? randomUUID()),
          eq(admin_audit_log.action, 'homepage.featured.cleared')
        )
      );

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.entity_type).toBe('homepage_setting');
  });

  it('refuses a selection that names content the public cannot open', async () => {
    const result = await updateTrendingPinsAction({ items: [{ type: 'drama', id: draftId }] });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.message).toBe('One of the selected items is no longer available.');
    }

    const rows = await db
      .select()
      .from(system_settings)
      .where(eq(system_settings.key, 'trending_pinned_item_ids'));

    expect(rows).toHaveLength(0);
  });
});
