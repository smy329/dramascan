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
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryKeyConstraint, uuidPrimaryKey } from '@/platform/db/schema-helpers';

// Helper: standard columns for mutable entities
const created = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const deleted = timestamp('deleted_at', { withTimezone: true });

// ----- dramas -----
export const dramas = pgTable('dramas', {
  id: uuidPrimaryKey(),
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  poster: text('poster'),
  banner: text('banner'),
  status: text('status'),
  publication_status: text('publication_status'),
  structure_type: text('structure_type').notNull().default('season_based'),
  created_at: created,
  updated_at: updated,
  deleted_at: deleted,
});

// ----- seasons -----
export const seasons = pgTable('seasons', {
  id: uuidPrimaryKey(),
  drama_id: uuid('drama_id').notNull(),
  title: text('title').notNull(),
  position: integer('position'),
  publication_status: text('publication_status'),
  created_at: created,
  updated_at: updated,
  deleted_at: deleted,
});

// ----- episodes -----
export const episodes = pgTable('episodes', {
  id: uuidPrimaryKey(),
  drama_id: uuid('drama_id').notNull(),
  season_id: uuid('season_id'),
  title: text('title').notNull(),
  description: text('description'),
  episode_number: integer('episode_number'),
  position: integer('position'),
  publication_status: text('publication_status'),
  video_source: text('video_source'),
  created_at: created,
  updated_at: updated,
  deleted_at: deleted,
});

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
    publication_status: text('publication_status'),
    video_source: text('video_source'),
    created_at: created,
    updated_at: updated,
    deleted_at: deleted,
  },
  table => [
    // Slugs must stay unique among active movies. Soft-deleted rows keep their
    // slug so Trash/restore cannot silently collide with a live movie.
    uniqueIndex('uq_movies_slug_active')
      .on(table.slug)
      .where(sql`${table.deleted_at} is null`),
  ]
);

// ----- categories -----
export const categories = pgTable('categories', {
  id: uuidPrimaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  visibility: text('visibility'),
  position: integer('position'),
  created_at: created,
  updated_at: updated,
  deleted_at: deleted,
});

// ----- platforms -----
export const platforms = pgTable('platforms', {
  id: uuidPrimaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  position: integer('position'),
  created_at: created,
  updated_at: updated,
  deleted_at: deleted,
});

// ----- drama_categories (join) -----
export const drama_categories = pgTable(
  'drama_categories',
  {
    drama_id: uuid('drama_id').notNull(),
    category_id: uuid('category_id').notNull(),
  },
  table => [primaryKeyConstraint('drama_categories', [table.drama_id, table.category_id])]
);

// ----- drama_platforms (join) -----
export const drama_platforms = pgTable(
  'drama_platforms',
  {
    drama_id: uuid('drama_id').notNull(),
    platform_id: uuid('platform_id').notNull(),
  },
  table => [primaryKeyConstraint('drama_platforms', [table.drama_id, table.platform_id])]
);

// ----- movie_categories (join) -----
export const movie_categories = pgTable(
  'movie_categories',
  {
    movie_id: uuid('movie_id').notNull(),
    category_id: uuid('category_id').notNull(),
  },
  table => [primaryKeyConstraint('movie_categories', [table.movie_id, table.category_id])]
);

// ----- movie_platforms (join) -----
export const movie_platforms = pgTable(
  'movie_platforms',
  {
    movie_id: uuid('movie_id').notNull(),
    platform_id: uuid('platform_id').notNull(),
  },
  table => [primaryKeyConstraint('movie_platforms', [table.movie_id, table.platform_id])]
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
  | typeof sitemap_exclusions;

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
  | typeof sitemap_exclusions;

export {};
