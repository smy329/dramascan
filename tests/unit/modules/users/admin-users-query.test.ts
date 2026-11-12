import { describe, expect, it } from 'vitest';

import { DEFAULT_TABLE_PAGE_SIZE, MAX_TABLE_PAGE_SIZE } from '@/lib/contracts/table';
import {
  ADMIN_USER_SORT_FIELDS,
  ADMIN_USER_STATUSES,
  formatSortToken,
  parseAdminUsersQuery,
} from '@/modules/users/validation';

describe('admin users query contract', () => {
  it('exposes the same statuses and sort fields as the auth module', () => {
    expect([...ADMIN_USER_STATUSES]).toEqual(['active', 'deactivated', 'deleted']);
    expect([...ADMIN_USER_SORT_FIELDS]).toEqual(['name', 'email', 'createdAt', 'updatedAt']);
  });

  it('applies the documented defaults', () => {
    expect(parseAdminUsersQuery({})).toEqual({
      page: 1,
      pageSize: DEFAULT_TABLE_PAGE_SIZE,
      sortBy: 'createdAt',
      sortDirection: 'desc',
      search: '',
      status: null,
      superAdmin: null,
    });
  });

  it('matches the shared contract page-size bounds', () => {
    expect(parseAdminUsersQuery({ pageSize: '100' }).pageSize).toBe(MAX_TABLE_PAGE_SIZE);
    expect(parseAdminUsersQuery({ pageSize: '500' }).pageSize).toBe(DEFAULT_TABLE_PAGE_SIZE);
    expect(parseAdminUsersQuery({ pageSize: '0' }).pageSize).toBe(DEFAULT_TABLE_PAGE_SIZE);
  });

  it('normalizes an invalid page instead of failing', () => {
    expect(parseAdminUsersQuery({ page: '-3' }).page).toBe(1);
    expect(parseAdminUsersQuery({ page: 'abc' }).page).toBe(1);
    expect(parseAdminUsersQuery({ page: '4' }).page).toBe(4);
  });

  it('replaces an unknown sort column with the default', () => {
    expect(parseAdminUsersQuery({ sort: 'password' }).sortBy).toBe('createdAt');
    expect(parseAdminUsersQuery({ sort: 'password' }).sortDirection).toBe('desc');
    expect(parseAdminUsersQuery({ sort: 'name' }).sortBy).toBe('name');
    expect(parseAdminUsersQuery({ sort: '-name' }).sortDirection).toBe('desc');
    expect(parseAdminUsersQuery({ sort: 'name' }).sortDirection).toBe('asc');
  });

  it('uses the first recognized column of a comma separated sort', () => {
    expect(parseAdminUsersQuery({ sort: 'name,email' }).sortBy).toBe('name');
    expect(parseAdminUsersQuery({ sort: 'password,email' }).sortBy).toBe('email');
    expect(parseAdminUsersQuery({ sort: 'password,nope' }).sortBy).toBe('createdAt');
  });

  it('normalizes the status and Super Admin filters', () => {
    expect(parseAdminUsersQuery({ status: 'active' }).status).toBe('active');
    expect(parseAdminUsersQuery({ status: 'bogus' }).status).toBeNull();
    expect(parseAdminUsersQuery({ superAdmin: 'yes' }).superAdmin).toBe(true);
    expect(parseAdminUsersQuery({ superAdmin: 'no' }).superAdmin).toBe(false);
    expect(parseAdminUsersQuery({ superAdmin: 'maybe' }).superAdmin).toBeNull();
  });

  it('trims the search term and discards an unusable one', () => {
    expect(parseAdminUsersQuery({ q: '  lee  ' }).search).toBe('lee');
    expect(parseAdminUsersQuery({ q: 'x'.repeat(500) }).search).toBe('');
  });

  it('ignores unknown query parameters', () => {
    expect(parseAdminUsersQuery({ utm_source: 'newsletter' }).page).toBe(1);
  });

  it('formats a sort token with the descending prefix', () => {
    expect(formatSortToken('name', 'desc')).toBe('-name');
    expect(formatSortToken('name', 'asc')).toBe('name');
  });
});
