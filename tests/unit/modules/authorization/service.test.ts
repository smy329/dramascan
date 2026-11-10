import { describe, expect, it } from 'vitest';
import { resolveEffectivePermissions } from '@/modules/authorization/service';
import { ALL_PERMISSION_KEYS } from '@/modules/authorization/permissions';

describe('resolveEffectivePermissions', () => {
  it('returns no permissions when the actor has no roles', () => {
    expect(resolveEffectivePermissions({})).toEqual({ permissions: [], isSuperAdmin: false });
  });

  it('unions granted permissions across every assigned role', () => {
    const result = resolveEffectivePermissions({
      roleAssignments: [
        {
          roleId: 'role-1',
          permissions: [
            { permissionKey: 'review.read', granted: true },
            { permissionKey: 'review.manage', granted: true },
          ],
        },
        {
          roleId: 'role-2',
          permissions: [
            { permissionKey: 'review.manage', granted: true },
            { permissionKey: 'drama.update', granted: true },
          ],
        },
      ],
    });

    expect(result.isSuperAdmin).toBe(false);
    expect([...result.permissions].sort()).toEqual(['drama.update', 'review.manage', 'review.read']);
  });

  it('excludes permissions that were explicitly revoked', () => {
    const result = resolveEffectivePermissions({
      roleAssignments: [
        {
          roleId: 'role-1',
          permissions: [
            { permissionKey: 'drama.update', granted: true },
            { permissionKey: 'drama.delete', granted: false },
          ],
        },
      ],
    });

    expect(result.permissions).toEqual(['drama.update']);
  });

  it('resolves Super Admin to the complete catalog', () => {
    const result = resolveEffectivePermissions({ isSuperAdmin: true });

    expect(result.isSuperAdmin).toBe(true);
    expect(result.permissions).toEqual(ALL_PERMISSION_KEYS);
  });

  it('ignores role assignments for Super Admin', () => {
    const result = resolveEffectivePermissions({
      isSuperAdmin: true,
      roleAssignments: [
        { roleId: 'role-1', permissions: [{ permissionKey: 'drama.read', granted: true }] },
      ],
    });

    expect(result.permissions).toEqual(ALL_PERMISSION_KEYS);
  });
});
