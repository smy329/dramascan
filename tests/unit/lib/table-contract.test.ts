import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TABLE_PAGE_SIZE,
  MAX_TABLE_PAGE_SIZE,
  TABLE_PAGE_SIZE_OPTIONS,
  TABLE_QUERY_PARAMS,
  buildTableHref,
  type TableQueryState,
} from '@/lib/contracts/table';

const state: TableQueryState = {
  page: 1,
  pageSize: 20,
  sort: '-createdAt',
  search: '',
  filters: {},
};

describe('table query parameters', () => {
  it('names the query parameters', () => {
    expect(TABLE_QUERY_PARAMS).toEqual({
      page: 'page',
      pageSize: 'pageSize',
      sort: 'sort',
      search: 'q',
    });
  });

  it('fixes the page size defaults and options', () => {
    expect(DEFAULT_TABLE_PAGE_SIZE).toBe(20);
    expect(MAX_TABLE_PAGE_SIZE).toBe(100);
    expect(TABLE_PAGE_SIZE_OPTIONS).toEqual([20, 50, 100]);
  });
});

describe('buildTableHref', () => {
  it('always emits the sort column and the page size', () => {
    expect(buildTableHref('/admin/users', state)).toBe(
      '/admin/users?pageSize=20&sort=-createdAt'
    );
  });

  it('omits the page parameter on the first page', () => {
    expect(buildTableHref('/admin/users', { ...state, page: 1 })).not.toMatch(/[?&]page=/);
  });

  it('emits the page parameter beyond the first page', () => {
    expect(buildTableHref('/admin/users', { ...state, page: 3 })).toContain('page=3');
  });

  it('omits an empty search term', () => {
    expect(buildTableHref('/admin/users', state)).not.toContain('q=');
    expect(buildTableHref('/admin/users', { ...state, search: 'lee' })).toContain('q=lee');
  });

  it('omits filters with an empty value and keeps the others', () => {
    const href = buildTableHref('/admin/users', {
      ...state,
      filters: { status: 'active', superAdmin: '' },
    });

    expect(href).toContain('status=active');
    expect(href).not.toContain('superAdmin');
  });

  it('preserves filters, search, and sort when only the page changes', () => {
    const href = buildTableHref('/admin/users', {
      ...state,
      page: 4,
      search: 'lee',
      filters: { status: 'active' },
    }, { page: 5 });

    expect(href).toContain('page=5');
    expect(href).toContain('q=lee');
    expect(href).toContain('status=active');
    expect(href).toContain('sort=-createdAt');
  });

  it('preserves filters, search, and sort when only the sort changes', () => {
    const href = buildTableHref('/admin/users', {
      ...state,
      search: 'lee',
      filters: { status: 'active' },
    }, { sort: 'name', page: 1 });

    expect(href).toBe('/admin/users?pageSize=20&sort=name&q=lee&status=active');
  });

  it('replaces the whole filter set when the filters are overridden', () => {
    const href = buildTableHref('/admin/users', {
      ...state,
      filters: { status: 'active' },
    }, { filters: {} });

    expect(href).not.toContain('status');
  });

  it('keeps the pathname free of a trailing question mark', () => {
    expect(buildTableHref('/admin/users', state)).not.toMatch(/\?$/);
  });
});
