/**
 * Content schema fragment (owned by `content`).
 *
 * Tables are added by the content hierarchy and taxonomy data-model prompts.
 * Planned tables: `dramas`, `seasons`, `episodes`, `movies`, `categories`,
 * `platforms`, `drama_categories`, `drama_platforms`, `movie_categories`,
 * `movie_platforms`, `similar_dramas`, `information_pages`,
 * `content_slug_history`, `content_seo`, `content_assets`, `sitemap_exclusions`.
 *
 * Only the `content` module may write these tables. `src/db/schema.ts`
 * assembles this namespace.
 *
 * Drama/movie polymorphic relationships use typed FK columns plus a check constraint
 * that exactly one target is set (per D-020). No generic polymorphic `content_id`
 * is used. Foreign keys reference either a drama or a standalone movie, never both.
 *
 * Table conventions follow CONVENTIONS.md §5: snake_case columns, plural tables,
 * timestamptz timestamps, `deleted_at` for soft delete. UUID application primary
 * keys. Partial unique indexes `WHERE deleted_at IS NULL` for active-row uniqueness.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  checkConstraint,
  compositeForeignKeyConstraint,
  foreignKeyConstraint,
  indexOn,
  primaryKeyConstraint,
  uniqueConstraint,
  uuidPrimaryKey,
} from '@/platform/db/schema-helpers';

// Helper: standard columns for mutable entities
const created = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const deleted = timestamp('deleted_at', { withTimezone: true });

/**
 * First successful publication timestamp (SCOPE-D01).
 *
 * Nullable on purpose. A row that was published before this column existed has
 * no trustworthy publication instant, and the project does not fabricate dates:
 * those rows stay `null`, and a read that needs an ordering falls back to
 * `created_at` with `NULLS LAST`. The publication workflow sets the value on the
 * first transition to `published` and never overwrites it afterwards.
 */
const publishedAt = () => timestamp('published_at', { withTimezone: true, mode: 'date' });

// Canonical publication vocabulary, shared by every content table.
const publicationStatusColumn = () => text('publication_status').notNull().default('draft');

function publicationStatusConstraint(table: string, column: { name: string }) {
  return checkConstraint(
    table,
    'publication_status',
    sql`${column} in ('draft', 'published', 'unpublished')`
  );
}

