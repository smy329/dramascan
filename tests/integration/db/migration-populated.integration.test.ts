import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Client, type QueryResultRow } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyBackfill, applyValidation, collectReport } from '../../../scripts/data-integrity.mjs';

/**
 * Forward-migration test on a populated database (Phase 4 acceptance criterion).
 *
 * The Phase 4 migration adds foreign keys, CHECK constraints, and unique indexes
 * to tables that production may already hold data for. Applying it to an empty
 * database proves nothing about that, so this suite rebuilds the pre-Phase 4
 * schema, fills it with the data shapes the migration must tolerate (duplicates,
 * orphans, ambiguous legacy targets), and only then applies `0009`.
 *
 * Isolation: creating a scratch database needs `CREATEDB`, which the project's
 * application roles do not have. A disposable schema inside the test database
 * gives the same isolation — every statement runs with `search_path` pointing at
 * it, and `"public".` references in the migration SQL are rewritten to that
 * schema. Nothing in the `public` schema is touched, so this file can run in
 * parallel with the rest of the integration suite.
 */

const SCHEMA = 'it_migration_populated';
const TEST_PREFIX = 'it-migrated-';
// Entries 0..8 are the pre-Phase 4 schema. `0009` and `0010` are applied after
// the legacy data is seeded, because that is the order a production database
// meets them: the data already exists when the integrity work lands.
const MIGRATIONS_TO_REPLAY = 8;

type Param = string | number | boolean | null | Date;

let client: Client;

const ids = {
  userA: '',
  userB: '',
  dramaA: '',
  dramaB: '',
  dramaC: '',
  movieA: '',
  review: '',
  seasonB: '',
  orphanSeason: '',
  ratingInvalid: '',
  duplicateBookmarkA: '',
  duplicateBookmarkB: '',
  orphanUserBookmark: '',
  typedBookmark: '',
};

async function rows<R extends QueryResultRow>(text: string, values: Param[] = []): Promise<R[]> {
  const result = await client.query<R>(text, values);

  return result.rows;
}

async function insertId(text: string, values: Param[] = []): Promise<string> {
  const [row] = await rows<{ id: string }>(text, values);

  return row!.id;
}

/**
 * Split a Drizzle migration into executable statements.
 *
 * Mirrors what the migrator does, including the `--> statement-breakpoint`
 * marker. Comma-only fragments (a trailing breakpoint) are dropped.
 */
function statementsOf(tag: string): string[] {
  const sql = readFileSync(resolve(process.cwd(), `drizzle/${tag}.sql`), 'utf8');

  return sql
    .split('--> statement-breakpoint')
    .map(statement => statement.trim())
    .filter(statement => statement.replace(/--[^\n]*/g, '').trim().length > 0)
    .map(statement => statement.replaceAll('"public".', `"${SCHEMA}".`));
}

function migrationTags(): string[] {
  const journal = JSON.parse(
    readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8').replace(
      /^\uFEFF/,
      ''
    )
  ) as { entries: { idx: number; tag: string }[] };

  return [...journal.entries].sort((a, b) => a.idx - b.idx).map(entry => entry.tag);
}

async function applyMigrationFile(tag: string): Promise<void> {
  for (const statement of statementsOf(tag)) {
    await client.query(statement);
  }
}

/**
 * Data that a populated production database can plausibly hold while the schema
 * is still at `0008`.
 *
 * Every row here is legal for the old schema and illegal for at least one of the
 * new constraints, which is exactly what the migration has to survive.
 */
