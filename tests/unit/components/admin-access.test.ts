import { describe, expect, it } from 'vitest';
import type { ActorContext } from '@/modules/authorization/actors';
import type { PermissionKey } from '@/modules/authorization/permissions';
import { resolveAdminPageAccess } from '@/components/admin/admin-access';

function actor(permissions: readonly PermissionKey[] = [], isSuperAdmin = false): ActorContext {
  return { userId: 'user-1', roles: [], isSuperAdmin, permissions };
}

const ANONYMOUS: ActorContext = {
  userId: null,
  roles: [],
  isSuperAdmin: false,
  permissions: [],
};

describe('resolveAdminPageAccess', () => {
  it('sends anonymous visitors to sign in with the encoded admin path', () => {
    expect(resolveAdminPageAccess(ANONYMOUS, '/admin')).toEqual({
      status: 'anonymous',
      signInUrl: '/auth/signin?callbackUrl=%2Fadmin',
    });
  });

  it('treats an anonymous super-admin flag as anonymous', () => {
    expect(resolveAdminPageAccess({ ...ANONYMOUS, isSuperAdmin: true }, '/admin').status).toBe(
      'anonymous'
    );
  });

  it('sanitizes unsafe requested paths before building the sign-in URL', () => {
    expect(resolveAdminPageAccess(ANONYMOUS, 'https://evil.example')).toEqual({
      status: 'anonymous',
      signInUrl: '/auth/signin?callbackUrl=%2Fadmin',
    });
    expect(resolveAdminPageAccess(ANONYMOUS, '/dashboard')).toEqual({
      status: 'anonymous',
      signInUrl: '/auth/signin?callbackUrl=%2Fadmin',
    });
  });

  it('forbids authenticated actors without admin-area access', () => {
    expect(resolveAdminPageAccess(actor(), '/admin')).toEqual({ status: 'forbidden' });
  });

  it.each([
    'drama.read',
    'movie.read',
    'episode.read',
    'category.read',
    'platform.read',
    'review.read',
    'review.manage',
    'user.read',
    'user.manage',
    'analytics.read',
    'settings.manage',
    'admin.manage',
  ] as const)('allows an actor holding %s', (permission) => {
    expect(resolveAdminPageAccess(actor([permission]), '/admin')).toEqual({
      status: 'allowed',
      actor: actor([permission]),
    });
  });

  it('forbids an actor whose only permission belongs to a Super Admin-only entry', () => {
    expect(resolveAdminPageAccess(actor(['settings.read']), '/admin')).toEqual({
      status: 'forbidden',
    });
  });

  it('denies a settings.read-only actor but allows a Super Admin and a non-Super-Admin operator', () => {
    expect(resolveAdminPageAccess(actor(['settings.read']), '/admin').status).toBe('forbidden');
    expect(resolveAdminPageAccess(actor([], true), '/admin').status).toBe('allowed');
    expect(resolveAdminPageAccess(actor(['admin.manage']), '/admin').status).toBe('allowed');
  });

  it('always allows Super Admin', () => {
    const superAdmin = actor([], true);
    expect(resolveAdminPageAccess(superAdmin, '/admin')).toEqual({
      status: 'allowed',
      actor: superAdmin,
    });
  });
});
