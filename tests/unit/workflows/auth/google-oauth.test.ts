import { beforeEach, describe, expect, it, vi } from 'vitest';

const { signInSocialMock, redirectMock } = vi.hoisted(() => ({
  signInSocialMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock('@/platform/auth/better-auth', () => ({
  auth: {
    api: {
      signInSocial: signInSocialMock,
      signOut: vi.fn(),
    },
  },
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

import { googleSignIn } from '@/workflows/auth/google-oauth';

function formData(callbackUrl?: string): FormData {
  const data = new FormData();
  if (callbackUrl !== undefined) {
    data.set('callbackUrl', callbackUrl);
  }
  return data;
}

function bodySentToGoogle(): Record<string, unknown> {
  return signInSocialMock.mock.calls[0]?.[0]?.body ?? {};
}

beforeEach(() => {
  signInSocialMock.mockReset();
  redirectMock.mockReset();
  signInSocialMock.mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/auth' });
});

describe('googleSignIn', () => {
  it('forwards a valid local callback URL', async () => {
    await googleSignIn(formData('/admin'));

    expect(bodySentToGoogle()).toMatchObject({
      provider: 'google',
      callbackURL: '/admin',
      errorCallbackURL: '/auth/signin?callbackUrl=%2Fadmin',
    });
    expect(redirectMock).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth');
  });

  it('drops an external callback URL', async () => {
    await googleSignIn(formData('https://evil.example'));

    expect(bodySentToGoogle()).toMatchObject({
      callbackURL: '/dashboard',
      errorCallbackURL: '/auth/signin',
    });
  });

  it('defaults to the dashboard when no callback is supplied', async () => {
    await googleSignIn(formData());

    expect(bodySentToGoogle()).toMatchObject({ callbackURL: '/dashboard' });
  });
});
