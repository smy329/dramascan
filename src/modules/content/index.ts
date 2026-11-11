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
