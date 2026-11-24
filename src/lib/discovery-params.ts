import type { DiscoverySort, RankedContentType } from '@/modules/analytics';

/**
 * Query-parameter readers for the public discovery pages.
 *
 * A query parameter is untrusted input: it arrives from the URL and may be
 * anything. These readers return the approved value or the documented
 * default, so a page never has to think about an unexpected parameter.
 */

/** The raw shape of a page's search parameters. */
export type PublicSearchParams = Readonly<
  Record<string, string | string[] | undefined>
>;

/** Read one parameter as a trimmed string. */
export function readStringParam(
  params: PublicSearchParams,
  name: string,
  fallback = ''
): string {
  const value = params[name];
  const first = Array.isArray(value) ? value[0] : value;

  if (typeof first !== 'string') {
    return fallback;
  }

  const trimmed = first.trim();

  return trimmed.length > 0 ? trimmed : fallback;
}

/** Read the page number. A page number below one is the first page. */
export function readPageParam(params: PublicSearchParams): number {
  const raw = readStringParam(params, 'page', '1');
  const parsed = Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

/** Read the content-type filter. */
export function readContentTypeParam(params: PublicSearchParams): 'all' | RankedContentType {
  const raw = readStringParam(params, 'type', 'all');

  if (raw === 'drama' || raw === 'movie') {
    return raw;
  }

  return 'all';
}

/** Read the lifecycle-status filter. */
export function readStatusParam(
  params: PublicSearchParams
): 'all' | 'ongoing' | 'completed' {
  const raw = readStringParam(params, 'status', 'all');

  if (raw === 'ongoing' || raw === 'completed') {
    return raw;
  }

  return 'all';
}

/**
 * Read the sort order.
 *
 * The fallback is a parameter because the default depends on the page: a
 * search with a term is ordered by relevance, while every other listing is
 * ordered by the newest first.
 */
export function readSortParam(
  params: PublicSearchParams,
  fallback: DiscoverySort = 'newest'
): DiscoverySort {
  const raw = readStringParam(params, 'sort', fallback);

  if (
    raw === 'newest' ||
    raw === 'relevance' ||
    raw === 'trending' ||
    raw === 'popular' ||
    raw === 'highest-rated' ||
    raw === 'most-viewed'
  ) {
    return raw;
  }

  return fallback;
}
