/**
 * Administration schema fragment (owned by `administration`).
 *
 * Tables are added by the administrator, settings, and audit implementation
 * prompts. Planned tables: `admin_accounts`, `admin_login_attempts`,
 * `admin_session_events`, `system_settings`, `system_setting_versions`,
 * `admin_dashboard_layouts`, `admin_audit_log`. Only the `administration` module
 * may write these tables. `src/db/schema.ts` assembles this namespace.
 *
 * `admin_audit_log` is the operational record of administrative actions that
 * change what viewers receive. It records *what* happened, to *which* entity,
 * by *whom*, and *when* — it never stores the value that was changed when that
 * value is a URL supplied by an administrator.
 */
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { createdAt, indexOn, uuidPrimaryKey } from '@/platform/db/schema-helpers';

// ----- admin_audit_log -----
export const admin_audit_log = pgTable(
  'admin_audit_log',
  {
    id: uuidPrimaryKey(),
    // The administrator who performed the action. Nullable: a system-initiated
    // action has no human actor. The foreign key to `users` is declared in the
    // SQL migration because `users` belongs to the `auth` module.
    actor_id: uuid('actor_id'),
    // Canonical `resource.action` token, for example
    // `episode.video_source.replaced`.
    action: text('action').notNull(),
    // The type of the entity the action was performed on.
    entity_type: text('entity_type').notNull(),
    // The entity the action was performed on.
    entity_id: uuid('entity_id').notNull(),
    // Short human-readable description of what happened.
    summary: text('summary').notNull(),
    // Structured detail about the event. URL-bearing values are stripped
    // before they reach this column.
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    created_at: createdAt(),
  },
  table => [
    // "What happened to this entity?" — the operational-record lookup.
    indexOn('admin_audit_log', table.entity_type, table.entity_id),
    // "What did this administrator do?" — the per-actor trail.
    indexOn('admin_audit_log', table.actor_id),
    // "What happened recently?" — the chronological feed.
    index('idx_admin_audit_log_created_at').on(table.created_at.desc()),
  ]
);

export type AdministrationTables = typeof admin_audit_log;

export type AdministrationSchema = typeof admin_audit_log;
