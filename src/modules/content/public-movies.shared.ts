import { evaluatePublicAvailability, normalizePublicationStatus } from './publication';

/**
 * Public standalone-movie rules (pure).
 *
 * A movie is an independent content item: it has no drama, season, or episode
 * parent. The only public conditions are its own publication state, its Trash
 * state, and the presence of a source the browser can play.
 */

/** The movie data the watch page needs, and nothing more. */
export type PublicMoviePlayback = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  poster: string | null;
  banner: string | null;
  videoSource: string;
};

/** Canonical public movie route (requirements §6.6). */
export function publicMovieHref(id: string, slug: string): string {
  return `/movie/${id}/${slug}`;
}

/** Canonical public movie playback route. */
export function publicMovieWatchHref(id: string, slug: string): string {
  return `/movie/${id}/${slug}/watch`;
}

/** Decide whether a movie may be watched by the public. */
export function isPubliclyPlayableMovie(input: {
  publicationStatus: string | null;
  deleted: boolean;
  hasSource: boolean;
}): boolean {
  if (!input.hasSource) {
    return false;
  }

  const availability = evaluatePublicAvailability({
    contentType: 'movie',
    publicationStatus: normalizePublicationStatus(input.publicationStatus),
    deleted: input.deleted,
  });

  return availability.publiclyAvailable;
}
