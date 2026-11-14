import { beforeEach, describe, expect, it, vi } from 'vitest';

const { signInEmailMock, redirectMock, headersMock } = vi.hoisted(() => ({
  signInEmailMock: vi.fn(),
  redirectMock: vi.fn(),
  headersMock: vi.fn(async () => new Headers({ 'user-agent': 'vitest' })),
}));

vi.mock('@/platform/auth/better-auth', () => ({
  auth: {
    api: {
      signInEmail: signInEmailMock,
    },
  },
}));

vi.mock('next/headers', () => ({
  headers: headersMock,
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

import { superAdminCredentialsSchema } from '@/workflows/auth/super-admin-credentials';
import { signInSuperAdmin } from '@/workflows/auth/super-admin-sign-in';

beforeEach(() => {
  signInEmailMock.mockReset();
  redirectMock.mockReset();
  signInEmailMock.mockResolvedValue({ token: 'session-token' });
});

describe('superAdminCredentialsSchema', () => {
  it('normalizes the email address', () => {
    const parsed = superAdminCredentialsSchema.safeParse({
      email: '  Root-Ctrl-X97@DramaScan.com  ',
      password: 'correct horse battery staple',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.email).toBe('root-ctrl-x97@dramascan.com');
    }
  });

  it.each([
    { email: '', password: 'x' },
    { email: 'not-an-email', password: 'x' },
    { email: 'root-ctrl-x97@dramascan.com', password: '' },
  ])('rejects invalid credentials %#', input => {
    expect(superAdminCredentialsSchema.safeParse(input).success).toBe(false);
  });
});

describe('signInSuperAdmin', () => {
  function credentialsForm(
    email: string,
    password: string,
    callbackUrl = '/admin'
  ): FormData {
    const data = new FormData();
    data.set('email', email);
    data.set('password', password);
    data.set('callbackUrl', callbackUrl);
    return data;
  }

  it('signs in with the credential provider and redirects to the admin area', async () => {
    const result = await signInSuperAdmin(
      credentialsForm('root-ctrl-x97@dramascan.com', 'correct horse battery staple', '/admin/users')
    );

    expect(result).toBeUndefined();
    expect(signInEmailMock).toHaveBeenCalledWith({
      body: {
        email: 'root-ctrl-x97@dramascan.com',
        password: 'correct horse battery staple',
      },
      headers: expect.any(Headers),
    });
    expect(redirectMock).toHaveBeenCalledWith('/admin/users');
  });

  it('falls back to /admin for a non-admin or unsafe callback', async () => {
    await signInSuperAdmin(
      credentialsForm(
        'root-ctrl-x97@dramascan.com',
        'correct horse battery staple',
        'https://evil.example'
      )
    );

    expect(redirectMock).toHaveBeenCalledWith('/admin');
  });

  it('returns one generic message when Better Auth rejects the credentials', async () => {
    signInEmailMock.mockRejectedValueOnce(new Error('INVALID_EMAIL_OR_PASSWORD'));

    const result = await signInSuperAdmin(
      credentialsForm('root-ctrl-x97@dramascan.com', 'wrong-password')
    );

    expect(result).toEqual({ ok: false, message: 'Invalid email or password.' });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('does not call Better Auth for invalid input', async () => {
    const result = await signInSuperAdmin(credentialsForm('nope', ''));

    expect(result).toEqual({ ok: false, message: 'Invalid email or password.' });
    expect(signInEmailMock).not.toHaveBeenCalled();
  });
});
