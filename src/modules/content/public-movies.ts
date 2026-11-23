import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { isPubliclyPlayableMovie, type PublicMoviePlayback } from './public-movies.shared';
import { movies } from './schema';

export type { PublicMoviePlayback } from './public-movies.shared';
export { isPubliclyPlayableMovie, publicMovieHref, publicMovieWatchHref } from './public-movies.shared';

/**
 * Public movie playback lookup.
 *
 * The movie is an independent content item: there is no parent hierarchy to
 * walk. A movie that is not published, is in the Trash, or has no stored source
 * is not publicly playable and the watch route answers 404.
 */
export async function getPublicMoviePlayback(
  movieId: string
): Promise<PublicMoviePlayback | null> {
  const [row] = await db
    .select({
      id: movies.id,
      title: movies.title,
      slug: movies.slug,
      description: movies.description,
      poster: movies.poster,
      banner: movies.banner,
      publicationStatus: movies.publication_status,
      deleted: movies.deleted_at,
      videoSource: movies.video_source,
    })
    .from(movies)
    .where(eq(movies.id, movieId))
    .limit(1);

  if (!row) {
    return null;
  }

  const hasSource = typeof row.videoSource === 'string' && row.videoSource.trim().length > 0;

  if (
    !isPubliclyPlayableMovie({
      publicationStatus: row.publicationStatus,
      deleted: row.deleted !== null,
      hasSource,
    })
  ) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    poster: row.poster,
    banner: row.banner,
    videoSource: row.videoSource as string,
  };
}

/** The movie reference a progress write needs, or `null` when it is not public. */
export type MovieContentReference = {
  movieId: string;
};

/**
 * Resolve a movie for a progress write.
 *
 * A guessed movie id of a draft, unpublished, or trashed movie must not become
 * a progress row, so the same public rule is applied here.
 */
export async function getMovieContentReference(
  movieId: string,
  executor: DbExecutor = db
): Promise<MovieContentReference | null> {
  const [row] = await executor
    .select({
      id: movies.id,
      publicationStatus: movies.publication_status,
      deleted: movies.deleted_at,
      videoSource: movies.video_source,
    })
    .from(movies)
    .where(eq(movies.id, movieId))
    .limit(1);

  if (!row) {
    return null;
  }

  const hasSource = typeof row.videoSource === 'string' && row.videoSource.trim().length > 0;

  if (
    !isPubliclyPlayableMovie({
      publicationStatus: row.publicationStatus,
      deleted: row.deleted !== null,
      hasSource,
    })
  ) {
    return null;
  }

  return { movieId: row.id };
}
