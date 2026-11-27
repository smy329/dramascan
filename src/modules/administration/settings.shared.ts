/**
 * Pure contracts of the system settings.
 *
 * The setting keys and the parser that reads a stored content reference have
 * no database dependency, so they can be unit-tested without a database and
 * reused by the administration interface.
 */

import { z } from 'zod';
import { settingSchema, isSecretSettingKey, sanitizeSettingForExport } from './settings.zod';

/** The settings this application knows about. */
export const SYSTEM_SETTING_KEYS = {
  /** The drama or movie the homepage hero shows. */
  featuredContent: 'featured_content_id',
  /** The type of the featured content: `drama` or `movie`. */
  featuredContentType: 'featured_content_type',
  /** Whether the homepage hero rotates among eligible featured items. */
  heroRotationEnabled: 'hero_rotation_enabled',
  /** The ids of the extra items the hero may rotate through. */
  heroRotationItems: 'hero_rotation_item_ids',
  /** Whether a content item is pinned into the Trending list. */
  trendingPinnedItems: 'trending_pinned_item_ids',
  /** Global empty-drama visibility modes (requirements §4.7). */
  emptyDramaVisibility: 'empty_drama_visibility',
  /** Default Trash retention period in days (requirements §4.8). */
  trashRetentionDays: 'trash_retention_days',
  /** Default playback completion threshold in percent (requirements §7.3). */
  playbackCompletionThresholdPercent: 'playback_completion_threshold_percent',
} as const;

/** Whether a setting takes effect immediately or requires application restart. */
export type SettingActivation = 'immediate' | 'restart-required';

/** Classification of setting activation behavior. */
export const SETTING_ACTIVATION: Record<keyof typeof SYSTEM_SETTING_KEYS, SettingActivation> = {
  featuredContent: 'immediate',
  featuredContentType: 'immediate',
  heroRotationEnabled: 'immediate',
  heroRotationItems: 'immediate',
  trendingPinnedItems: 'immediate',
  emptyDramaVisibility: 'immediate',
  trashRetentionDays: 'restart-required',
  playbackCompletionThresholdPercent: 'immediate',
} as const;

/** The type of a system setting key. */
export type SystemSettingKey = keyof typeof SYSTEM_SETTING_KEYS;

/** A content item named by a setting. */
export type SettingContentRef = {
  type: 'drama' | 'movie';
  id: string;
};

/** Input shape for a validated system setting (Zod schema). */
export type SettingInput = z.infer<typeof import('./settings.zod').settingSchema>;

/**
 * Validate a setting input against the canonical Zod schema.
 * Returns the validated setting or throws a ConfigurationError.
 */
export function validateSettingInput(input: unknown): SettingInput {
  const result = settingSchema.safeParse(input);

  if (!result.success) {
    const issues = result.error.issues.map(
      (issue: { path: readonly unknown[]; message: string }) => issue.message
    ).join('\n');
    throw new Error(`Invalid setting input: ${issues}`);
  }

  return result.data;
}

/**
 * Parse the JSON value of a setting that names content items.
 *
 * The value is untrusted input as far as the parser is concerned: an
 * administrator may have written it by hand, and a future migration may
 * change its shape. Anything that is not a well-formed `{ type, id }` pair is
 * ignored, so a malformed setting degrades to "no selection" instead of
 * breaking the page that reads it.
 */
export function parseSettingContentRefs(value: unknown): SettingContentRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const refs: SettingContentRef[] = [];

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const candidate = entry as { type?: unknown; id?: unknown };

    if (candidate.type !== 'drama' && candidate.type !== 'movie') {
      continue;
    }

    if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
      continue;
    }

    refs.push({ type: candidate.type, id: candidate.id });
  }

  return refs;
}

/**
 * Sanitize a setting value for safe export, redacting any secret-sensitive
 * fields. Returns a plain-object shape suitable for JSON serialization.
 */
export {
  sanitizeSettingForExport,
  isSecretSettingKey,
};
