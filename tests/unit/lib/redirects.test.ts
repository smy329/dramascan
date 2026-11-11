import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CALLBACK_URL,
  buildAdminSignInUrl,
  isAdminPath,
  sanitizeCallbackUrl,
  sanitizeLocalCallback,
} from '@/lib/redirects';

describe('sanitizeLocalCallback', () => {
  it.each(['/dashboard', '/admin', '/admin?tab=roles', '/admin#top', '/admin/users/42?x=1#y'])(
    'accepts local path %s',
    (value) => {
      expect(sanitizeLocalCallback(value)).toBe(value);
    }
  );

  it.each([
    'https://evil.example',
    'http://evil.example/admin',
    '//evil.example',
    '/\\evil.example',
    '\\/evil.example',
    'javascript:alert(1)',
    'admin',
    '',
    '   ',
    '  /admin',
    '/admin\n',
    null,
    undefined,
    42,
    {},
  ])('rejects unsafe value %s', (value) => {
    expect(sanitizeLocalCallback(value)).toBeNull();
  });

  it('normalizes dot segments instead of trusting the raw string', () => {
    expect(sanitizeLocalCallback('/admin/../other')).toBe('/other');
  });
});

describe('sanitizeCallbackUrl', () => {
  it('returns a valid local path unchanged', () => {
    expect(sanitizeCallbackUrl('/admin/users')).toBe('/admin/users');
  });

  it('returns the default fallback for unsafe input', () => {
    expect(sanitizeCallbackUrl('https://evil.example')).toBe(DEFAULT_CALLBACK_URL);
  });

  it('uses the supplied fallback only when it is itself safe', () => {
    expect(sanitizeCallbackUrl(null, '/admin')).toBe('/admin');
    expect(sanitizeCallbackUrl(null, 'https://evil.example')).toBe(DEFAULT_CALLBACK_URL);
  });
});

describe('isAdminPath', () => {
  it.each(['/admin', '/admin/', '/admin/users', '/admin?tab=1', '/admin#top'])(
    'accepts admin path %s',
    (value) => {
      expect(isAdminPath(value)).toBe(true);
    }
  );

  it.each(['/', '/dashboard', '/administrator', '/adminish', '/other/admin'])(
    'rejects non-admin path %s',
    (value) => {
      expect(isAdminPath(value)).toBe(false);
    }
  );
});

describe('buildAdminSignInUrl', () => {
  it('encodes the requested admin path', () => {
    expect(buildAdminSignInUrl('/admin')).toBe('/auth/signin?callbackUrl=%2Fadmin');
    expect(buildAdminSignInUrl('/admin/users?page=2')).toBe(
      '/auth/signin?callbackUrl=%2Fadmin%2Fusers%3Fpage%3D2'
    );
  });

  it('falls back to /admin for unsafe or non-admin requests', () => {
    expect(buildAdminSignInUrl('https://evil.example')).toBe(
      '/auth/signin?callbackUrl=%2Fadmin'
    );
    expect(buildAdminSignInUrl('/dashboard')).toBe('/auth/signin?callbackUrl=%2Fadmin');
  });
});
