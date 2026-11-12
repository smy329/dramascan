import type { JSX } from 'react';
import Link from 'next/link';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { AdminTableFilterField } from './types';
import type { TableQueryState } from '@/lib/contracts/table';

function renderSearchInput(state: TableQueryState, includeSearch: boolean): JSX.Element | null {
  if (!includeSearch || state.search.length === 0) {
    return null;
  }

  return <input type="hidden" name="q" value={state.search} />;
}

function renderFilterInputs(
  filters: Readonly<Record<string, string>>,
  includeFilters: boolean
): readonly (JSX.Element | null)[] | null {
  if (!includeFilters) {
    return null;
  }

  return Object.entries(filters).map(([name, value]) => {
    if (value.length === 0) {
      return null;
    }

    return <input key={name} type="hidden" name={name} value={value} />;
  });
}

/** Hidden inputs that carry the state a form must preserve. */
function StateInputs({
  state,
  includeSearch,
  includeFilters,
}: Readonly<{
  state: TableQueryState;
  includeSearch: boolean;
  includeFilters: boolean;
}>): JSX.Element {
  return (
    <>
      <input type="hidden" name="sort" value={state.sort} />
      <input type="hidden" name="pageSize" value={String(state.pageSize)} />
      {renderSearchInput(state, includeSearch)}
      {renderFilterInputs(state.filters, includeFilters)}
    </>
  );
}

function renderOption(option: Readonly<{ value: string; label: string }>): JSX.Element {
  return (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  );
}

function renderFilterField(field: AdminTableFilterField): JSX.Element {
  return (
    <div key={field.name}>
      <label
        htmlFor={`table-filter-${field.name}`}
        className="mb-1 block text-xs font-medium text-muted-foreground"
      >
        {field.label}
      </label>
      <select
        id={`table-filter-${field.name}`}
        name={field.name}
        defaultValue={field.value}
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground"
      >
        {field.options.map(renderOption)}
      </select>
    </div>
  );
}

function renderFilterForm(
  pathname: string,
  state: TableQueryState,
  filters: readonly AdminTableFilterField[]
): JSX.Element | null {
  if (filters.length === 0) {
    return null;
  }

  return (
    <form method="get" action={pathname} className="flex flex-wrap items-end gap-2">
      <StateInputs state={state} includeSearch includeFilters={false} />
      {filters.map(renderFilterField)}
      <button
        type="submit"
        className="h-8 rounded-lg border border-border px-3 text-sm text-foreground"
      >
        Apply
      </button>
    </form>
  );
}

function renderClearLink(clearHref: string | undefined, showClear: boolean): JSX.Element | null {
  if (!showClear || clearHref === undefined) {
    return null;
  }

  return (
    <Link
      href={clearHref}
      className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
    >
      Clear filters
    </Link>
  );
}

export type AdminTableToolbarProps = Readonly<{
  pathname: string;
  state: TableQueryState;
  searchLabel: string;
  searchPlaceholder?: string;
  filters?: readonly AdminTableFilterField[];
  clearHref?: string;
  className?: string;
}>;

/**
 * Search and filter controls for a data table.
 *
 * Both controls are GET forms, so the whole table state stays in the URL. The
 * forms never carry a `page` input, so a new search or filter always returns
 * to the first page.
 */
export function AdminTableToolbar({
  pathname,
  state,
  searchLabel,
  searchPlaceholder,
  filters = [],
  clearHref,
  className,
}: AdminTableToolbarProps): JSX.Element {
  const hasActiveFilter = Object.values(state.filters).some(value => value.length > 0);
  const showClear = clearHref !== undefined && (state.search.length > 0 || hasActiveFilter);

  return (
    <div
      className={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}
    >
      <form method="get" action={pathname} role="search" className="flex flex-1 items-end gap-2">
        <StateInputs state={state} includeSearch={false} includeFilters />
        <div className="flex-1">
          <label
            htmlFor="table-search"
            className="mb-1 block text-xs font-medium text-muted-foreground"
          >
            {searchLabel}
          </label>
          <Input
            id="table-search"
            name="q"
            type="search"
            defaultValue={state.search}
            placeholder={searchPlaceholder}
          />
        </div>
        <button
          type="submit"
          className="h-8 rounded-lg border border-border px-3 text-sm text-foreground"
        >
          Search
        </button>
      </form>

      {renderFilterForm(pathname, state, filters)}
      {renderClearLink(clearHref, showClear)}
    </div>
  );
}
