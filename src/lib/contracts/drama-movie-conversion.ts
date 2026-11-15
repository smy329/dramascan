/**
 * Client-safe contract for the drama → movie conversion panel.
 *
 * `components/**` may import only `lib`/`lib/contracts`, so the panel cannot
 * import the content module. The workflow assigns its plan to these DTOs, so
 * the compiler rejects drift between the domain shape and the client shape.
 */

/** Publication states a standalone movie can store. */
export type MovieConversionPublicationStatusDto = 'draft' | 'published' | 'unpublished';

/** A category or platform carried over from the drama. */
export type MovieConversionAssociationDto = {
  id: string;
  name: string;
};

/** Counts of records that move to the new movie. */
export type MovieConversionRelationshipCountsDto = {
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
export type MovieConversionPreviewDto = {
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
    publicationStatus: MovieConversionPublicationStatusDto;
    videoSource: string | null;
    convertedFromDramaId: string;
    categories: MovieConversionAssociationDto[];
    platforms: MovieConversionAssociationDto[];
  };
  relationships: MovieConversionRelationshipCountsDto;
  warnings: string[];
};

/** Applied conversion result. */
export type MovieConversionApplyResultDto = MovieConversionPreviewDto & {
  applied: true;
  movieId: string;
};

/** Request payload for the preview and apply Server Actions. */
export type MovieConversionRequestDto = {
  mode: 'preview' | 'apply';
  fingerprint?: string;
};
