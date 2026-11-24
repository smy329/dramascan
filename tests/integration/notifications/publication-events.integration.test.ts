import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Publication-to-notification coverage (Prompts 151, 152).
 *
 * The rules this suite pins down:
 *
 *   - Publishing an episode notifies the viewers who bookmarked its drama.
 *   - Publishing a drama or a season notifies the eligible viewers.
 *   - A repeated publication request produces no second notification.
 *   - A viewer who switched the event off is not notified.
 *
 * These tests run against the real PostgreSQL test database.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for notification integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { and, eq, inArray, isNull } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { dramas, episodes, seasons } from '@/modules/content/schema';
import { notifications } from '@/modules/notifications/schema';
import { updateNotificationPreferences } from '@/modules/notifications';
import { userActor } from '@/modules/authorization/actors';
import { bookmarks } from '@/modules/users/schema';
import { publishContent } from '@/workflows/admin/publication';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-publication-events-';

type Seed = {
  viewerId: string;
  adminId: string;
  dramaId: string;
  seasonId: string;
  episodeId: string;
};

async function seed(): Promise<Seed> {
  const viewerId = randomUUID();
  const adminId = randomUUID();
  const dramaId = randomUUID();
  const seasonId = randomUUID();
  const episodeId = randomUUID();

  await db.insert(users).values([
    {
      id: viewerId,
      name: 'Publication viewer',
      email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
    },
    {
      id: adminId,
      name: 'Publication admin',
      email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
    },
  ]);

  await db.insert(dramas).values({
    id: dramaId,
    title: 'Publication drama',
    slug: `${TEST_PREFIX}${randomUUID().slice(0, 8)}`,
    structure_type: 'season_based',
    status: 'ongoing',
    publication_status: 'draft',
    visibility: 'coming_soon',
  });

  await db.insert(seasons).values({
    id: seasonId,
    drama_id: dramaId,
    title: 'Season 1',
    position: 0,
    publication_status: 'draft',
  });

  await db.insert(episodes).values({
    id: episodeId,
    drama_id: dramaId,
    season_id: seasonId,
    title: 'Episode 1',
    episode_number: 1,
    position: 0,
    publication_status: 'draft',
    video_source: 'https://media.example.com/episodes/1.mp4',
  });

  await db.insert(bookmarks).values({
    user_id: viewerId,
    content_type: 'drama',
    content_id: dramaId,
    drama_id: dramaId,
  });

  return { viewerId, adminId, dramaId, seasonId, episodeId };
}

async function cleanup(seeded: Seed): Promise<void> {
  await db
    .delete(notifications)
    .where(inArray(notifications.user_id, [seeded.viewerId, seeded.adminId]));
  await db.delete(bookmarks).where(eq(bookmarks.user_id, seeded.viewerId));
  await db.delete(episodes).where(eq(episodes.id, seeded.episodeId));
  await db.delete(seasons).where(eq(seasons.id, seeded.seasonId));
  await db.delete(dramas).where(eq(dramas.id, seeded.dramaId));
  await db.delete(users).where(inArray(users.id, [seeded.viewerId, seeded.adminId]));
}

async function listNotifications(userId: string): Promise<
  Array<{ eventType: string; contentId: string | null }>
> {
  const rows = await db
    .select({
      eventType: notifications.event_type,
      contentId: notifications.content_id,
    })
    .from(notifications)
    .where(
      and(eq(notifications.user_id, userId), isNull(notifications.deleted_at))
    );

  return rows;
}

describe('publication notifications', () => {
  let seeded: Seed;

  beforeEach(async () => {
    seeded = await seed();
  });

  afterEach(async () => {
    await cleanup(seeded);
  });

  it('notifies the bookmarking viewers when an episode is published', async () => {
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    // The drama and its season have to be published first for the episode to
    // become publicly available.
    await publishContent(actor, { contentType: 'drama', ids: [seeded.dramaId] });
    await publishContent(actor, { contentType: 'season', ids: [seeded.seasonId] });
    await publishContent(actor, { contentType: 'episode', ids: [seeded.episodeId] });

    const rows = await listNotifications(seeded.viewerId);

    expect(
      rows.some(
        row =>
          row.eventType === 'new_episode' && row.contentId === seeded.episodeId
      )
    ).toBe(true);
  });

  it('notifies the eligible viewers when a drama is published', async () => {
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    await publishContent(actor, { contentType: 'drama', ids: [seeded.dramaId] });

    const rows = await listNotifications(seeded.viewerId);

    expect(
      rows.some(row => row.eventType === 'new_drama' && row.contentId === seeded.dramaId)
    ).toBe(true);
  });

  it('notifies the eligible viewers when a season is published', async () => {
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    await publishContent(actor, { contentType: 'drama', ids: [seeded.dramaId] });
    await publishContent(actor, { contentType: 'season', ids: [seeded.seasonId] });

    const rows = await listNotifications(seeded.viewerId);

    expect(
      rows.some(
        row =>
          row.eventType === 'new_drama_season' && row.contentId === seeded.seasonId
      )
    ).toBe(true);
  });

  it('produces no second notification for a repeated publication request', async () => {
    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    await publishContent(actor, { contentType: 'drama', ids: [seeded.dramaId] });
    await publishContent(actor, { contentType: 'drama', ids: [seeded.dramaId] });

    const rows = await listNotifications(seeded.viewerId);
    const dramaNotifications = rows.filter(row => row.eventType === 'new_drama');

    expect(dramaNotifications).toHaveLength(1);
  });

  it('does not notify a viewer who switched the event off', async () => {
    await updateNotificationPreferences(seeded.viewerId, { newDrama: false });

    const actor = userActor(seeded.adminId, { isSuperAdmin: true });

    await publishContent(actor, { contentType: 'drama', ids: [seeded.dramaId] });

    const rows = await listNotifications(seeded.viewerId);

    expect(rows.some(row => row.eventType === 'new_drama')).toBe(false);
  });
});

afterAll(async () => {
  await closePool();
});
