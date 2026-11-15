import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for the normalized publication-status columns.
 *
 * Uses the real PostgreSQL test database built from the ordered SQL migrations
 * and asserts the database-level contract: NOT NULL, default 'draft', and the
 * CHECK constraint over the canonical vocabulary.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for publication schema tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { closePool } from '@/platform/db/pool';

const createdIds: string[] = [];
const createdChildIds: string[] = [];
const createdMovieSlugs: string[] = [];

function uniqueSlug(label: string): string {
  return `it-pub-${label}-${randomUUID().slice(0, 8)}`;
}

async function insertDrama(): Promise<string> {
  const slug = uniqueSlug('drama');
  await db.execute(
    sql.raw(`INSERT INTO "dramas" ("title", "slug") VALUES ('Schema drama', '${slug}')`)
  );
  const { rows } = await db.execute(sql.raw(`SELECT "id" FROM "dramas" WHERE "slug" = '${slug}'`));
  const id = (rows[0] as { id: string }).id;
  createdIds.push(id);
  return id;
}

async function insertChild(table: 'seasons' | 'episodes', dramaId: string, title: string): Promise<string> {
  await db.execute(
    sql.raw(`INSERT INTO "${table}" ("drama_id", "title", "position") VALUES ('${dramaId}', '${title}', 0)`)
  );
  const { rows } = await db.execute(
    sql.raw(`SELECT "id" FROM "${table}" WHERE "drama_id" = '${dramaId}' AND "title" = '${title}'`)
  );
  const id = (rows[0] as { id: string }).id;
  createdChildIds.push(id);
  return id;
}

async function currentStatus(table: string, id: string): Promise<string> {
  const { rows } = await db.execute(sql.raw(`SELECT "publication_status" FROM "${table}" WHERE "id" = '${id}'`));
  return (rows[0] as { publication_status: string }).publication_status;
}

describe('normalized publication_status columns', () => {
  afterAll(async () => {
    for (const id of createdChildIds) {
      await db.execute(sql.raw(`DELETE FROM "episodes" WHERE "id" = '${id}'`));
      await db.execute(sql.raw(`DELETE FROM "seasons" WHERE "id" = '${id}'`));
    }
    for (const id of createdIds) {
      await db.execute(sql.raw(`DELETE FROM "dramas" WHERE "id" = '${id}'`));
    }
    for (const slug of createdMovieSlugs) {
      await db.execute(sql.raw(`DELETE FROM "movies" WHERE "slug" = '${slug}'`));
    }
    await closePool();
  });

  it('defaults a new drama to draft', async () => {
    const id = await insertDrama();

    expect(await currentStatus('dramas', id)).toBe('draft');
  });

  it('rejects a null drama publication status', async () => {
    const slug = uniqueSlug('drama-null');

    await expect(
      db.execute(
        sql.raw(`INSERT INTO "dramas" ("title", "slug", "publication_status") VALUES ('Schema drama', '${slug}', NULL)`)
      )
    ).rejects.toThrow();
  });

  it('rejects a legacy ongoing drama publication status', async () => {
    const slug = uniqueSlug('drama-ongoing');

    await expect(
      db.execute(
        sql.raw(`INSERT INTO "dramas" ("title", "slug", "publication_status") VALUES ('Schema drama', '${slug}', 'ongoing')`)
      )
    ).rejects.toThrow();
  });

  it('defaults a new season to draft and rejects null', async () => {
    const dramaId = await insertDrama();
    const id = await insertChild('seasons', dramaId, 'Schema season 1');

    expect(await currentStatus('seasons', id)).toBe('draft');

    await expect(
      db.execute(
        sql.raw(`INSERT INTO "seasons" ("drama_id", "title", "position", "publication_status") VALUES ('${dramaId}', 'Schema season 2', 1, NULL)`)
      )
    ).rejects.toThrow();
  });

  it('defaults a new episode to draft and rejects legacy ongoing', async () => {
    const dramaId = await insertDrama();
    const id = await insertChild('episodes', dramaId, 'Schema episode 1');

    expect(await currentStatus('episodes', id)).toBe('draft');

    await expect(
      db.execute(
        sql.raw(`INSERT INTO "episodes" ("drama_id", "title", "position", "publication_status") VALUES ('${dramaId}', 'Schema episode 2', 1, 'ongoing')`)
      )
    ).rejects.toThrow();
  });

  it('rejects a null episode publication status', async () => {
    const dramaId = await insertDrama();

    await expect(
      db.execute(
        sql.raw(`INSERT INTO "episodes" ("drama_id", "title", "position", "publication_status") VALUES ('${dramaId}', 'Schema episode 3', 2, NULL)`)
      )
    ).rejects.toThrow();
  });

  it('defaults a new movie to draft and rejects null', async () => {
    const slug = uniqueSlug('movie');
    createdMovieSlugs.push(slug);
    await db.execute(sql.raw(`INSERT INTO "movies" ("title", "slug") VALUES ('Schema movie', '${slug}')`));
    const { rows } = await db.execute(sql.raw(`SELECT "publication_status" FROM "movies" WHERE "slug" = '${slug}'`));
    expect((rows[0] as { publication_status: string }).publication_status).toBe('draft');

    await expect(
      db.execute(
        sql.raw(`INSERT INTO "movies" ("title", "slug", "publication_status") VALUES ('Schema movie', '${slug}-null', NULL)`)
      )
    ).rejects.toThrow();
  });

  it('rejects a legacy completed movie publication status', async () => {
    const slug = uniqueSlug('movie-completed');

    await expect(
      db.execute(
        sql.raw(`INSERT INTO "movies" ("title", "slug", "publication_status") VALUES ('Schema movie', '${slug}', 'completed')`)
      )
    ).rejects.toThrow();
  });
});
