import type { JSX, ReactNode } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

import { EmptyState } from '@/components/states/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { buildTableHref, type TableQueryState } from '@/lib/contracts/table';
import { cn } from '@/lib/utils';

import type { AdminTableColumn, AdminTableColumnVisibility } from './types';

const VISIBILITY_CLASSES: Record<AdminTableColumnVisibility, string> = {
  always: '',
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
};

const ALIGNMENT_CLASSES = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const;

/**
 * The sort token a column link should point at.
 *
 * Clicking the column that is already sorted flips its direction; clicking a
 * different column sorts it descending first, which matches the table's
 * default order.
 */
export function nextSortToken(currentSort: string, columnSortKey: string): string {
  const descending = currentSort.startsWith('-');
  const currentColumn = descending ? currentSort.slice(1) : currentSort;

  if (currentColumn === columnSortKey) {
    return descending ? columnSortKey : `-${columnSortKey}`;
  }

  return `-${columnSortKey}`;
}

/**
 * The `aria-sort` value for a sortable column head.
 *
 * A function declaration rather than an arrow on purpose: a conditional body
 * in an arrow trips both `no-confusing-arrow` and `no-extra-parens`, and the
 * nested ternary this replaces was correct but hard to read.
 */
function resolveAriaSort(
  sorted: boolean,
  descending: boolean
): 'ascending' | 'descending' | 'none' {
  if (!sorted) {
    return 'none';
  }

  return descending ? 'descending' : 'ascending';
}

export type AdminDataTableProps<T> = Readonly<{
  caption: string;
  captionClassName?: string;
  columns: readonly AdminTableColumn<T>[];
  rows: readonly T[];
  rowKey: (_row: T) => string;
  pathname: string;
  state: TableQueryState;
  empty?: ReactNode;
  emptyIcon?: LucideIcon;
  className?: string;
}>;

export function AdminDataTable<T>({
  caption,
  captionClassName,
  columns,
  rows,
  rowKey,
  pathname,
  state,
  empty,
  emptyIcon = Inbox,
  className,
}: AdminDataTableProps<T>): JSX.Element {
  if (rows.length === 0) {
    return (
      <div className={className}>
        {empty ?? <EmptyState icon={emptyIcon} title="Nothing to show" />}
      </div>
    );
  }

  return (
    <Table className={className}>
      <caption className={cn('text-left text-sm text-muted-foreground', captionClassName)}>
        {caption}
      </caption>
      <TableHeader>
        <TableRow>
          {columns.map(column =>
            <SortableHead key={column.key} column={column} pathname={pathname} state={state} />
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(row =>
          <TableRow key={rowKey(row)}>
            {columns.map(column =>
              <TableCell
                key={column.key}
                className={cn(
                  VISIBILITY_CLASSES[column.visibility ?? 'always'],
                  ALIGNMENT_CLASSES[column.align ?? 'left'],
                  column.cellClassName
                )}
              >
                {column.render(row)}
              </TableCell>
            )}
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

type SortableHeadProps<T> = Readonly<{
  column: AdminTableColumn<T>;
  pathname: string;
  state: TableQueryState;
}>;

function SortableHead<T>({ column, pathname, state }: SortableHeadProps<T>): JSX.Element {
  const visibilityClass = VISIBILITY_CLASSES[column.visibility ?? 'always'];

  if (column.sortKey === undefined) {
    return (
      <TableHead
        scope="col"
        className={cn(
          visibilityClass,
          ALIGNMENT_CLASSES[column.align ?? 'left'],
          column.headerClassName
        )}
      >
        {column.header}
      </TableHead>
    );
  }

  const descending = state.sort.startsWith('-');
  const sorted = (descending ? state.sort.slice(1) : state.sort) === column.sortKey;
  const ariaSort = resolveAriaSort(sorted, descending);
  const order = descending ? 'descending' : 'ascending';
  const label = sorted
    ? `Sort by ${column.header}, currently ${order}`
    : `Sort by ${column.header}, currently unsorted`;

  return (
    <TableHead
      scope="col"
      aria-sort={ariaSort}
      className={cn(
        visibilityClass,
        ALIGNMENT_CLASSES[column.align ?? 'left'],
        column.headerClassName
      )}
    >
      <Link
        href={buildTableHref(pathname, state, {
          sort: nextSortToken(state.sort, column.sortKey),
          page: 1,
        })}
        className="inline-flex items-center gap-1 hover:text-foreground"
        aria-label={label}
      >
        {column.header}
        <span aria-hidden="true">{sorted ? descending ? '↓' : '↑' : '↕'}</span>
      </Link>
    </TableHead>
  );
}
