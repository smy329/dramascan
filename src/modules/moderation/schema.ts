/**
 * Moderation schema fragment (owned by `moderation`).
 *
 * Tables are added by the moderation data-model prompt.
 * Planned tables: `moderation_actions`. Only the `moderation` module may write
 * these tables. `src/db/schema.ts` assembles this namespace.
 *
 * Moderation actions audit log for review reports and review removals.
 */

import { sql } from 'drizzle-orm';
import {
  checkConstraint,
  foreignKeyConstraint,
  indexOn,
  pgTable,
  text,
  timestamp,
  uuid,
} from '@/platform/db/schema-helpers';

// ----- moderation_actions -----
// Log of moderator actions for audit trail.
// Each action records what the moderator did, when, and why.

export const moderation_actions = pgTable(
  'moderation_actions',
  {
    id: uuidPrimaryKey(),
    action: text('action').notNull(), // e.g. 'report_submitted', 'report_resolved', 'review_removed'
    target_type: text('target_type').notNull(), // e.g. 'review', 'report'
    target_id: uuid('target_id').notNull(),
    actor_user_id: uuid('actor_user_id').notNull(),
    detail: text('detail'), // e.g. resolution outcome, report reason
    created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  table => [
    checkConstraint('moderation_actions', 'action', sql`${table.action} in ('report_submitted', 'report_resolved', 'review_removed')`),
    foreignKeyConstraint('moderation_actions', table.target_id, 'reviews.id', { onDelete: 'restrict' }),
    indexOn('moderation_actions', table.target_id),
    indexOn('moderation_actions', table.actor_user_id),
    indexOn('moderation_actions', table.created_at),
  ]
);

export {};