async function seedLegacyData(): Promise<void> {
  ids.userA = await insertId('INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id', [
    'Legacy Viewer A',
    `${TEST_PREFIX}a-${randomUUID()}@example.com`,
  ]);
  ids.userB = await insertId('INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id', [
    'Legacy Viewer B',
    `${TEST_PREFIX}b-${randomUUID()}@example.com`,
  ]);

  const sharedSlug = `${TEST_PREFIX}shared-slug`;

  ids.dramaA = await insertId('INSERT INTO dramas (title, slug) VALUES ($1, $2) RETURNING id', [
    'Legacy Drama A',
    sharedSlug,
  ]);
  // Same slug as A: legal before `uq_dramas_slug_active` exists.
  ids.dramaB = await insertId(
    'INSERT INTO dramas (title, slug, publication_status) VALUES ($1, $2, $3) RETURNING id',
    ['Legacy Drama B', sharedSlug, 'published']
  );
  ids.movieA = await insertId('INSERT INTO movies (title, slug) VALUES ($1, $2) RETURNING id', [
    'Legacy Movie A',
    `${TEST_PREFIX}movie-a`,
  ]);
  // A drama and a movie that share one id: the legacy pair alone cannot say
  // whether a user-content row pointing at it meant the drama or the movie, so
  // the backfill must leave that row alone.
  ids.dramaC = await insertId('INSERT INTO dramas (title, slug) VALUES ($1, $2) RETURNING id', [
    'Legacy Drama C',
    `${TEST_PREFIX}drama-c`,
  ]);
  await client.query('INSERT INTO movies (id, title, slug) VALUES ($1, $2, $3)', [
    ids.dramaC,
    'Legacy Movie Sharing Drama C Id',
    `${TEST_PREFIX}movie-dup-id`,
  ]);

  ids.seasonB = await insertId(
    'INSERT INTO seasons (drama_id, title, position) VALUES ($1, $2, $3) RETURNING id',
    [ids.dramaB, 'Season One', 1]
  );
  // Duplicate position inside one drama: legal before the scoped unique index.
  await client.query('INSERT INTO seasons (drama_id, title, position) VALUES ($1, $2, $3)', [
    ids.dramaB,
    'Season One Duplicate',
    1,
  ]);
  // Orphan season: nothing references `dramas` before the Phase 4 foreign key.
  ids.orphanSeason = await insertId(
    'INSERT INTO seasons (drama_id, title, position) VALUES ($1, $2, $3) RETURNING id',
    [randomUUID(), 'Orphan Season', 2]
  );

  // Duplicate episode number inside one drama.
  await client.query(
    'INSERT INTO episodes (drama_id, title, episode_number) VALUES ($1, $2, $3), ($1, $4, $3)',
    [ids.dramaA, 'Episode One', 3, 'Episode One Duplicate']
  );
  // Episode whose season belongs to a different drama: legal before the
  // composite foreign key.
  await client.query('INSERT INTO episodes (drama_id, season_id, title) VALUES ($1, $2, $3)', [
    ids.dramaA,
    ids.seasonB,
    'Cross-Parent Episode',
  ]);

  // Out-of-range rating: legal before `ck_ratings_value_range`.
  ids.ratingInvalid = await insertId(
    'INSERT INTO ratings (user_id, drama_id, value) VALUES ($1, $2, $3) RETURNING id',
    [ids.userA, ids.dramaA, 9]
  );

  ids.review = await insertId(
    'INSERT INTO reviews (user_id, drama_id, content) VALUES ($1, $2, $3) RETURNING id',
    [ids.userA, ids.dramaA, 'A review that predates moderation.']
  );
  // Duplicate reactions: legal before `uq_review_reactions_user_id_review_id`.
  await client.query(
    'INSERT INTO review_reactions (user_id, review_id) VALUES ($1, $2), ($1, $2)',
    [ids.userA, ids.review]
  );
  // Two reports from the same user: both become `active`, so the partial unique
  // index cannot be created until a human resolves one of them.
  await client.query(
    'INSERT INTO review_reports (user_id, review_id, reason) VALUES ($1, $2, $3), ($1, $2, $4)',
    [ids.userA, ids.review, 'Spam', 'Still spam']
  );

  // Legacy user-content rows. Only the first row of each table is unambiguous;
  // the third bookmark is the ambiguous one and the fourth is unresolvable.
  await client.query(
    'INSERT INTO bookmarks (user_id, content_type, content_id) VALUES ($1, $2, $3), ($1, $4, $5), ($6, $2, $7), ($6, $2, $8)',
    [ids.userA, 'drama', ids.dramaA, 'movie', ids.movieA, ids.userB, ids.dramaC, randomUUID()]
  );
  // Two legacy rows of one user pointing at the same drama: backfilling both
  // would violate `uq_bookmarks_user_id_drama_id`, so they need a human merge.
  ids.duplicateBookmarkA = await insertId(
    'INSERT INTO bookmarks (user_id, content_type, content_id) VALUES ($1, $2, $3) RETURNING id',
    [ids.userB, 'drama', ids.dramaB]
  );
  ids.duplicateBookmarkB = await insertId(
    'INSERT INTO bookmarks (user_id, content_type, content_id) VALUES ($1, $2, $3) RETURNING id',
    [ids.userB, 'drama', ids.dramaB]
  );
  // A bookmark whose user does not exist: legal before the foreign key, and an
  // update of the row would be rejected by it.
  ids.orphanUserBookmark = await insertId(
    'INSERT INTO bookmarks (user_id, content_type, content_id) VALUES ($1, $2, $3) RETURNING id',
    [randomUUID(), 'drama', ids.dramaA]
  );
  await client.query(
    'INSERT INTO playback_progress (user_id, content_type, content_id) VALUES ($1, $2, $3)',
    [ids.userA, 'drama', ids.dramaB]
  );
  await client.query(
    'INSERT INTO watched_state (user_id, content_type, content_id) VALUES ($1, $2, $3)',
    [ids.userA, 'movie', ids.movieA]
  );
  await client.query(
    'INSERT INTO watch_history (user_id, content_type, content_id) VALUES ($1, $2, $3), ($1, $4, $5)',
    [ids.userA, 'drama', ids.dramaA, 'episode', randomUUID()]
  );

  // Legacy analytics rows. The two event rows name a drama that exists, so the
  // backfill can place them. The daily aggregate has one content-scoped row and
  // one site-wide row, which legitimately has no target at all.
  await client.query('INSERT INTO content_view_events (content_type, content_id) VALUES ($1, $2)', [
    'drama',
    ids.dramaA,
  ]);
  await client.query(
    'INSERT INTO playback_analytics_events (content_type, content_id, event_type) VALUES ($1, $2, $3)',
    ['drama', ids.dramaA, 'play_pause']
  );
  await client.query(
    'INSERT INTO analytics_daily_aggregates (date, content_type, content_id, total_views) VALUES ($1, $2, $3, $4), ($5, NULL, NULL, $6)',
    ['2026-01-02', 'drama', ids.dramaA, 3, '2026-01-02', 9]
  );
}

