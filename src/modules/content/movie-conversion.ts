/**
 * Drama → standalone movie conversion domain rules.
 *
 * The conversion copies content identity, records provenance, and moves the
 * related user/analytics records to the new movie. This module owns the pure
 * parts: the deterministic fingerprint used to reject stale previews, the
 * publication-state mapping, and the preview plan shape. Persistence,
 * authorization, and transactions belong to the admin workflow.
 */
import { createHash } from 'node:crypto';

/** Publication states a standalone movie can store. */
export type MovieConversionPublicationStatus = 'draft' | 'published' | 'unpublished';

/** A category or platform carried over from the drama. */
export type MovieConversionAssociation = {
  id: string;
  name: string;
};

/** The active episode that becomes the movie's playback source. */
export type MovieConversionEpisodeState = {
  id: string;
  title: string;
  episodeNumber: number | null;
  position: number | null;
  seasonId: string | null;
  videoSource: string | null;
};

/** Snapshot of the drama and its single active episode at preview time. */
export type MovieConversionState = {
  dramaId: string;
  title: string;
  slug: string;
  description: string | null;
  poster: string | null;
  banner: string | null;
  publicationStatus: string | null;
  episode: MovieConversionEpisodeState;
  categories: MovieConversionAssociation[];
  platforms: MovieConversionAssociation[];
};

/** Counts of records that will move to the new movie. */
export type MovieConversionRelationshipCounts = {
  ratings: number;
  reviews: number;
  bookmarks: number;
  playbackProgress: number;
  watchedState: number;
  watchHistory: number;
  categories: number;
  platforms: number;
  slugHistory: number;
  seo: number;
  assets: number;
  notifications: number;
  adminNotifications: number;
  analyticsEvents: number;
};

/** Serializable preview of the resulting movie. */
export type MovieConversionPlan = {
  dramaId: string;
  fingerprint: string;
  source: {
    dramaId: string;
    episodeId: string;
    episodeTitle: string;
    episodeNumber: number | null;
    seasonId: string | null;
  };
  movie: {
    title: string;
    slug: string;
    description: string | null;
    poster: string | null;
    banner: string | null;
    publicationStatus: MovieConversionPublicationStatus;
    videoSource: string | null;
    convertedFromDramaId: string;
    categories: MovieConversionAssociation[];
    platforms: MovieConversionAssociation[];
  };
  relationships: MovieConversionRelationshipCounts;
  warnings: string[];
};

/** Applied conversion result: the preview plus the created movie id. */
export type MovieConversionApplyResult = MovieConversionPlan & {
  applied: true;
  movieId: string;
};

/**
 * Resolve the movie publication state from the drama's stored value.
 *
 * The drama column is unconstrained text; anything that is not a movie state
 * becomes `draft` so a conversion can never accidentally publish content.
 */
export function resolveMoviePublicationStatus(value: string | null): {
  status: MovieConversionPublicationStatus;
  warning: string | null;
} {
  if (value === 'draft' || value === 'published' || value === 'unpublished') {
    return { status: value, warning: null };
  }

  if (value === null) {
    return { status: 'draft', warning: null };
  }

  return {
    status: 'draft',
    warning: `The drama publication state "${value}" has no movie equivalent; the movie is created as a draft.`,
  };
}

/**
 * Deterministic fingerprint of the fields that affect the resulting movie.
 *
 * Relationship counts and viewing activity are excluded: they do not change
 * what the conversion produces, so they must not invalidate a preview. The
 * episode id and video source are included because they become the movie's
 * playback source.
 */
export function computeMovieConversionFingerprint(state: MovieConversionState): string {
  const { status } = resolveMoviePublicationStatus(state.publicationStatus);
  const payload = {
    dramaId: state.dramaId,
    title: state.title,
    slug: state.slug,
    description: state.description,
    poster: state.poster,
    banner: state.banner,
    publicationStatus: status,
    episode: {
      id: state.episode.id,
      videoSource: state.episode.videoSource,
    },
    categories: [...state.categories]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(category => category.id),
    platforms: [...state.platforms]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(platform => platform.id),
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/** Build the preview plan for an eligible drama. */
export function buildMovieConversionPlan(
  state: MovieConversionState,
  relationships: MovieConversionRelationshipCounts
): MovieConversionPlan {
  const publication = resolveMoviePublicationStatus(state.publicationStatus);
  const warnings = publication.warning ? [publication.warning] : [];

  return {
    dramaId: state.dramaId,
    fingerprint: computeMovieConversionFingerprint(state),
    source: {
      dramaId: state.dramaId,
      episodeId: state.episode.id,
      episodeTitle: state.episode.title,
      episodeNumber: state.episode.episodeNumber,
      seasonId: state.episode.seasonId,
    },
    movie: {
      title: state.title,
      slug: state.slug,
      description: state.description,
      poster: state.poster,
      banner: state.banner,
      publicationStatus: publication.status,
      videoSource: state.episode.videoSource,
      convertedFromDramaId: state.dramaId,
      categories: state.categories,
      platforms: state.platforms,
    },
    relationships,
    warnings,
  };
}

/** Human-readable eligibility message for a non-single episode count. */
export function episodeCountConflictMessage(activeEpisodes: number): string {
  if (activeEpisodes === 0) {
    return 'The drama has no active episode. A drama can be converted to a movie only when it contains exactly one episode.';
  }

  return `The drama has ${activeEpisodes} active episodes. A drama can be converted to a movie only when it contains exactly one episode.`;
}
