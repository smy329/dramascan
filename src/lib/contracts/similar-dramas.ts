/**
 * Client-safe similar-drama contracts.
 *
 * The recommendation list and the scored suggestions are rendered in the
 * browser, so their shapes live in `lib/contracts` rather than in the module
 * that computes them.
 */

/** A scored candidate, ready to be offered to an administrator. */
export type SimilarDramaSuggestion = {
  id: string;
  title: string;
  poster: string | null;
  description: string | null;
  score: number;
  sharedCategories: number;
  sharedPlatforms: number;
};

/** The target's stored position. Existing rows may still carry a null. */
export type SimilarDramaPosition = number | null;

/** One managed recommendation. */
export type SimilarDramaSummary = {
  id: string;
  title: string;
  poster: string | null;
  description: string | null;
  position: SimilarDramaPosition;
};

/** A paginated listing for one parent drama. */
export type SimilarDramaListResult = {
  items: SimilarDramaSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};