beforeAll(async () => {
  const connectionString = process.env.TEST_DATABASE_URL;

  if (!connectionString) {
    throw new Error('TEST_DATABASE_URL is required for the populated-migration test.');
  }

  client = new Client({ connectionString });
  await client.connect();

  // A crashed earlier run must not poison this one.
  await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await client.query(`CREATE SCHEMA "${SCHEMA}"`);
  await client.query(`SET search_path TO "${SCHEMA}"`);

  const tags = migrationTags();

  for (const tag of tags.slice(0, MIGRATIONS_TO_REPLAY + 1)) {
    await applyMigrationFile(tag);
  }

  await seedLegacyData();
  await applyMigrationFile(tags[MIGRATIONS_TO_REPLAY + 1]!);
  await applyMigrationFile(tags[MIGRATIONS_TO_REPLAY + 2]!);

  // A row the new release already wrote. Its typed target occupies the unique
  // key that the legacy row of the same user would land on, so the backfill
  // must not place that legacy row.
  ids.typedBookmark = await insertId(
    'INSERT INTO bookmarks (user_id, content_type, content_id, drama_id) VALUES ($1, $2, $3, $3) RETURNING id',
    [ids.userA, 'drama', ids.dramaA]
  );
}, 180_000);

afterAll(async () => {
  if (!client) {
    return;
  }

  await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
  await client.end();
});

