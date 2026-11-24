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
import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import {
  createdAt,
  indexOn,
  updatedAt,
  uuidPrimaryKey,
} from '@/platform/db/schema-helpers';

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
    // The entity the action was performed on. Nullable: a global setting —
    // the featured item, the hero rotation, the Trending pins — is not a
    // content row and has no identifier to point at. Such an event is
    // recorded as `entity_type = 'homepage_setting'` with no entity id.
    entity_id: uuid('entity_id'),
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

// ----- system_settings -----
// A small key/value store for the settings that change what a viewer sees.
// The value is stored in the column that matches its type, so a setting is
// read as the type it was written as: `boolean_value` for a switch,
// `string_value` for a text setting, and `value` for a structured value.
export const system_settings = pgTable(
  'system_settings',
  {
    id: uuidPrimaryKey(),
    // The canonical setting key, for example `hero_rotation_enabled`.
    key: text('key').notNull(),
    description: text('description'),
    boolean_value: boolean('boolean_value'),
    string_value: text('string_value'),
    value: jsonb('value'),
    // The administrator who last changed the setting.
    updated_by: uuid('updated_by'),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  table => [
    // One row per key: a setting has exactly one value.
    uniqueIndex('uq_system_settings_key').on(table.key),
    indexOn('system_settings', table.updated_by),
  ]
);

export type AdministrationTables = typeof admin_audit_log | typeof system_settings;

export type AdministrationSchema = typeof admin_audit_log | typeof system_settings;
