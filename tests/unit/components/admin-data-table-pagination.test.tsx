// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { AdminTablePagination } from '@/components/admin/data-table/data-table-pagination';
import type { TableQueryState } from '@/lib/contracts/table';

afterEach(cleanup);

const state: TableQueryState = {
  page: 3,
  pageSize: 20,
  sort: '-createdAt',
  search: 'lee',
  filters: { status: 'active' },
};

describe('AdminTablePagination', () => {
  it('summarises the visible range and the total', () => {
    render(
      <AdminTablePagination
        pathname="/admin/users"
        state={state}
        total={137}
        totalPages={7}
        itemLabel="users"
      />
    );

    expect(screen.getByText(/Showing 41–60 of 137 users/).textContent).toBe(
      'Showing 41–60 of 137 users'
    );
  });

  it('reports an empty result', () => {
    render(
      <AdminTablePagination
        pathname="/admin/users"
        state={{ ...state, page: 1 }}
        total={0}
        totalPages={0}
        itemLabel="users"
      />
    );

    expect(screen.getByText('No users')).toBeTruthy();
  });

  it('shows the last page for a URL that asked past it', () => {
    // A shared or bookmarked `?page=99` resolves to the last page in the read
    // model, so the page hands the component the resolved page: the summary,
    // the page window, and the current-page marker all describe a page that
    // exists rather than an inverted range over pages nobody can open.
    render(
      <AdminTablePagination
        pathname="/admin/users"
        state={{ ...state, page: 7 }}
        total={137}
        totalPages={7}
        itemLabel="users"
      />
    );

    expect(screen.getByText(/Showing 121–137 of 137 users/).textContent).toBe(
      'Showing 121–137 of 137 users'
    );

    // The numbered links only: Previous and Next live in the same nav.
    const pageLinks = Array.from(
      screen.getByRole('navigation', { name: 'Pagination' }).querySelectorAll('a')
    ).filter(link => /^\d+$/.test(link.textContent ?? ''));
    const labels = pageLinks.map(link => link.textContent);

    // Pages 1 and 7 with the current page's neighbour, and nothing beyond the
    // last page.
    expect(labels).toEqual(['1', '6', '7']);

    const current = pageLinks.filter(link => link.getAttribute('aria-current') === 'page');

    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe('7');
  });

  it('keeps the sort, the search term, and the filters in the page links', () => {
    render(
      <AdminTablePagination
        pathname="/admin/users"
        state={state}
        total={137}
        totalPages={7}
        itemLabel="users"
      />
    );

    const href = screen.getByRole('link', { name: 'Next' }).getAttribute('href') ?? '';

    expect(href).toContain('page=4');
    expect(href).toContain('sort=-createdAt');
    expect(href).toContain('q=lee');
    expect(href).toContain('status=active');
  });

  it('renders a disabled previous control on the first page', () => {
    render(
      <AdminTablePagination
        pathname="/admin/users"
        state={{ ...state, page: 1 }}
        total={137}
        totalPages={7}
        itemLabel="users"
      />
    );

    expect(screen.queryByRole('link', { name: 'Previous' })).toBeNull();
    expect(screen.getByText('Previous')).toBeTruthy();
  });

  it('renders a disabled next control on the last page', () => {
    render(
      <AdminTablePagination
        pathname="/admin/users"
        state={{ ...state, page: 7 }}
        total={137}
        totalPages={7}
        itemLabel="users"
      />
    );

    expect(screen.queryByRole('link', { name: 'Next' })).toBeNull();
    expect(screen.getByText('Next')).toBeTruthy();
  });

  it('renders a page-size form that keeps the rest of the state', () => {
    render(
      <AdminTablePagination
        pathname="/admin/users"
        state={state}
        total={137}
        totalPages={7}
        itemLabel="users"
      />
    );

    const select = screen.getByLabelText('Rows per page') as HTMLSelectElement;
    expect(select.getAttribute('name')).toBe('pageSize');
    expect(select.value).toBe('20');

    const form = select.closest('form');
    const hidden = form?.querySelectorAll('input[type="hidden"]') ?? [];
    const values = Array.from(hidden).map(
      input => `${input.getAttribute('name')}=${input.getAttribute('value')}`
    );

    expect(values).toContain('sort=-createdAt');
    expect(values).toContain('q=lee');
    expect(values).toContain('status=active');
    expect(values).not.toContain('page=3');
  });

  it('offers the current page size when it is not one of the standard options', () => {
    render(
      <AdminTablePagination
        pathname="/admin/users"
        state={{ ...state, pageSize: 1 }}
        total={3}
        totalPages={3}
        itemLabel="users"
      />
    );

    const select = screen.getByLabelText('Rows per page') as HTMLSelectElement;

    // The URL asked for one row per page, so the control must say so rather
    // than show a stale standard value the page is not using.
    expect(select.value).toBe('1');

    const offered = Array.from(select.options).map(option => option.value);

    expect(offered).toEqual(['1', '20', '50', '100']);
  });
});