describe('migration 0009 on a populated database', () => {
  it('applies without aborting on legacy duplicates, orphans, and ambiguous targets', async () => {
    // Reaching this assertion at all is the point: on a populated database the
    // migration must neither fail nor silently repair data.
    const [tables] = await rows<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.tables
        WHERE table_schema = $1 AND table_name IN ('dramas', 'bookmarks', 'review_reports')`,
      [SCHEMA]
    );

    expect(tables?.count).toBe('3');
  });

  it('keeps every legacy row and leaves published_at null instead of inventing a date', async () => {
    const [counts] = await rows<{
      dramas: string;
      bookmarks: string;
      episodes: string;
      watch_history: string;
    }>(
      `SELECT (SELECT count(*)::text FROM dramas) AS dramas,
              (SELECT count(*)::text FROM bookmarks) AS bookmarks,
              (SELECT count(*)::text FROM episodes) AS episodes,
              (SELECT count(*)::text FROM watch_history) AS watch_history`
    );

    expect(counts).toEqual({ dramas: '3', bookmarks: '8', episodes: '3', watch_history: '2' });

    const [published] = await rows<{ published_at: string | null; publication_status: string }>(
      'SELECT published_at::text, publication_status FROM dramas WHERE id = $1',
      [ids.dramaB]
    );

    expect(published?.publication_status).toBe('published');
    expect(published?.published_at).toBeNull();

    const legacy = await rows<{ content_type: string; content_id: string }>(
      'SELECT content_type, content_id FROM bookmarks WHERE drama_id IS NULL AND movie_id IS NULL ORDER BY content_id'
    );

    expect(legacy.every(row => row.content_id !== null)).toBe(true);
    expect(legacy.map(row => row.content_type).sort()).toEqual([
      'drama',
      'drama',
      'drama',
      'drama',
      'drama',
      'drama',
      'movie',
    ]);
  });

  it('skips only the unique indexes that a legacy duplicate blocks', async () => {
    const present = await rows<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname IN (
         'uq_dramas_slug_active',
         'uq_categories_slug_active',
         'uq_platforms_slug_active',
         'uq_episodes_drama_id_episode_number_active',
         'uq_seasons_drama_id_position_active',
         'uq_review_reactions_user_id_review_id',
         'uq_review_reports_user_id_review_id_active',
         'uq_bookmarks_user_id_drama_id',
         'uq_bookmarks_user_id_movie_id',
         'uq_playback_progress_user_id_episode_id',
         'uq_playback_progress_user_id_movie_id',
         'uq_watched_state_user_id_episode_id',
         'uq_watched_state_user_id_movie_id'
       ) ORDER BY indexname`,
      [SCHEMA]
    );

    expect(present.map(row => row.indexname)).toEqual([
      'uq_bookmarks_user_id_drama_id',
      'uq_bookmarks_user_id_movie_id',
      'uq_categories_slug_active',
      'uq_platforms_slug_active',
      'uq_playback_progress_user_id_episode_id',
      'uq_playback_progress_user_id_movie_id',
      'uq_watched_state_user_id_episode_id',
      'uq_watched_state_user_id_movie_id',
    ]);
  });

  it('adds foreign keys and checks in the NOT VALID posture, so legacy rows are tolerated', async () => {
    const constraints = await rows<{ conname: string; convalidated: boolean }>(
      `SELECT conname, convalidated FROM pg_constraint
        WHERE connamespace = $1::regnamespace
          AND conname IN ('fk_seasons_drama_id', 'fk_episodes_drama_id_season_id',
                          'ck_ratings_value_range', 'ck_bookmarks_target',
                          'ck_review_reports_status')
        ORDER BY conname`,
      [SCHEMA]
    );

    expect(constraints).toEqual([
      { conname: 'ck_bookmarks_target', convalidated: false },
      { conname: 'ck_ratings_value_range', convalidated: false },
      { conname: 'ck_review_reports_status', convalidated: true },
      { conname: 'fk_episodes_drama_id_season_id', convalidated: false },
      { conname: 'fk_seasons_drama_id', convalidated: false },
    ]);
  });

  it('rejects new writes that violate the new constraints, even while they are unvalidated', async () => {
    const failures: string[] = [];

    const attempt = async (label: string, run: () => Promise<unknown>) => {
      try {
        await run();
        failures.push(`${label}: accepted`);
      } catch (error) {
        const code = (error as { code?: string }).code;

        if (!['23503', '23514'].includes(code ?? '')) {
          failures.push(`${label}: unexpected SQLSTATE ${String(code)}`);
        }
      }
    };

    await attempt('episode with a missing drama', () =>
      client.query('INSERT INTO episodes (drama_id, title) VALUES ($1, $2)', [
        randomUUID(),
        'Orphan New Episode',
      ])
    );
    await attempt('episode with another drama season', () =>
      client.query('INSERT INTO episodes (drama_id, season_id, title) VALUES ($1, $2, $3)', [
        ids.dramaA,
        ids.seasonB,
        'New Cross-Parent Episode',
      ])
    );
    await attempt('bookmark with no typed target', () =>
      client.query(
        'INSERT INTO bookmarks (user_id, content_type, content_id) VALUES ($1, $2, $3)',
        [ids.userA, 'drama', ids.dramaA]
      )
    );
    await attempt('bookmark with two typed targets', () =>
      client.query(
        'INSERT INTO bookmarks (user_id, content_type, content_id, drama_id, movie_id) VALUES ($1, $2, $3, $3, $4)',
        [ids.userA, 'drama', ids.dramaA, ids.movieA]
      )
    );
    await attempt('rating above the scale', () =>
      client.query('INSERT INTO ratings (user_id, drama_id, value) VALUES ($1, $2, $3)', [
        ids.userB,
        ids.dramaA,
        6,
      ])
    );

    expect(failures).toEqual([]);
  });
});

