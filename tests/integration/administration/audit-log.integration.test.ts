import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Administration audit log integration coverage.
 *
 * A video-source replacement is an operational event: it changes what every
 * viewer receives and it invalidates every viewer's playback position. The
 * replacement therefore has to leave a record that says who did it, to what,
 * and when.
 *
 * The record must not contain the source URL itself. The URL is
 * administrator-supplied and points at a third-party host; the audit trail
 * needs to record the *fact* of a replacement, not to duplicate the source
 * into a second table that has different retention rules.
 *
 * These tests run against the real PostgreSQL test database.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for audit log integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import { admin_audit_log } from '@/modules/administration/schema';
import { recordAdminAuditEvent } from '@/modules/administration/audit-log';
import { closePool } from '@/platform/db/pool';

const TEST_PREFIX = 'it-audit-';
const VIDEO_SOURCE = 'https://media.example.com/episodes/replacement.mp4';

let actorId: string | null = null;

async function seedActor(): Promise<void> {
  actorId = randomUUID();

  await db.insert(users).values({
    id: actorId,
    name: 'Audit tester',
    email: `${TEST_PREFIX}${randomUUID().slice(0, 8)}@example.com`,
  });
}

async function cleanup(): Promise<void> {
  await db.delete(users).where(eq(users.id, actorId ?? randomUUID()));
  actorId = null;
}

beforeEach(async () => {
  await cleanup();
  await seedActor();
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('recordAdminAuditEvent', () => {
  it('writes one row describing the event', async () => {
    const entityId = randomUUID();

    await recordAdminAuditEvent({
      actorId,
      action: 'episode.video_source.replaced',
      entityType: 'episode',
      entityId,
      summary: 'Episode video source replaced.',
      metadata: { previousSourceHost: 'media.example.com', progressRowsReset: 3 },
    });

    const rows = await db
      .select()
      .from(admin_audit_log)
      .where(eq(admin_audit_log.entity_id, entityId));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_id: actorId,
      action: 'episode.video_source.replaced',
      entity_type: 'episode',
      entity_id: entityId,
      summary: 'Episode video source replaced.',
    });
    expect(rows[0]?.created_at).toBeInstanceOf(Date);
  });

  it('never stores the video source URL', async () => {
    const entityId = randomUUID();

    await recordAdminAuditEvent({
      actorId,
      action: 'episode.video_source.replaced',
      entityType: 'episode',
      entityId,
      summary: 'Episode video source replaced.',
      metadata: {
        previousSource: VIDEO_SOURCE,
        newSource: VIDEO_SOURCE,
      },
    });

    const [row] = await db
      .select()
      .from(admin_audit_log)
      .where(eq(admin_audit_log.entity_id, entityId));

    const serialized = JSON.stringify(row);

    expect(serialized).not.toContain(VIDEO_SOURCE);
    expect(serialized).not.toContain('media.example.com');
  });

  it('strips URL-bearing values from the metadata before writing', async () => {
    const entityId = randomUUID();

    await recordAdminAuditEvent({
      actorId,
      action: 'episode.video_source.replaced',
      entityType: 'episode',
      entityId,
      summary: 'Episode video source replaced.',
      metadata: {
        sourceUrl: VIDEO_SOURCE,
        nested: { url: VIDEO_SOURCE },
        list: [VIDEO_SOURCE],
        safe: 'ok',
      },
    });

    const [row] = await db
      .select()
      .from(admin_audit_log)
      .where(eq(admin_audit_log.entity_id, entityId));

    const serialized = JSON.stringify(row?.metadata ?? {});

    expect(serialized).not.toContain(VIDEO_SOURCE);
    expect(serialized).toContain('ok');
  });

  it('accepts an event without an actor', async () => {
    const entityId = randomUUID();

    await recordAdminAuditEvent({
      actorId: null,
      action: 'episode.video_source.replaced',
      entityType: 'episode',
      entityId,
      summary: 'Episode video source replaced.',
    });

    const [row] = await db
      .select()
      .from(admin_audit_log)
      .where(eq(admin_audit_log.entity_id, entityId));

    expect(row?.actor_id).toBeNull();
    expect(row?.metadata).toEqual({});
  });
});
