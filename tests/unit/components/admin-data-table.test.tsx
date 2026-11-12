// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

import { AdminDataTable } from '@/components/admin/data-table/data-table';
import { AdminTableSkeleton } from '@/components/admin/data-table/data-table-skeleton';
import { AdminTableError } from '@/components/admin/data-table/data-table-error';
import type { AdminTableColumn } from '@/components/admin/data-table/types';
import type { TableQueryState } from '@/lib/contracts/table';

afterEach(cleanup);

type Row = { id: string; name: string; email: string; active: boolean };

const state: TableQueryState = {
  page: 1,
  pageSize: 20,
  sort: '-createdAt',
  search: '',
  filters: {},
};

const columns: readonly AdminTableColumn<Row>[] = [
  { key: 'name', header: 'Name', sortKey: 'name', render: row => row.name },
  { key: 'email', header: 'Email', sortKey: 'email', visibility: 'sm', render: row => row.email },
  // eslint-disable-next-line no-extra-parens -- required with no-confusing-arrow for this concise ternary
  { key: 'status', header: 'Status', render: row => (row.active ? 'Active' : 'Deactivated') },
];

const rows: readonly Row[] = [
  { id: '1', name: 'Ada Lovelace', email: 'ada@example.com', active: true },
];

describe('AdminDataTable', () => {
  it('renders a caption, the headers, and one row', () => {
    render(
      <AdminDataTable
        caption="Users"
        columns={columns}
        rows={rows}
        rowKey={row => row.id}
        pathname="/admin/users"
        state={state}
      />
    );

    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('Users')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /Name/ })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Ada Lovelace' })).toBeTruthy();
  });

  it('marks the sorted column with aria-sort and the others with none', () => {
    render(
      <AdminDataTable
        caption="Users"
        columns={columns}
        rows={rows}
        rowKey={row => row.id}
        pathname="/admin/users"
        state={{ ...state, sort: 'name' }}
      />
    );

    expect(screen.getByRole('columnheader', { name: /Name/ }).getAttribute('aria-sort')).toBe(
      'ascending'
    );
    expect(screen.getByRole('columnheader', { name: /Email/ }).getAttribute('aria-sort')).toBe(
      'none'
    );
  });

  it('links a sortable header to the same table with the flipped sort', () => {
    render(
      <AdminDataTable
        caption="Users"
        columns={columns}
        rows={rows}
        rowKey={row => row.id}
        pathname="/admin/users"
        state={{ ...state, sort: 'name' }}
      />
    );

    const link = within(screen.getByRole('columnheader', { name: /Name/ })).getByRole('link');
    expect(link.getAttribute('href')).toBe('/admin/users?pageSize=20&sort=-name');
  });

  it('links a new column to a descending sort and resets the page', () => {
    render(
      <AdminDataTable
        caption="Users"
        columns={columns}
        rows={rows}
        rowKey={row => row.id}
        pathname="/admin/users"
        state={{ ...state, page: 4, sort: '-createdAt' }}
      />
    );

    const link = within(screen.getByRole('columnheader', { name: /Email/ })).getByRole('link');
    expect(link.getAttribute('href')).toBe('/admin/users?pageSize=20&sort=-email');
  });

  it('keeps the active filters in a sort link', () => {
    render(
      <AdminDataTable
        caption="Users"
        columns={columns}
        rows={rows}
        rowKey={row => row.id}
        pathname="/admin/users"
        state={{ ...state, filters: { status: 'active' } }}
      />
    );

    const link = within(screen.getByRole('columnheader', { name: /Name/ })).getByRole('link');
    expect(link.getAttribute('href')).toContain('status=active');
  });

  it('hides a secondary column below its breakpoint', () => {
    render(
      <AdminDataTable
        caption="Users"
        columns={columns}
        rows={rows}
        rowKey={row => row.id}
        pathname="/admin/users"
        state={state}
      />
    );

    const header = screen.getByRole('columnheader', { name: /Email/ });
    expect(header.className).toContain('hidden');
    expect(header.className).toContain('sm:table-cell');
  });

  it('renders the empty state instead of a row when there are no rows', () => {
    render(
      <AdminDataTable
        caption="Users"
        columns={columns}
        rows={[]}
        rowKey={row => row.id}
        pathname="/admin/users"
        state={state}
        empty={<p>No accounts yet</p>}
      />
    );

    expect(screen.getByText('No accounts yet')).toBeTruthy();
    expect(screen.queryAllByRole('row')).toHaveLength(0);
  });

  it('keeps the search term in a sort link', () => {
    render(
      <AdminDataTable
        caption="Users"
        columns={columns}
        rows={rows}
        rowKey={row => row.id}
        pathname="/admin/users"
        state={{ ...state, search: 'lee' }}
      />
    );

    const link = within(screen.getByRole('columnheader', { name: /Name/ })).getByRole('link');
    expect(link.getAttribute('href')).toContain('q=lee');
  });

  it('flips a descending sort to ascending when the sorted column is clicked again', () => {
    render(
      <AdminDataTable
        caption="Users"
        columns={columns}
        rows={rows}
        rowKey={row => row.id}
        pathname="/admin/users"
        state={{ ...state, sort: '-name' }}
      />
    );

    const link = within(screen.getByRole('columnheader', { name: /Name/ })).getByRole('link');
    expect(link.getAttribute('href')).toBe('/admin/users?pageSize=20&sort=name');
  });
});

describe('AdminTableSkeleton', () => {
  it('announces loading exactly once', () => {
    render(<AdminTableSkeleton columns={3} label="Loading users" />);

    const status = screen.getAllByRole('status');
    expect(status).toHaveLength(1);
    expect(status[0]?.textContent).toContain('Loading users');
  });
});

describe('AdminTableError', () => {
  it('renders an alert with the label', () => {
    render(<AdminTableError label="users" description="Try again." />);

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Could not load users')).toBeTruthy();
  });
});