describe('migration 0010 on a populated database', () => {
  it('applies without aborting and keeps every legacy analytics row', async () => {
    const [counts] = await rows<{
      view_events: string;
      playback_events: string;
      aggregates: string;
    }>(
      `SELECT (SELECT count(*)::text FROM content_view_events) AS view_events,
              (SELECT count(*)::text FROM playback_analytics_events) AS playback_events,
              (SELECT count(*)::text FROM analytics_daily_aggregates) AS aggregates`
    );

    expect(counts).toEqual({ view_events: '1', playback_events: '1', aggregates: '2' });
  });

  it('leaves the submission time of a legacy report empty instead of inventing one', async () => {
    const reports = await rows<{ reported_at: string | null; status: string }>(
      'SELECT reported_at::text, status FROM review_reports ORDER BY reason'
    );

    expect(reports).toHaveLength(2);
    expect(reports.every(report => report.reported_at === null)).toBe(true);
    expect(reports.every(report => report.status === 'active')).toBe(true);
  });

  it('stamps a new report with its submission time', async () => {
    const [report] = await rows<{ reported_at: string | null }>(
      `INSERT INTO review_reports (user_id, review_id, reason)
       VALUES ($1, $2, 'Spam') RETURNING reported_at::text`,
      [ids.userB, ids.review]
    );

    expect(report?.reported_at).not.toBeNull();
  });

  it('rejects a new analytics row without a typed target', async () => {
    const error = await rows(
      `INSERT INTO content_view_events (content_type, content_id) VALUES ('drama', $1)`,
      [ids.dramaA]
    ).then(
      () => null,
      (failure: { code?: string }) => failure
    );

    expect(error?.code).toBe('23514');
  });

  it('rejects a report whose resolution record is incomplete', async () => {
    const error = await rows(
      `INSERT INTO review_reports (user_id, review_id, reason, status, resolved_at)
       VALUES ($1, $2, 'Spam', 'resolved', now())`,
      [ids.userB, ids.review]
    ).then(
      () => null,
      (failure: { code?: string }) => failure
    );

    expect(error?.code).toBe('23514');
  });

  it('adds the analytics and report constraints in the NOT VALID posture', async () => {
    const constraints = await rows<{ conname: string; convalidated: boolean }>(
      `SELECT conname, convalidated FROM pg_constraint
        WHERE connamespace = $1::regnamespace
          AND conname IN ('fk_content_view_events_drama_id',
                          'fk_content_view_events_movie_id',
                          'fk_playback_analytics_events_drama_id',
                          'fk_playback_analytics_events_movie_id',
                          'fk_analytics_daily_aggregates_drama_id',
                          'fk_analytics_daily_aggregates_movie_id',
                          'fk_review_reports_resolved_by',
                          'ck_content_view_events_target',
                          'ck_playback_analytics_events_target',
                          'ck_analytics_daily_aggregates_target',
                          'ck_review_reports_lifecycle')
        ORDER BY conname`,
      [SCHEMA]
    );

    expect(constraints).toHaveLength(11);
    expect(constraints.every(constraint => constraint.convalidated === false)).toBe(true);
  });
});

