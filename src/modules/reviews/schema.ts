/**
 * Review schema fragment (owned by `reviews`).
 *
 * Tables are added by the ratings and reviews data-model prompt.
 *
 * Only the `reviews` module may write these tables. `src/db/schema.ts`
 * assembles this namespace.
 *
 * Ratings and reviews target exactly one content item: a drama or a standalone
 * movie. Per D-020 the target is expressed with typed nullable foreign keys and
 * an exactly-one CHECK, never a generic polymorphic `content_id`. The FKs to
 * `dramas`/`movies` are declared in SQL migrations because they cross module
 * boundaries.
 */
import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { checkConstraint, uuidPrimaryKey } from '@/platform/db/schema-helpers';

// ----- ratings -----
export const ratings = pgTable(
  'ratings',
  {
    id: uuidPrimaryKey(),
    user_id: uuid('user_id').notNull(),
    drama_id: uuid('drama_id'),
    movie_id: uuid('movie_id'),
    value: integer('value').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  table => [
    checkConstraint(
      'ratings',
      'target',
      sql`(${table.drama_id} is not null and ${table.movie_id} is null) or (${table.drama_id} is null and ${table.movie_id} is not null)`
    ),
    uniqueIndex('uq_ratings_user_id_drama_id_active')
      .on(table.user_id, table.drama_id)
      .where(sql`${table.deleted_at} is null and ${table.drama_id} is not null`),
    uniqueIndex('uq_ratings_user_id_movie_id_active')
      .on(table.user_id, table.movie_id)
      .where(sql`${table.deleted_at} is null and ${table.movie_id} is not null`),
    index('idx_ratings_drama_id').on(table.drama_id),
    index('idx_ratings_movie_id').on(table.movie_id),
  ]
);

// ----- reviews -----
export const reviews = pgTable(
  'reviews',
  {
    id: uuidPrimaryKey(),
    user_id: uuid('user_id').notNull(),
    drama_id: uuid('drama_id'),
    movie_id: uuid('movie_id'),
    title: text('title'),
    content: text('content').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    checkConstraint(
      'reviews',
      'target',
      sql`(${table.drama_id} is not null and ${table.movie_id} is null) or (${table.drama_id} is null and ${table.movie_id} is not null)`
    ),
    // Reviews have no soft delete: removal is permanent, so one review per user
    // per content item is enforced for the whole table.
    uniqueIndex('uq_reviews_user_id_drama_id')
      .on(table.user_id, table.drama_id)
      .where(sql`${table.drama_id} is not null`),
    uniqueIndex('uq_reviews_user_id_movie_id')
      .on(table.user_id, table.movie_id)
      .where(sql`${table.movie_id} is not null`),
    index('idx_reviews_drama_id').on(table.drama_id),
    index('idx_reviews_movie_id').on(table.movie_id),
  ]
);

// ----- review_reactions -----
export const review_reactions = pgTable('review_reactions', {
  id: uuidPrimaryKey(),
  user_id: uuid('user_id').notNull(),
  review_id: uuid('review_id').notNull(),
});

// ----- review_reports -----
export const review_reports = pgTable('review_reports', {
  id: uuidPrimaryKey(),
  user_id: uuid('user_id').notNull(),
  review_id: uuid('review_id').notNull(),
  reason: text('reason').notNull(),
});

export type ReviewTables =
  | typeof ratings
  | typeof reviews
  | typeof review_reactions
  | typeof review_reports;

export type ReviewSchema =
  | typeof ratings
  | typeof reviews
  | typeof review_reactions
  | typeof review_reports;

export {};
