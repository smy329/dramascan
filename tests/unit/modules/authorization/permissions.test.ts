import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  PERMISSIONS,
  SUPER_ADMIN_PERMISSION_KEYS,
  isPermissionKey,
  toPermissionKey,
} from '@/modules/authorization/permissions';

describe('permission catalog', () => {
  it('exposes every catalog entry as a canonical key', () => {
    expect(ALL_PERMISSION_KEYS).toEqual(Object.keys(PERMISSIONS));
    expect(ALL_PERMISSION_KEYS.length).toBeGreaterThan(0);
  });

  it('grants Super Admin the complete catalog', () => {
    expect(SUPER_ADMIN_PERMISSION_KEYS).toEqual(ALL_PERMISSION_KEYS);
  });

  it('recognises only canonical keys', () => {
    expect(isPermissionKey('drama.update')).toBe(true);
    expect(isPermissionKey('drama.delete')).toBe(true);
    expect(isPermissionKey('role.update')).toBe(false);
    expect(isPermissionKey('Drama.Update')).toBe(false);
    expect(isPermissionKey(undefined)).toBe(false);
  });

  it('composes canonical keys from resource and action', () => {
    expect(toPermissionKey('drama', 'update')).toBe('drama.update');
    expect(toPermissionKey('admin', 'manage')).toBe('admin.manage');
  });

  it('rejects resource/action combinations that are not in the catalog', () => {
    expect(() => toPermissionKey('drama', 'manage' as never)).not.toThrow();
    expect(() => toPermissionKey('admin', 'delete')).toThrow(/Unknown permission key/);
  });

  it('decomposes every catalog key into a valid resource and action', () => {
    for (const key of ALL_PERMISSION_KEYS) {
      const [resource, action, ...rest] = key.split('.');

      expect(rest).toEqual([]);
      expect(PERMISSION_RESOURCES).toContain(resource);
      expect(PERMISSION_ACTIONS).toContain(action);
    }
  });
});
