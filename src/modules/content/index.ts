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

export { listPublicDramas } from './public-dramas';

export {
  getPublicEpisodePlayback,
  listPublicDramaEpisodes,
} from './public-episodes';

export { getEpisodeContentReference } from './episode-references';

export type { EpisodeContentReference } from './episode-references';

export { isPubliclyPlayableEpisode } from './public-episodes.shared';

export type {
  PublicEpisodeAvailabilityInput,
  PublicEpisodePlayback,
  PublicEpisodeSummary,
} from './public-episodes.shared';
