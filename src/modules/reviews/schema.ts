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
import {
  checkConstraint,
  foreignKeyConstraint,
  indexOn,
  uuidPrimaryKey,
} from '@/platform/db/schema-helpers';

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
    // A rating is a score on a five-point scale. The range is a rule, not a
    // preference, so the database rejects 0, 6, and negatives instead of leaving
    // the invariants to whatever form happened to be used.
    checkConstraint('ratings', 'value_range', sql`${table.value} between 1 and 5`),
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
// One reaction per user per review: reacting twice is the same reaction, and the
// uniqueness is what makes the toggle idempotent instead of accumulating rows.
export const review_reactions = pgTable(
  'review_reactions',
  {
    id: uuidPrimaryKey(),
    user_id: uuid('user_id').notNull(),
    review_id: uuid('review_id').notNull(),
  },
  table => [
    foreignKeyConstraint('review_reactions', table.review_id, reviews.id, { onDelete: 'cascade' }),
    uniqueIndex('uq_review_reactions_user_id_review_id').on(table.user_id, table.review_id),
    indexOn('review_reactions', table.review_id),
  ]
);

// ----- review_reports -----
// A report has a lifecycle: it is opened as `active` and later `resolved`. The
// history is preserved (resolved rows stay), which is why the per-user/review
// uniqueness is partial: a new problem after resolution may be reported again.
// `status` defaults to `active` because every report that existed before this
// column did was still awaiting moderation.
//
// `reported_at` is the truthful submission time. It is null for reports that
// predate the column, because their real submission time is unknowable and a
// migration timestamp would be a fabrication. `created_at` remains the row
// timestamp; for a legacy report it is the moment the row was migrated.
//
// The review reference is `restrict`, not `cascade`: a report is moderation
// history, and permanently removing a review must never silently erase it.
export const review_reports = pgTable(
  'review_reports',
  {
    id: uuidPrimaryKey(),
    user_id: uuid('user_id').notNull(),
    review_id: uuid('review_id').notNull(),
    reason: text('reason').notNull(),
    description: text('description'),
    status: text('status').notNull().default('active'),
    resolved_at: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    resolved_by: uuid('resolved_by'),
    resolution_outcome: text('resolution_outcome'),
    reported_at: timestamp('reported_at', { withTimezone: true, mode: 'date' }).defaultNow(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    checkConstraint('review_reports', 'status', sql`${table.status} in ('active', 'resolved')`),
    // An active report carries no resolution record; a resolved report carries a
    // complete one. A half-recorded resolution is not a state the table accepts.
    checkConstraint(
      'review_reports',
      'lifecycle',
      sql`(
        ${table.status} = 'active'
        and ${table.resolved_at} is null
        and ${table.resolved_by} is null
        and ${table.resolution_outcome} is null
      ) or (
        ${table.status} = 'resolved'
        and ${table.resolved_at} is not null
        and ${table.resolved_by} is not null
        and ${table.resolution_outcome} is not null
      )`
    ),
    foreignKeyConstraint('review_reports', table.review_id, reviews.id, { onDelete: 'restrict' }),
    uniqueIndex('uq_review_reports_user_id_review_id_active')
      .on(table.user_id, table.review_id)
      .where(sql`${table.status} = 'active'`),
    indexOn('review_reports', table.review_id),
    indexOn('review_reports', table.resolved_by),
  ]
);

export type ReviewTables =
  typeof ratings | typeof reviews | typeof review_reactions | typeof review_reports;

export type ReviewSchema =
  typeof ratings | typeof reviews | typeof review_reactions | typeof review_reports;

export {};
