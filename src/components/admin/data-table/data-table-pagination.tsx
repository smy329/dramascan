import type { JSX } from 'react';
import Link from 'next/link';

import { buildTableHref, type TableQueryState } from '@/lib/contracts/table';
import { cn } from '@/lib/utils';

const DEFAULT_PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

/** The page numbers to show around the current page. */
export function buildPageWindow(
  currentPage: number,
  totalPages: number
): readonly (number | 'gap')[] {
  if (totalPages <= 1) {
    return [];
  }

  const pages = new Set<number>([1, totalPages, currentPage]);
  const windowRadius = 1;

  for (let offset = -windowRadius; offset <= windowRadius; offset += 1) {
    const candidate = currentPage + offset;

    if (candidate >= 1 && candidate <= totalPages) {
      pages.add(candidate);
    }
  }

  const sorted = [...pages].sort((left, right) => left - right);
  const result: (number | 'gap')[] = [];

  sorted.forEach((page, index) => {
    const previous = sorted[index - 1];

    if (previous !== undefined && page - previous > 1) {
      result.push('gap');
    }

    result.push(page);
  });

  return result;
}

function renderSummary(
  total: number,
  firstRow: number,
  lastRow: number,
  itemLabel: string
): string {
  if (total === 0) {
    return `No ${itemLabel}`;
  }

  return `Showing ${firstRow}–${lastRow} of ${total} ${itemLabel}`;
}

function renderWindowEntry(
  entry: number | 'gap',
  index: number,
  pathname: string,
  state: TableQueryState
): JSX.Element {
  if (entry === 'gap') {
    return (
      <span key={`gap-${index}`} className="px-1 text-sm text-muted-foreground">
        …
      </span>
    );
  }

  const isCurrent = entry === state.page;
  const pageClass = isCurrent
    ? 'border-primary bg-primary text-primary-foreground'
    : 'border-border text-foreground';

  return (
    <Link
      key={entry}
      href={buildTableHref(pathname, state, { page: entry })}
      aria-current={isCurrent ? 'page' : undefined}
      className={cn('rounded-lg border px-2 py-1 text-sm', pageClass)}
    >
      {entry}
    </Link>
  );
}

function renderFilterInputs(
  filters: Readonly<Record<string, string>>
): readonly (JSX.Element | null)[] {
  return Object.entries(filters).map(([name, value]) => {
    if (value.length === 0) {
      return null;
    }

    return <input key={name} type="hidden" name={name} value={value} />;
  });
}

function renderPrevious(pathname: string, state: TableQueryState): JSX.Element {
  if (state.page > 1) {
    return (
      <Link
        href={buildTableHref(pathname, state, { page: state.page - 1 })}
        className="rounded-lg border border-border px-2 py-1 text-sm text-foreground"
      >
        Previous
      </Link>
    );
  }

  return (
    <span
      aria-disabled="true"
      className="rounded-lg border border-border px-2 py-1 text-sm text-muted-foreground opacity-60"
    >
      Previous
    </span>
  );
}

function renderNext(pathname: string, state: TableQueryState, totalPages: number): JSX.Element {
  if (state.page < totalPages) {
    return (
      <Link
        href={buildTableHref(pathname, state, { page: state.page + 1 })}
        className="rounded-lg border border-border px-2 py-1 text-sm text-foreground"
      >
        Next
      </Link>
    );
  }

  return (
    <span
      aria-disabled="true"
      className="rounded-lg border border-border px-2 py-1 text-sm text-muted-foreground opacity-60"
    >
      Next
    </span>
  );
}

function renderSearchHidden(state: TableQueryState): JSX.Element | null {
  if (state.search.length === 0) {
    return null;
  }

  return <input type="hidden" name="q" value={state.search} />;
}

function renderPageSizeOption(option: number): JSX.Element {
  return (
    <option key={option} value={String(option)}>
      {option}
    </option>
  );
}

/**
 * The page sizes the control offers, with the current one included.
 *
 * The options are an ascending list and the result stays ascending, so the
 * current page size is inserted in order rather than appended.
 *
 * `CONVENTIONS.md` §6.3 allows any size from 1 to 100, and a hand-edited or
 * shared link may carry one the control does not offer. A `<select>` shows the
 * option matching its value and nothing otherwise, so a missing size would
 * leave the control blank — or showing a stale number — while the page really
 * shows a different number of rows.
 */
function resolvePageSizeOptions(
  pageSize: number,
  pageSizeOptions: readonly number[]
): readonly number[] {
  if (pageSizeOptions.includes(pageSize)) {
    return pageSizeOptions;
  }

  return [...pageSizeOptions, pageSize].sort((left, right) => left - right);
}

export type AdminTablePaginationProps = Readonly<{
  pathname: string;
  state: TableQueryState;
  total: number;
  totalPages: number;
  itemLabel: string;
  pageSizeOptions?: readonly number[];
  className?: string;
}>;

/**
 * Pagination controls for a data table.
 *
 * The page number lives in the URL, so every control is a link or a GET form
 * that keeps the sort, the search term, and the active filters.
 */
export function AdminTablePagination({
  pathname,
  state,
  total,
  totalPages,
  itemLabel,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  className,
}: AdminTablePaginationProps): JSX.Element {
  const firstRow = total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const lastRow = total === 0 ? 0 : Math.min(state.page * state.pageSize, total);
  const pageWindow = buildPageWindow(state.page, totalPages);

  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      <p className="text-sm text-muted-foreground">
        {renderSummary(total, firstRow, lastRow, itemLabel)}
      </p>

      <nav aria-label="Pagination" className="flex items-center gap-1">
        {renderPrevious(pathname, state)}
        {pageWindow.map((entry, index) => renderWindowEntry(entry, index, pathname, state))}
        {renderNext(pathname, state, totalPages)}
      </nav>

      <form method="get" action={pathname} className="flex items-end gap-2">
        <input type="hidden" name="sort" value={state.sort} />
        {renderSearchHidden(state)}
        {renderFilterInputs(state.filters)}
        <div>
          <label
            htmlFor="table-page-size"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            Rows per page
          </label>
          <select
            id="table-page-size"
            name="pageSize"
            defaultValue={String(state.pageSize)}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground"
          >
            {resolvePageSizeOptions(state.pageSize, pageSizeOptions).map(option =>
              renderPageSizeOption(option)
            )}
          </select>
        </div>
        <button
          type="submit"
          className="h-8 rounded-lg border border-border px-3 text-sm text-foreground"
        >
          Apply
        </button>
      </form>
    </div>
  );
}