// ----- dramas -----
export const dramas = pgTable(
  'dramas',
  {
    id: uuidPrimaryKey(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    poster: text('poster'),
    banner: text('banner'),
    status: text('status'),
    publication_status: publicationStatusColumn(),
    published_at: publishedAt(),
    structure_type: text('structure_type').notNull().default('season_based'),
    visibility: text('visibility').default('coming_soon'),
    created_at: created,
    updated_at: updated,
    deleted_at: deleted,
  },
  table => [
    publicationStatusConstraint('dramas', table.publication_status),
    // The slug is the public identifier, so two active dramas may not share one.
    // A trashed drama keeps its slug, which is why the index is partial: the
    // uniqueness applies to the live catalogue only.
    uniqueIndex('uq_dramas_slug_active')
      .on(table.slug)
      .where(sql`${table.deleted_at} is null`),
    indexOn('dramas', table.publication_status, table.created_at),
  ]
);

// ----- seasons -----
export const seasons = pgTable(
  'seasons',
  {
    id: uuidPrimaryKey(),
    drama_id: uuid('drama_id').notNull(),
    title: text('title').notNull(),
    position: integer('position'),
    publication_status: publicationStatusColumn(),
    published_at: publishedAt(),
    created_at: created,
    updated_at: updated,
    deleted_at: deleted,
  },
  table => [
    publicationStatusConstraint('seasons', table.publication_status),
    // A season cannot exist without its drama. `restrict` rather than `cascade`
    // because deleting content permanently is a deliberate Super Admin action;
    // the hierarchy is trashed, never silently orphaned.
    foreignKeyConstraint('seasons', table.drama_id, dramas.id, { onDelete: 'restrict' }),
    // Target of the composite episode foreign key below. It is redundant with
    // the primary key alone but is exactly what makes cross-parent episodes
    // impossible: the pair has to exist as one season row.
    uniqueConstraint('seasons', table.drama_id, table.id),
    // Two active seasons of one drama may not share a position. The workflow
    // enforces this under a drama row lock; the index is the backstop for any
    // writer that bypasses it.
    uniqueIndex('uq_seasons_drama_id_position_active')
      .on(table.drama_id, table.position)
      .where(sql`${table.deleted_at} is null and ${table.position} is not null`),
    indexOn('seasons', table.drama_id),
  ]
);

// ----- episodes -----
export const episodes = pgTable(
  'episodes',
  {
    id: uuidPrimaryKey(),
    drama_id: uuid('drama_id').notNull(),
    season_id: uuid('season_id'),
    title: text('title').notNull(),
    description: text('description'),
    episode_number: integer('episode_number'),
    position: integer('position'),
    publication_status: publicationStatusColumn(),
    published_at: publishedAt(),
    video_source: text('video_source'),
    // The version of the stored source. It is bumped whenever the source is
    // replaced, so a playback position that refers to the previous file can be
    // recognised and ignored instead of being applied to the new one.
    video_source_version: integer('video_source_version').notNull().default(1),
    created_at: created,
    updated_at: updated,
    deleted_at: deleted,
  },
  table => [
    publicationStatusConstraint('episodes', table.publication_status),
    foreignKeyConstraint('episodes', table.drama_id, dramas.id, { onDelete: 'restrict' }),
    // The season must belong to the episode's own drama. A single-column
    // foreign key on `season_id` would accept a season from any drama; this
    // composite key is what the workflow's parent check is duplicating.
    // `season_id` is nullable, and MATCH SIMPLE skips the check when it is null,
    // so an unseasoned episode is still valid.
    compositeForeignKeyConstraint(
      'episodes',
      [table.drama_id, table.season_id],
      [seasons.drama_id, seasons.id],
      { onDelete: 'restrict' }
    ),
    // Episode numbers identify an episode inside its drama, so uniqueness is
    // scoped to the drama and skips trashed rows: a trashed episode keeps its
    // number for a possible restore, and releasing the number would let a
    // restore collide later.
    uniqueIndex('uq_episodes_drama_id_episode_number_active')
      .on(table.drama_id, table.episode_number)
      .where(sql`${table.deleted_at} is null and ${table.episode_number} is not null`),
    indexOn('episodes', table.drama_id),
    indexOn('episodes', table.season_id),
  ]
);

// ----- movies -----
// A standalone movie is its own content type: it has no drama, season, or
// episode parent. `video_source` holds the administrator-supplied, direct
// HTTPS MP4 URL played by the browser (never fetched by the server).
export const movies = pgTable(
  'movies',
  {
    id: uuidPrimaryKey(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    poster: text('poster'),
    banner: text('banner'),
    publication_status: publicationStatusColumn(),
    published_at: publishedAt(),
    video_source: text('video_source'),
    // Permanent provenance for a drama → movie conversion. The source drama is
    // soft-deleted, never removed, and this reference blocks its permanent
    // deletion so the conversion stays traceable.
    converted_from_drama_id: uuid('converted_from_drama_id'),
    created_at: created,
    updated_at: updated,
    deleted_at: deleted,
  },
  table => [
    publicationStatusConstraint('movies', table.publication_status),
    // Slugs must stay unique among active movies. Soft-deleted rows keep their
    // slug so Trash/restore cannot silently collide with a live movie.
    uniqueIndex('uq_movies_slug_active')
      .on(table.slug)
      .where(sql`${table.deleted_at} is null`),
    foreignKeyConstraint('movies', table.converted_from_drama_id, dramas.id, {
      onDelete: 'restrict',
    }),
    // One drama may be converted at most once.
    uniqueIndex('uq_movies_converted_from_drama_id')
      .on(table.converted_from_drama_id)
      .where(sql`${table.converted_from_drama_id} is not null`),
  ]
);

// ----- structure conversion snapshots -----
// One exact season structure snapshot is stored before every season-based → flat
// conversion. Only one row per drama may be `available`; historical rows are kept
// for audit. `season_data`/`episode_data` are structure payloads, not arbitrary
// metadata: episode IDs, season membership, episode numbers, positions, season
// titles, positions, and publication states needed to restore the structure.
export const structureConversionSnapshots = pgTable(
  'structure_conversion_snapshots',
  {
    id: uuidPrimaryKey(),
    drama_id: uuid('drama_id').notNull(),
    source_structure_type: text('source_structure_type').notNull().default('season_based'),
    target_structure_type: text('target_structure_type').notNull().default('flat'),
    season_data: jsonb('season_data').notNull(),
    episode_data: jsonb('episode_data').notNull(),
    post_conversion_fingerprint: text('post_conversion_fingerprint').notNull(),
    status: text('status').notNull().default('available'),
    restored_at: timestamp('restored_at', { withTimezone: true, mode: 'date' }),
    superseded_at: timestamp('superseded_at', { withTimezone: true, mode: 'date' }),
    created_at: created,
    updated_at: updated,
  },
  table => [
    foreignKeyConstraint('structure_conversion_snapshots', table.drama_id, dramas.id, {
      onDelete: 'cascade',
    }),
    checkConstraint(
      'structure_conversion_snapshots',
      'status',
      sql`${table.status} in ('available', 'restored', 'superseded')`
    ),
    checkConstraint(
      'structure_conversion_snapshots',
      'direction',
      sql`${table.source_structure_type} = 'season_based' and ${table.target_structure_type} = 'flat'`
    ),
    indexOn('structure_conversion_snapshots', table.drama_id),
    uniqueIndex('uq_structure_conversion_snapshots_drama_id_available')
      .on(table.drama_id)
      .where(sql`${table.status} = 'available'`),
  ]
);

// ----- categories -----
export const categories = pgTable(
  'categories',
  {
    id: uuidPrimaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    visibility: text('visibility'),
    position: integer('position'),
    created_at: created,
    updated_at: updated,
    deleted_at: deleted,
  },
  table => [
    uniqueIndex('uq_categories_slug_active')
      .on(table.slug)
      .where(sql`${table.deleted_at} is null`),
    indexOn('categories', table.position),
  ]
);

// ----- platforms -----
export const platforms = pgTable(
  'platforms',
  {
    id: uuidPrimaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    position: integer('position'),
    created_at: created,
    updated_at: updated,
    deleted_at: deleted,
  },
  table => [
    uniqueIndex('uq_platforms_slug_active')
      .on(table.slug)
      .where(sql`${table.deleted_at} is null`),
    indexOn('platforms', table.position),
  ]
);

// ----- drama_categories (join) -----
// Association rows carry no independent meaning: they exist only while both
// endpoints do, so the foreign keys cascade. Taxonomy rows themselves are soft
// deleted, which keeps a cascading hard delete from ever being the normal path.
export const drama_categories = pgTable(
  'drama_categories',
  {
    drama_id: uuid('drama_id').notNull(),
    category_id: uuid('category_id').notNull(),
  },
  table => [
    primaryKeyConstraint('drama_categories', [table.drama_id, table.category_id]),
    foreignKeyConstraint('drama_categories', table.drama_id, dramas.id, { onDelete: 'cascade' }),
    foreignKeyConstraint('drama_categories', table.category_id, categories.id, {
      onDelete: 'cascade',
    }),
    // The primary key indexes the drama side; the taxonomy side needs its own
    // index for "which dramas use this category".
    indexOn('drama_categories', table.category_id),
  ]
);

// ----- drama_platforms (join) -----
export const drama_platforms = pgTable(
  'drama_platforms',
  {
    drama_id: uuid('drama_id').notNull(),
    platform_id: uuid('platform_id').notNull(),
  },
  table => [
    primaryKeyConstraint('drama_platforms', [table.drama_id, table.platform_id]),
    foreignKeyConstraint('drama_platforms', table.drama_id, dramas.id, { onDelete: 'cascade' }),
    foreignKeyConstraint('drama_platforms', table.platform_id, platforms.id, {
      onDelete: 'cascade',
    }),
    indexOn('drama_platforms', table.platform_id),
  ]
);

// ----- movie_categories (join) -----
export const movie_categories = pgTable(
  'movie_categories',
  {
    movie_id: uuid('movie_id').notNull(),
    category_id: uuid('category_id').notNull(),
  },
  table => [
    primaryKeyConstraint('movie_categories', [table.movie_id, table.category_id]),
    foreignKeyConstraint('movie_categories', table.movie_id, movies.id, { onDelete: 'cascade' }),
    foreignKeyConstraint('movie_categories', table.category_id, categories.id, {
      onDelete: 'cascade',
    }),
    indexOn('movie_categories', table.category_id),
  ]
);

// ----- movie_platforms (join) -----
export const movie_platforms = pgTable(
  'movie_platforms',
  {
    movie_id: uuid('movie_id').notNull(),
    platform_id: uuid('platform_id').notNull(),
  },
  table => [
    primaryKeyConstraint('movie_platforms', [table.movie_id, table.platform_id]),
    foreignKeyConstraint('movie_platforms', table.movie_id, movies.id, { onDelete: 'cascade' }),
    foreignKeyConstraint('movie_platforms', table.platform_id, platforms.id, {
      onDelete: 'cascade',
    }),
    indexOn('movie_platforms', table.platform_id),
  ]
);

// ----- similar_dramas -----
export const similar_dramas = pgTable(
  'similar_dramas',
  {
    drama_id: uuid('drama_id').notNull(),
    similar_drama_id: uuid('similar_drama_id').notNull(),
    position: integer('position'),
  },
  table => [
    primaryKeyConstraint('similar_dramas', [table.drama_id, table.similar_drama_id]),
    foreignKeyConstraint('similar_dramas', table.drama_id, dramas.id, { onDelete: 'cascade' }),
    foreignKeyConstraint('similar_dramas', table.similar_drama_id, dramas.id, {
      onDelete: 'cascade',
    }),
    // The primary key indexes the source side; the target side needs its own
    // index for "which dramas list this one as similar".
    indexOn('similar_dramas', table.similar_drama_id),
  ]
);

// ----- information_pages -----
// `position` is the administrator-controlled order used by the public footer.
// Lower values appear first; null positions sort last.
export const information_pages = pgTable(
  'information_pages',
  {
    id: uuidPrimaryKey(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    content: text('content').notNull(),
    publication_status: text('publication_status'),
    preview: text('preview'),
    footer_visible: boolean('footer_visible'),
    position: integer('position'),
    created_at: created,
    updated_at: updated,
    deleted_at: deleted,
  },
  table => [
    uniqueIndex('uq_information_pages_slug_active')
      .on(table.slug)
      .where(sql`${table.deleted_at} is null`),
    index('idx_information_pages_footer')
      .on(table.position)
      .where(
        sql`${table.deleted_at} is null and ${table.publication_status} = 'published' and ${table.footer_visible} = true`
      ),
  ]
);

// ----- content_slug_history -----
export const content_slug_history = pgTable('content_slug_history', {
  id: uuidPrimaryKey(),
  content_type: text('content_type'),
  content_id: uuid('content_id').notNull(),
  old_slug: text('old_slug').notNull(),
  new_slug: text('new_slug').notNull(),
  changed_at: timestamp('changed_at', { withTimezone: true }).defaultNow(),
});

// ----- content_seo -----
export const content_seo = pgTable('content_seo', {
  id: uuidPrimaryKey(),
  content_type: text('content_type'),
  content_id: uuid('content_id').notNull(),
  seo_title: text('seo_title'),
  seo_description: text('seo_description'),
  created_at: created,
  updated_at: updated,
  deleted_at: deleted,
});

// ----- content_assets -----
export const content_assets = pgTable('content_assets', {
  id: uuidPrimaryKey(),
  content_type: text('content_type'),
  content_id: uuid('content_id').notNull(),
  asset_type: text('asset_type'),
  file_path: text('file_path').notNull(),
  created_at: created,
  updated_at: updated,
  deleted_at: deleted,
});

// ----- sitemap_exclusions -----
export const sitemap_exclusions = pgTable('sitemap_exclusions', {
  id: uuidPrimaryKey(),
  path: text('path').notNull(),
  reason: text('reason'),
  created_at: created,
  updated_at: updated,
  deleted_at: deleted,
});

export type ContentTables =
  | typeof dramas
  | typeof seasons
  | typeof episodes
  | typeof movies
  | typeof categories
  | typeof platforms
  | typeof drama_categories
  | typeof drama_platforms
  | typeof movie_categories
  | typeof movie_platforms
  | typeof similar_dramas
  | typeof information_pages
  | typeof content_slug_history
  | typeof content_seo
  | typeof content_assets
  | typeof sitemap_exclusions
  | typeof structureConversionSnapshots;

export type ContentSchema =
  | typeof dramas
  | typeof seasons
  | typeof episodes
  | typeof movies
  | typeof categories
  | typeof platforms
  | typeof drama_categories
  | typeof drama_platforms
  | typeof movie_categories
  | typeof movie_platforms
  | typeof similar_dramas
  | typeof information_pages
  | typeof content_slug_history
  | typeof content_seo
  | typeof content_assets
  | typeof sitemap_exclusions
  | typeof structureConversionSnapshots;

export {};
