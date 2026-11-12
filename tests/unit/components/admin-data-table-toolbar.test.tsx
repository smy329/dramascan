// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { AdminTableToolbar } from '@/components/admin/data-table/data-table-toolbar';
import type { TableQueryState } from '@/lib/contracts/table';

afterEach(cleanup);

const state: TableQueryState = {
  page: 3,
  pageSize: 20,
  sort: '-createdAt',
  search: 'lee',
  filters: { status: 'active', superAdmin: '' },
};

const filters = [
  {
    name: 'status',
    label: 'Status',
    value: 'active',
    options: [
      { value: '', label: 'All statuses' },
      { value: 'active', label: 'Active' },
      { value: 'deactivated', label: 'Deactivated' },
      { value: 'deleted', label: 'Deleted' },
    ],
  },
];

describe('AdminTableToolbar', () => {
  it('renders a GET search form that keeps the sort, page size, and active filters', () => {
    render(
      <AdminTableToolbar
        pathname="/admin/users"
        state={state}
        searchLabel="Search users"
        filters={filters}
      />
    );

    const form = screen.getByRole('search').closest('form');
    expect(form?.getAttribute('method')).toBe('get');
    expect(form?.getAttribute('action')).toBe('/admin/users');

    const hidden = form?.querySelectorAll('input[type="hidden"]') ?? [];
    const values = Array.from(hidden).map(
      input => `${input.getAttribute('name')}=${input.getAttribute('value')}`
    );

    expect(values).toContain('sort=-createdAt');
    expect(values).toContain('pageSize=20');
    expect(values).toContain('status=active');
    expect(values).not.toContain('page=3');
  });

  it('prefills the search term', () => {
    render(
      <AdminTableToolbar
        pathname="/admin/users"
        state={state}
        searchLabel="Search users"
        filters={filters}
      />
    );

    expect(screen.getByLabelText('Search users').getAttribute('value')).toBe('lee');
  });

  it('renders a filter select per field and keeps the search term', () => {
    render(
      <AdminTableToolbar
        pathname="/admin/users"
        state={state}
        searchLabel="Search users"
        filters={filters}
      />
    );

    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    expect(select.getAttribute('name')).toBe('status');
    expect(select.value).toBe('active');

    const form = select.closest('form');
    const hidden = form?.querySelectorAll('input[type="hidden"]') ?? [];
    const values = Array.from(hidden).map(
      input => `${input.getAttribute('name')}=${input.getAttribute('value')}`
    );

    expect(values).toContain('q=lee');
    expect(values).toContain('sort=-createdAt');
    expect(values).not.toContain('page=3');
  });

  it('renders a clear link that drops the search term and every filter', () => {
    render(
      <AdminTableToolbar
        pathname="/admin/users"
        state={state}
        searchLabel="Search users"
        filters={filters}
        clearHref="/admin/users?pageSize=20&sort=-createdAt"
      />
    );

    const link = screen.getByRole('link', { name: /clear/i });
    expect(link.getAttribute('href')).toBe('/admin/users?pageSize=20&sort=-createdAt');
  });

  it('renders no clear link when nothing is filtered', () => {
    render(
      <AdminTableToolbar
        pathname="/admin/users"
        state={{ ...state, search: '', filters: {} }}
        searchLabel="Search users"
        filters={filters}
      />
    );

    expect(screen.queryByRole('link', { name: /clear/i })).toBeNull();
  });
});
