/**
 * Analytics module public API (server-only).
 *
 * The single public surface for the analytics domain. Callers get the
 * read models they are allowed to use, not the module's schema or inner
 * helpers.
 */

import 'server-only';

export { getContentViewCount } from './view-counts';

export {
  DISCOVERY_PAGE_SIZE_DEFAULT,
  DISCOVERY_PAGE_SIZE_MAX,
  DISCOVERY_SORTS,
  listHighestRatedContent,
  listMostViewedContent,
  listPopularContent,
  listRankedContent,
  listTrendingContent,
} from './read-models/discovery';

export type {
  DiscoveryQuery,
  DiscoverySort,
  RankedContent,
  RankedContentPage,
  RankedContentType,
  TrendingPin,
} from './read-models/discovery';
