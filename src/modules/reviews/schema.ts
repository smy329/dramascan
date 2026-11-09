/**
 * Review schema fragment (owned by `reviews`).
 *
 * Tables are added by the ratings and reviews data-model prompt.
 *
 * Only the `reviews` module may write these tables. `src/db/schema.ts`
 * assembles this namespace.
 */
import { pgTable, text, uuid, integer, timestamp } from 'drizzle-orm/pg-core';

// ----- ratings -----
export const ratings = pgTable('ratings', {
  id: uuid('id').notNull(),
  user_id: uuid('user_id').notNull(),
  drama_id: uuid('drama_id').notNull(),
  value: integer('value').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deleted_at: timestamp('deleted_at', { withTimezone: true }),
});

// ----- reviews -----
export const reviews = pgTable('reviews', {
  id: uuid('id').notNull(),
  user_id: uuid('user_id').notNull(),
  drama_id: uuid('drama_id').notNull(),
  title: text('title'),
  content: text('content').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ----- review_reactions -----
export const review_reactions = pgTable('review_reactions', {
  id: uuid('id').notNull(),
  user_id: uuid('user_id').notNull(),
  review_id: uuid('review_id').notNull(),
});

// ----- review_reports -----
export const review_reports = pgTable('review_reports', {
  id: uuid('id').notNull(),
  user_id: uuid('user_id').notNull(),
  review_id: uuid('review_id').notNull(),
  reason: text('reason').notNull(),
});

export type ReviewTables =
  typeof ratings | typeof reviews | typeof review_reactions | typeof review_reports;

export type ReviewSchema =
  typeof ratings | typeof reviews | typeof review_reactions | typeof review_reports;

export {};
