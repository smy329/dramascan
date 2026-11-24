/**
 * Content module public API (server-only).
 *
 * This is the only cross-module import target for the content domain. Keep it
 * narrow: callers get the information-page reads/writes they are allowed to
 * use, not the module's schema or inner helpers.
 */

import 'server-only';

export {
  INFORMATION_PAGE_DEFINITIONS,
  isValidInformationPageSlug,
  informationPageHref,
  buildFooterInformationLinks,
  listInformationPagesQuerySchema,
  informationPageIdSchema,
  parseListInformationPagesQuery,
  parseInformationPageId,
  updateInformationPageSchema,
  reorderInformationPagesSchema,
} from './information-pages.shared';

export type {
  FooterInformationLink,
  PublicInformationPage,
  AdminInformationPage,
  UpdateInformationPageInput,
  ReorderInformationPagesInput,
  ListInformationPagesQuery,
} from './information-pages.shared';

export {
  listFooterInformationLinks,
  getPublishedInformationPage,
  listInformationPages,
  updateInformationPage,
  reorderInformationPages,
} from './information-pages';

export type { AdminInformationPageList } from './information-pages';

export {
  PUBLICATION_REQUEST_LIMIT,
  publicationStatusSchema,
  publicationContentTypeSchema,
  publicationActionSchema,
  publicationRequestSchema,
  publicationReadyVideoSourceSchema,
  moviePublicationStatusSchema,
  movieVideoSourceSchema,
  parsePublicationRequest,
} from './validation';

export type {
  PublicationContentType,
  PublicationAction,
  PublicationRequest,
} from './validation';

export {
  PUBLICATION_STATUSES,
  evaluatePublicationEligibility,
  evaluatePublicAvailability,
  isPublicationReadySource,
  normalizePublicationStatus,
} from './publication';

export type {
  AvailabilityBlocker,
  AvailabilityParent,
  PublicAvailability,
  PublicationEligibility,
  PublicationEligibilityReason,
  PublicationStatus,
} from './publication';

export {
  DEFAULT_EMPTY_DRAMA_VISIBILITY,
  EMPTY_DRAMA_VISIBILITY_MODES,
  PUBLIC_DRAMA_PAGE_SIZE_DEFAULT,
  PUBLIC_DRAMA_PAGE_SIZE_MAX,
  evaluatePublicDramaDiscovery,
  isEmptyDramaHidden,
  parsePublicDramaListQuery,
  publicDramaHref,
  toPublicDramaSummary,
} from './public-dramas.shared';

export type {
  EmptyDramaVisibilityMode,
  PublicDramaDiscovery,
  PublicDramaDiscoveryReason,
  PublicDramaList,
  PublicDramaListQuery,
  PublicDramaRow,
  PublicDramaSummary,
} from './public-dramas.shared';

export { listPublicDramas, playableEpisodeExists } from './public-dramas';

export {
  getPublicEpisodePlayback,
  listPublicDramaEpisodes,
  nextPublicEpisode,
  previousPublicEpisode,
} from './public-episodes';

export { publicEpisodeHref } from './public-episodes.shared';
export {
  isPubliclyPlayableMovie,
  publicMovieHref,
  publicMovieWatchHref,
} from './public-movies.shared';

export { getMovieContentReference, getPublicMoviePlayback } from './public-movies';

export type { MovieContentReference } from './public-movies';

export type { PublicMoviePlayback } from './public-movies.shared';

export {
  getBookmarkableContentTarget,
  getPublicContentTarget,
  getReportableContentTarget,
  getPublicDramaDetail,
  getPublicMovieDetail,
  listPublicContentTargets,
  listPublicEpisodeTargets,
  listPublicSimilarDramas,
} from './public-details';

export type {
  BookmarkableContentTarget,
  PublicContentCard,
  PublicContentTarget,
  PublicEpisodeTarget,
  ReportableContentTarget,
  PublicDramaDetail,
  PublicMovieDetail,
  PublicSeasonGroup,
  PublicTaxonomyRef,
} from './public-details';

export {
  getEpisodeContentReference,
  getPublicEpisodeContentReference,
} from './episode-references';

export type { EpisodeContentReference } from './episode-references';

export { isPubliclyPlayableEpisode } from './public-episodes.shared';

export type {
  PublicEpisodeAvailabilityInput,
  PublicEpisodePlayback,
  PublicEpisodeSummary,
} from './public-episodes.shared';

export { resolvePublicContentSlug } from './public-slugs';

export type { PublicSluggedType } from './public-slugs';

export {
  countPublicContent,
  dramaStatus,
  escapeLikeTerm,
  getPublicFeaturedContent,
  listCategorySections,
  listContentByCategorySlug,
  listContentByCategorySlugs,
  listContentByPlatformSlug,
  listPublicCategories,
  listPublicHeroCandidates,
  listPublicPlatforms,
  listPublishedDramaIds,
  listPublishedMovieIds,
  listRecentlyAddedContent,
  listSearchSuggestions,
  listSearchTaxonomyMatches,
  publicDramaAvailability,
  publicMovieAvailability,
} from './public-discovery';

export type {
  CategorySection,
  DiscoveryCard,
  DiscoveryContentType,
  PublicTaxonomy,
  SearchSuggestion,
  SearchSuggestionType,
  SearchTaxonomyMatch,
} from './public-discovery';
