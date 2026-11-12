import type { ReactNode } from 'react';

/**
 * Responsive priority of a table column.
 *
 * `always` keeps the column at every width. The other values hide the column
 * below the matching Tailwind breakpoint, so a narrow screen shows fewer
 * columns instead of a table that is too wide to use.
 */
export type AdminTableColumnVisibility = 'always' | 'sm' | 'md' | 'lg';

export type AdminTableColumn<T> = Readonly<{
  key: string;
  header: string;
  /** Set to make the column sortable. The value is the sort column name. */
  sortKey?: string;
  align?: 'left' | 'center' | 'right';
  /** Responsive priority. Defaults to `always`. */
  visibility?: AdminTableColumnVisibility;
  headerClassName?: string;
  cellClassName?: string;
  render: (_row: T) => ReactNode;
}>;

export type AdminTableFilterOption = Readonly<{
  value: string;
  label: string;
}>;

export type AdminTableFilterField = Readonly<{
  /** Query parameter name. */
  name: string;
  label: string;
  options: readonly AdminTableFilterOption[];
  /** The active value; an empty string means "no filter". */
  value: string;
}>;
