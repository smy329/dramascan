import 'server-only';

import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { serverConfig } from '@/platform/config';

import { evaluatePublicDramaDiscovery } from './public-dramas.shared';
import { listPublicDramaEpisodes } from './public-episodes';
import { isPubliclyPlayableMovie } from './public-movies.shared';
import { content_slug_history, dramas, movies } from './schema';

/**
 * Public slug resolution.
 *
 * The canonical URL of a drama or a movie carries its slug (requirements
 * §6.6). When an administrator changes that slug, the old URL has to keep
 * working: it redirects to the new canonical URL instead of answering 404.
 *
 * The content module owns the redirect lookup because it owns the content and
 * the slug history. The rule is deliberately narrow:
 *
 *  - The requested slug has to be a slug this content item really used. A
 *    guessed slug is still a 404; the resolver never invents a redirect.
 *  - The content item has to be publicly available. The redirect must not
 *    reveal the current slug of a draft or trashed item.
 */

/** The content types whose public URL carries a slug. */
export type PublicSluggedType = 'drama' | 'movie';

/**
 * The current slug of a content item, when the requested slug is one of its
 * old slugs.
 *
 * Returns `null` when the item does not exist, is not publicly available, or
 * never used the requested slug.
 *
 * @param type           The content type of the item.
 * @param contentId      The stable id of the item.
 * @param requestedSlug  The slug the visitor asked for.
 */
export async function resolvePublicContentSlug(
  type: PublicSluggedType,
  contentId: string,
  requestedSlug: string
): Promise<string | null> {
  if (type === 'movie') {
    const [row] = await db
      .select({
        slug: movies.slug,
        publicationStatus: movies.publication_status,
        deleted: movies.deleted_at,
        videoSource: movies.video_source,
      })
      .from(movies)
      .where(eq(movies.id, contentId))
      .limit(1);

    if (!row) {
      return null;
    }

    const hasSource = typeof row.videoSource === 'string' && row.videoSource.trim().length > 0;
    const playable = isPubliclyPlayableMovie({
      publicationStatus: row.publicationStatus,
      deleted: row.deleted !== null,
      hasSource,
    });

    if (!playable) {
      return null;
    }

    return findCurrentSlug('movie', contentId, requestedSlug, row.slug);
  }

  const [row] = await db
    .select({
      slug: dramas.slug,
      publicationStatus: dramas.publication_status,
      deleted: dramas.deleted_at,
      visibility: dramas.visibility,
    })
    .from(dramas)
    .where(eq(dramas.id, contentId))
    .limit(1);

  if (!row) {
    return null;
  }

  const episodes = await listPublicDramaEpisodes(contentId);

  const discovery = evaluatePublicDramaDiscovery({
    publicationStatus: row.publicationStatus,
    deleted: row.deleted !== null,
    visibility: row.visibility,
    hasPlayableEpisode: episodes.length > 0,
    emptyDramaVisibility: serverConfig.emptyDramaVisibility,
  });

  if (!discovery.discoverable) {
    return null;
  }

  return findCurrentSlug('drama', contentId, requestedSlug, row.slug);
}

/**
 * The current slug, when the requested one is in the item's slug history.
 *
 * The history records every change, so an old slug that was used twice is
 * still found. The redirect always points at the *current* slug, never at the
 * slug the item had at the time.
 */
async function findCurrentSlug(
  type: PublicSluggedType,
  contentId: string,
  requestedSlug: string,
  currentSlug: string
): Promise<string | null> {
  if (requestedSlug === currentSlug) {
    return currentSlug;
  }

  const [history] = await db
    .select({ oldSlug: content_slug_history.old_slug })
    .from(content_slug_history)
    .where(
      and(
        eq(content_slug_history.content_type, type),
        eq(content_slug_history.content_id, contentId),
        eq(content_slug_history.old_slug, requestedSlug)
      )
    )
    .limit(1);

  return history ? currentSlug : null;
}
