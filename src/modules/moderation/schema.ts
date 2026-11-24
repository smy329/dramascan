/**
 * Moderation schema fragment (owned by `moderation`).
 *
 * Tables are added by the moderation data-model prompt.
 * Owned tables: `moderation_actions`. Only the `moderation` module may write
 * these tables. `src/db/schema.ts` assembles this namespace.
 *
 * Moderation actions audit log for review reports and review removals.
 *
 * The audit row records *what happened*, to *which target*, by *whom*, and
 * *when*. `target_id` is an immutable snapshot of the target's id, not a live
 * foreign key: a permanently removed review no longer exists, and an audit
 * record that refuses to be written because its subject was deleted would
 * destroy exactly the history it is meant to preserve. Cross-module foreign
 * keys are declared in SQL migrations, so no live reference appears here.
 */

import { sql } from 'drizzle-orm';
import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import {
  checkConstraint,
  createdAt,
  indexOn,
  uuidPrimaryKey,
} from '@/platform/db/schema-helpers';

// ----- moderation_actions -----
// Log of moderator actions for audit trail.
// Each action records what the moderator did, when, and why.

/** The moderator actions the audit log accepts. */
export const MODERATION_ACTION_TYPES = [
  'report_submitted',
  'report_resolved',
  'review_removed',
] as const;

export type ModerationActionType = (typeof MODERATION_ACTION_TYPES)[number];

/** The kinds of target a moderation action can refer to. */
export const MODERATION_TARGET_TYPES = ['review', 'report'] as const;

export type ModerationTargetType = (typeof MODERATION_TARGET_TYPES)[number];

export const moderation_actions = pgTable(
  'moderation_actions',
  {
    id: uuidPrimaryKey(),
    action: text('action').notNull(), // report_submitted | report_resolved | review_removed
    target_type: text('target_type').notNull(), // review | report
    // Immutable snapshot of the target id. It is not a live foreign key: a
    // permanently removed review no longer exists, and the audit trail must
    // survive that.
    target_id: uuid('target_id').notNull(),
    // Nullable: a moderation audit row outlives the administrator who wrote
    // it. Deleting an account sets the actor to NULL instead of deleting the
    // audit trail.
    actor_user_id: uuid('actor_user_id'),
    detail: text('detail'), // resolution outcome, report reason
    created_at: createdAt(),
  },
  table => [
    checkConstraint(
      'moderation_actions',
      'action',
      sql`${table.action} in ('report_submitted', 'report_resolved', 'review_removed')`
    ),
    checkConstraint(
      'moderation_actions',
      'target_type',
      sql`${table.target_type} in ('review', 'report')`
    ),
    indexOn('moderation_actions', table.target_id),
    indexOn('moderation_actions', table.actor_user_id),
    index('idx_moderation_actions_created_at').on(table.created_at.desc()),
  ]
);

export type ModerationTables = typeof moderation_actions;

export type ModerationSchema = typeof moderation_actions;

export {};
