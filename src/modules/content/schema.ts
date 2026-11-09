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
import { pgTable, text, timestamp, uuid, integer, boolean } from 'drizzle-orm/pg-core';

// Helper: standard columns for mutable entities
const pk = uuid('id').notNull();
const created = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updated = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const deleted = timestamp('deleted_at', { withTimezone: true });

// ----- dramas -----
export const dramas = pgTable('dramas', {
  id: pk,
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  poster: text('poster'),
  banner: text('banner'),
  status: text('status'),
  publication_status: text('publication_status'),
  created_at: created,
  updated_at: updated,
  deleted_at: deleted,
});

// ----- seasons -----
export const seasons = pgTable('seasons', {
  id: pk,
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
  id: pk,
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
export const movies = pgTable('movies', {
  id: pk,
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  poster: text('poster'),
  banner: text('banner'),
  publication_status: text('publication_status'),
  created_at: created,
  updated_at: updated,
  deleted_at: deleted,
});

// ----- categories -----
export const categories = pgTable('categories', {
  id: pk,
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
  id: pk,
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  position: integer('position'),
  created_at: created,
  updated_at: updated,
  deleted_at: deleted,
});

// ----- drama_categories (join) -----
export const drama_categories = pgTable('drama_categories', {
  drama_id: uuid('drama_id').notNull(),
  category_id: uuid('category_id').notNull(),
});

// ----- drama_platforms (join) -----
export const drama_platforms = pgTable('drama_platforms', {
  drama_id: uuid('drama_id').notNull(),
  platform_id: uuid('platform_id').notNull(),
});

// ----- movie_categories (join) -----
export const movie_categories = pgTable('movie_categories', {
  movie_id: uuid('movie_id').notNull(),
  category_id: uuid('category_id').notNull(),
});

// ----- movie_platforms (join) -----
export const movie_platforms = pgTable('movie_platforms', {
  movie_id: uuid('movie_id').notNull(),
  platform_id: uuid('platform_id').notNull(),
});

// ----- similar_dramas -----
export const similar_dramas = pgTable('similar_dramas', {
  drama_id: uuid('drama_id').notNull(),
  similar_drama_id: uuid('similar_drama_id').notNull(),
  position: integer('position'),
});

// ----- information_pages -----
export const information_pages = pgTable('information_pages', {
  id: pk,
  title: text('title').notNull(),
  slug: text('slug').notNull(),
  content: text('content').notNull(),
  publication_status: text('publication_status'),
  preview: text('preview'),
  footer_visible: boolean('footer_visible'),
  created_at: created,
  updated_at: updated,
  deleted_at: deleted,
});

// ----- content_slug_history -----
export const content_slug_history = pgTable('content_slug_history', {
  id: pk,
  content_type: text('content_type'),
  content_id: uuid('content_id').notNull(),
  old_slug: text('old_slug').notNull(),
  new_slug: text('new_slug').notNull(),
  changed_at: timestamp('changed_at', { withTimezone: true }).defaultNow(),
});

// ----- content_seo -----
export const content_seo = pgTable('content_seo', {
  id: pk,
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
  id: pk,
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
  id: pk,
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