describe('operator reconciliation workflow', () => {
  it('reports the rows the backfill must not place', async () => {
    const sections = await collectReport(client);
    const section = (key: string) => sections.find(candidate => candidate.key === key);

    const blocked = section('backfill-blocked-rows')?.rows ?? [];

    // The legacy row of the same user would land on the unique key the typed
    // row already holds.
    expect(blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table_name: 'bookmarks',
          target_type: 'drama',
          id: ids.duplicateBookmarkA,
          reason: 'duplicate-legacy-row',
        }),
        expect.objectContaining({
          table_name: 'bookmarks',
          target_type: 'drama',
          id: ids.duplicateBookmarkB,
          reason: 'duplicate-legacy-row',
        }),
        expect.objectContaining({
          table_name: 'bookmarks',
          target_type: 'drama',
          id: ids.orphanUserBookmark,
          reason: 'missing-user',
        }),
      ])
    );

    // The row the new release already wrote occupies the key of the legacy row
    // of the same user, so that legacy row is blocked as well.
    const legacyTyped = await rows<{ id: string }>(
      'SELECT id FROM bookmarks WHERE content_type = $1 AND content_id = $2 AND drama_id IS NULL',
      ['drama', ids.dramaA]
    );

    expect(blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table_name: 'bookmarks',
          target_type: 'drama',
          id: legacyTyped[0]!.id,
          reason: 'target-already-typed',
        }),
      ])
    );

    // The row whose parent is missing is named by the orphan report.
    expect(section('foreign-key-orphans')?.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table_name: 'bookmarks',
          column_name: 'user_id',
          id: ids.orphanUserBookmark,
        }),
      ])
    );
  });

  it('backfills only unambiguous legacy targets and is idempotent', async () => {
    const first = await applyBackfill(client);

    // The bookmark rows are all blocked: one collides with the typed row, two
    // collide with each other, and one has no user. Every other table is
    // unaffected.
    expect(first).toEqual([0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0]);

    const targets = await rows<{
      table_name: string;
      content_type: string;
      content_id: string;
      typed: string | null;
    }>(
      `SELECT 'bookmarks' AS table_name, content_type, content_id::text AS content_id,
              coalesce(drama_id, movie_id)::text AS typed FROM bookmarks
        WHERE drama_id IS NULL AND movie_id IS NULL
        UNION ALL
        SELECT 'playback_progress', content_type, content_id::text,
               coalesce(drama_id, movie_id)::text FROM playback_progress
        WHERE drama_id IS NULL AND movie_id IS NULL
        UNION ALL
        SELECT 'watched_state', content_type, content_id::text,
               coalesce(drama_id, movie_id)::text FROM watched_state
        WHERE drama_id IS NULL AND movie_id IS NULL
        UNION ALL
        SELECT 'watch_history', content_type, content_id::text,
               coalesce(drama_id, movie_id)::text FROM watch_history
        WHERE drama_id IS NULL AND movie_id IS NULL`
    );

    // The ambiguous row (a drama id that also exists in movies), the row whose
    // legacy type is unknown, and the rows the backfill must not place keep
    // their null typed target: guessing would be worse than leaving the
    // decision to a human.
    const unresolved = targets.filter(row => row.typed === null);

    expect(unresolved).toHaveLength(7);
    expect(unresolved.map(row => row.content_type).sort()).toEqual([
      'drama',
      'drama',
      'drama',
      'drama',
      'drama',
      'drama',
      'episode',
    ]);

    // The analytics rows are placed the same way. The site-wide daily aggregate
    // keeps no target, because it never had one.
    const analyticsTargets = await rows<{ table_name: string; typed: string | null }>(
      `SELECT 'analytics_daily_aggregates' AS table_name, coalesce(drama_id, movie_id)::text AS typed FROM analytics_daily_aggregates
       UNION ALL
       SELECT 'content_view_events', coalesce(drama_id, movie_id)::text FROM content_view_events
       UNION ALL
       SELECT 'playback_analytics_events', coalesce(drama_id, movie_id)::text FROM playback_analytics_events`
    );

    expect(
      [...analyticsTargets].sort((left, right) =>
        `${left.table_name}${left.typed ?? ''}`.localeCompare(
          `${right.table_name}${right.typed ?? ''}`
        )
      )
    ).toEqual([
      { table_name: 'analytics_daily_aggregates', typed: null },
      { table_name: 'analytics_daily_aggregates', typed: ids.dramaA },
      { table_name: 'content_view_events', typed: ids.dramaA },
      { table_name: 'playback_analytics_events', typed: ids.dramaA },
    ]);

    const second = await applyBackfill(client);

    expect(second).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('validates what it can and reports every remaining violation by name', async () => {
    const failures = await applyValidation(client);

    expect(failures.map(failure => `${failure.kind}:${failure.name}`).sort()).toEqual(
      [
        'constraint:ck_bookmarks_target',
        'constraint:ck_ratings_value_range',
        'constraint:ck_watch_history_target',
        'constraint:fk_bookmarks_user_id',
        'constraint:fk_episodes_drama_id_season_id',
        'constraint:fk_seasons_drama_id',
        'index:uq_dramas_slug_active',
        'index:uq_episodes_drama_id_episode_number_active',
        'index:uq_review_reactions_user_id_review_id',
        'index:uq_review_reports_user_id_review_id_active',
        'index:uq_seasons_drama_id_position_active',
      ].sort()
    );
  });

  it('lists the unresolved rows for an operator, read-only', async () => {
    const sections = await collectReport(client);
    const section = (key: string) => sections.find(candidate => candidate.key === key);

    expect(section('invalid-ratings')?.rows).toEqual([
      expect.objectContaining({ id: ids.ratingInvalid, value: 9 }),
    ]);
    expect(section('duplicate-episode-numbers')?.rows).toEqual([
      { drama_id: ids.dramaA, episode_number: 3, rows: '2' },
    ]);
    expect(
      (section('hierarchy-orphans')?.rows ?? [])
        .map((row: { problem: string }) => row.problem)
        .sort()
    ).toEqual(['episode-with-foreign-season', 'season-without-drama']);
    expect(
      (section('missing-unique-indexes')?.rows ?? [])
        .map((row: { name: string }) => row.name)
        .sort()
    ).toEqual([
      'uq_dramas_slug_active',
      'uq_episodes_drama_id_episode_number_active',
      'uq_review_reactions_user_id_review_id',
      'uq_review_reports_user_id_review_id_active',
      'uq_seasons_drama_id_position_active',
    ]);
    expect(section('user-content-without-typed-target')?.rows).toEqual([
      { table_name: 'bookmarks', content_type: 'drama', rows: '6' },
      { table_name: 'watch_history', content_type: 'episode', rows: '1' },
    ]);
    // The analytics rows were placed by the backfill, and a site-wide aggregate
    // is not an unresolved row: it never had a target.
    expect(section('analytics-without-typed-target')?.rows).toEqual([]);
    // The legacy reports keep an empty submission time, and none of them carries
    // a half-recorded resolution.
    expect(
      (section('legacy-reports-without-reported-at')?.rows ?? []).map(
        (row: { id: string }) => row.id
      )
    ).toHaveLength(2);
    expect(section('report-lifecycle-violations')?.rows).toEqual([]);
    expect(
      (section('unvalidated-constraints')?.rows ?? []).map(
        (row: { constraint_name: string }) => row.constraint_name
      )
    ).toContain('ck_bookmarks_target');
  });
});
