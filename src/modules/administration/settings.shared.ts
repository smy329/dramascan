/**
 * Pure contracts of the system settings.
 *
 * The setting keys and the parser that reads a stored content reference have
 * no database dependency, so they can be unit-tested without a database and
 * reused by the administration interface.
 */

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
} as const;

export type SystemSettingKey = (typeof SYSTEM_SETTING_KEYS)[keyof typeof SYSTEM_SETTING_KEYS];

/** A content item named by a setting. */
export type SettingContentRef = {
  type: 'drama' | 'movie';
  id: string;
};

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
