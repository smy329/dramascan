import 'server-only';

import { getPublicContentTarget } from '@/modules/content';

/**
 * The analytics content targets (Prompts 139–142).
 *
 * A view may only be counted for a title the public can actually open.
 * Without this check a caller could inflate the count of a draft by posting
 * its id, so the check lives with the content module's own rules.
 */

/**
 * Check that a content item is publicly available.
 *
 * @param type the content type
 * @param contentId the content id
 * @returns whether the content is publicly available
 */
export async function isPublicAnalyticsTarget(
  type: 'drama' | 'movie',
  contentId: string
): Promise<boolean> {
  const target = await getPublicContentTarget(type, contentId);

  return target !== null;
}
