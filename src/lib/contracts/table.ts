/**
 * Client-safe table-state contract shared by the admin table kit and the
 * pages that render it.
 *
 * The whole table state lives in the URL query string, so this module owns
 * the parameter names and the href builder. It is isomorphic: no framework
 * import, no server code, and no database access.
 *
 * Modules may not import `lib` (`ARCHITECTURE.md` §7), so a domain module
 * re-declares the same parameter names and bounds in its own
 * `validation.ts`. A unit test asserts the two agree.
 */

/** Query parameter names used by every admin data table. */
export const TABLE_QUERY_PARAMS = {
  page: 'page',
  pageSize: 'pageSize',
  sort: 'sort',
  search: 'q',
} as const;

/** Default number of rows per page (`CONVENTIONS.md` §6.3). */
export const DEFAULT_TABLE_PAGE_SIZE = 20;

/** Maximum number of rows a client may request (`CONVENTIONS.md` §6.3). */
export const MAX_TABLE_PAGE_SIZE = 100;

/** Page sizes offered by the table's page-size control. */
export const TABLE_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

export type TableSortDirection = 'asc' | 'desc';

export type TableQueryState = Readonly<{
  /** 1-based page index. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Sort token: a column name, `-` prefixed for descending. */
  sort: string;
  /** Free-text search term; an empty string means "no search". */
  search: string;
  /** Active filters; an empty value means "no filter". */
  filters: Readonly<Record<string, string>>;
}>;

/**
 * Build the href for a table state.
 *
 * `sort` and `pageSize` are always emitted so a shared link reproduces the
 * view exactly. `page` is emitted only beyond the first page. The search term
 * and a filter are emitted only when they carry a value.
 *
 * `overrides` replaces the named fields. `filters` is replaced wholesale, not
 * merged, so a caller that drops one filter must pass the remaining ones.
 */
export function buildTableHref(
  pathname: string,
  state: TableQueryState,
  overrides: Partial<TableQueryState> = {}
): string {
  const next: TableQueryState = { ...state, ...overrides };
  const params = new URLSearchParams();

  params.set(TABLE_QUERY_PARAMS.pageSize, String(next.pageSize));
  params.set(TABLE_QUERY_PARAMS.sort, next.sort);

  if (next.page > 1 || 'page' in overrides) {
    params.set(TABLE_QUERY_PARAMS.page, String(next.page));
  }

  if (next.search.length > 0) {
    params.set(TABLE_QUERY_PARAMS.search, next.search);
  }

  for (const [key, value] of Object.entries(next.filters)) {
    if (value.length > 0) {
      params.set(key, value);
    }
  }

  return `${pathname}?${params.toString()}`;
}
