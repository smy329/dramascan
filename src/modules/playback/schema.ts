/**
 * Playback schema fragment (owned by `playback`).
 *
 * Tables are added by the bookmark and viewing data-model prompts.
 * Planned tables: `subtitle_tracks`, `playback_progress`, `watch_history`,
 * `episode_watch_state`. Only the `playback` module may write these tables.
 * `src/db/schema.ts` assembles this namespace.
 *
 * Scope note: `playback_progress`, `watched_state`, and `watch_history` are
 * owned by the `users` module in the current code base and are left there;
 * moving them is a separate refactor. This fragment owns the two tables the
 * direct-video workflow introduces:
 *
 * - `subtitle_tracks`: the administrator-supplied subtitle files an episode
 *   offers, with their language, format, and default-track selection. The
 *   browser fetches them directly from the external host; the server never
 *   downloads, converts, or rehosts a subtitle file.
 * - `playback_failure_reports`: viewer-reported failures of an external
 *   source, so an administrator can see which episodes are not playing. The
 *   report never stores the source URL: it describes the failure, not the
 *   source.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { createdAt, indexOn, updatedAt, uuidPrimaryKey } from '@/platform/db/schema-helpers';

import type { SubtitleFormat } from './validation';

/** `uniqueIndex` with the project's constraint naming convention. */
function uniqueIndexOn(table: string, ...columns: AnyPgColumn[]) {
  const name = `uq_${table}_${columns.map(column => column.name).join('_')}`;

  return uniqueIndex(name).on(...(columns as [AnyPgColumn, ...AnyPgColumn[]]));
}

// ----- subtitle_tracks -----
export const subtitle_tracks = pgTable(
  'subtitle_tracks',
  {
    id: uuidPrimaryKey(),
    // The episode the track belongs to. The foreign key to `episodes` is
    // declared in the SQL migration because `episodes` belongs to the
    // `content` module.
    episode_id: uuid('episode_id').notNull(),
    // BCP 47 language tag, for example `en` or `pt-BR`.
    language: text('language').notNull(),
    // Human-readable label shown in the player, for example `English`.
    label: text('label').notNull(),
    // The administrator-supplied, direct HTTPS subtitle URL. The browser
    // fetches it directly; the server never fetches or proxies it.
    source_url: text('source_url').notNull(),
    // Subtitle file format: `vtt`, `srt`, `ssa`, `ass`, or `json`.
    // The type narrowing keeps the format a closed set all the way to the
    // player, which has to hand Vidstack a format it understands.
    format: text('format').notNull().$type<SubtitleFormat>(),
    // Whether this track is selected by default.
    is_default: boolean('is_default').notNull().default(false),
    created_at: createdAt(),
    updated_at: updatedAt(),
  },
  table => [
    // One track per language per episode: adding a track for a language that
    // already has one replaces it instead of stacking duplicates.
    uniqueIndexOn('subtitle_tracks', table.episode_id, table.language),
    // At most one default track per episode.
    uniqueIndex('uq_subtitle_tracks_episode_id_default')
      .on(table.episode_id)
      .where(sql`${table.is_default}`),
    indexOn('subtitle_tracks', table.episode_id),
  ]
);

// ----- playback_failure_reports -----
export const playback_failure_reports = pgTable(
  'playback_failure_reports',
  {
    id: uuidPrimaryKey(),
    // The episode whose source failed to play. The foreign key to `episodes`
    // is declared in the SQL migration.
    episode_id: uuid('episode_id').notNull(),
    // The viewer who reported the failure. Nullable: an anonymous viewer can
    // report a failure too. The foreign key to `users` is declared in the SQL
    // migration because `users` belongs to the `auth` module.
    reported_by: uuid('reported_by'),
    // Why the source failed: `network`, `media`, `cors`, `unsupported`, or
    // `unknown`.
    reason: text('reason').notNull(),
    // Optional short detail supplied by the reporter.
    detail: text('detail'),
    created_at: createdAt(),
  },
  table => [
    // "Which episodes are failing?" — the admin list, newest first.
    index('idx_playback_failure_reports_episode_id_created_at').on(
      table.episode_id,
      table.created_at.desc()
    ),
    index('idx_playback_failure_reports_created_at').on(table.created_at.desc()),
    indexOn('playback_failure_reports', table.reported_by),
  ]
);

export type PlaybackTables = typeof subtitle_tracks | typeof playback_failure_reports;

export type PlaybackSchema = typeof subtitle_tracks | typeof playback_failure_reports;
