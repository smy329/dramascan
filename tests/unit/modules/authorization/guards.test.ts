import { describe, expect, it } from 'vitest';
import {
  assertResourceAccess,
  hasPermission,
  requireAdmin,
  requireAnyPermission,
  requirePermission,
  requireSuperAdmin,
  requireUser,
} from '@/modules/authorization/guards';
import type { ActorContext } from '@/modules/authorization/actors';
import { AuthenticationError } from '@/platform/errors';
import { AuthorizationError } from '@/platform/errors';

const anonymous: ActorContext = {
  userId: null,
  roles: [],
  isSuperAdmin: false,
  permissions: [],
};

const moderator: ActorContext = {
  userId: 'user-1',
  roles: ['moderator'],
  isSuperAdmin: false,
  permissions: ['review.manage', 'review.read'],
};

const superAdmin: ActorContext = {
  userId: 'user-2',
  roles: ['super_admin'],
  isSuperAdmin: true,
  permissions: [],
};

describe('hasPermission', () => {
  it('denies anonymous actors even for catalog permissions', () => {
    expect(hasPermission(anonymous, 'review.read')).toBe(false);
  });

  it('allows a permission granted through a role', () => {
    expect(hasPermission(moderator, 'review.manage')).toBe(true);
  });

  it('denies a permission not granted to the actor', () => {
    expect(hasPermission(moderator, 'drama.update')).toBe(false);
  });

  it('allows Super Admin every catalog permission', () => {
    expect(hasPermission(superAdmin, 'admin.manage')).toBe(true);
    expect(hasPermission(superAdmin, 'drama.delete')).toBe(true);
  });
});

describe('requirePermission', () => {
  it('throws AuthenticationError (401) for anonymous actors', () => {
    expect(() => requirePermission(anonymous, 'review.read')).toThrow(AuthenticationError);
  });

  it('throws AuthorizationError (403) when the permission is missing', () => {
    expect(() => requirePermission(moderator, 'drama.update')).toThrow(AuthorizationError);
  });

  it('returns the actor when the permission is held', () => {
    expect(requirePermission(moderator, 'review.manage')).toBe(moderator);
  });
});

describe('requireAnyPermission', () => {
  it('allows an actor holding one of the listed permissions', () => {
    expect(requireAnyPermission(moderator, ['drama.update', 'review.read'])).toBe(moderator);
  });

  it('throws AuthenticationError for anonymous actors', () => {
    expect(() => requireAnyPermission(anonymous, ['review.read'])).toThrow(AuthenticationError);
  });

  it('throws AuthorizationError when no listed permission is held', () => {
    expect(() => requireAnyPermission(moderator, ['drama.update', 'user.manage'])).toThrow(
      AuthorizationError
    );
  });
});

describe('requireUser', () => {
  it('rejects anonymous actors', () => {
    expect(() => requireUser(anonymous)).toThrow(AuthenticationError);
  });

  it('accepts any authenticated actor', () => {
    expect(requireUser(moderator)).toBe(moderator);
  });
});

describe('requireAdmin', () => {
  it('rejects anonymous actors', () => {
    expect(() => requireAdmin(anonymous)).toThrow(AuthenticationError);
  });

  it('rejects authenticated non-administrators', () => {
    expect(() => requireAdmin(moderator)).toThrow(AuthorizationError);
  });

  it('accepts holders of admin.manage', () => {
    const admin: ActorContext = { ...moderator, permissions: ['admin.manage'] };
    expect(requireAdmin(admin)).toBe(admin);
  });

  it('accepts Super Admin', () => {
    expect(requireAdmin(superAdmin)).toBe(superAdmin);
  });
});

describe('assertResourceAccess', () => {
  it('denies actors without the permission', () => {
    expect(assertResourceAccess(moderator, 'drama.update')).toBe(false);
  });

  it('allows the permission when no resource scope is supplied', () => {
    expect(assertResourceAccess(moderator, 'review.manage')).toBe(true);
  });

  it('restricts scoped resources to their owner', () => {
    expect(assertResourceAccess(moderator, 'review.manage', { ownerUserId: 'user-1' })).toBe(true);
    expect(assertResourceAccess(moderator, 'review.manage', { ownerUserId: 'other' })).toBe(false);
  });

  it('denies anonymous actors even for unowned resources', () => {
    expect(assertResourceAccess(anonymous, 'review.read')).toBe(false);
  });
});

describe('requireSuperAdmin', () => {
  it('rejects anonymous actors with AuthenticationError', () => {
    expect(() => requireSuperAdmin(anonymous)).toThrow(AuthenticationError);
  });

  it('rejects an authenticated non-Super-Admin even with admin.manage', () => {
    const adminManager: ActorContext = {
      userId: 'user-9',
      roles: ['admin'],
      isSuperAdmin: false,
      permissions: ['admin.manage'],
    };

    expect(() => requireSuperAdmin(adminManager)).toThrow(AuthorizationError);
  });

  it('returns the actor for a Super Admin', () => {
    expect(requireSuperAdmin(superAdmin)).toBe(superAdmin);
  });
});
