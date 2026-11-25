// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PushNotificationOptIn } from '@/components/notifications/push-notification-opt-in';
import type { PushSubscription } from '@/modules/notifications';

const unsubscribeFromPush = vi.fn();

vi.mock('@/workflows/notifications/subscriptions', () => ({
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: (id: unknown) => unsubscribeFromPush(id),
}));

afterEach(() => {
  cleanup();
  unsubscribeFromPush.mockReset();
});

const SUBSCRIPTION: PushSubscription = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  endpoint: 'https://push.example/subscription/one',
  browser: 'Firefox on Linux',
  createdAt: new Date('2026-11-25T00:00:00.000Z'),
};

/**
 * A browser push subscription that the service worker holds.
 *
 * The browser object is separate from the server row: turning the row off has
 * to release the browser subscription too, or the push service keeps delivering
 * to a browser the viewer has turned off.
 */
function stubBrowserSubscription(endpoint: string) {
  const unsubscribe = vi.fn().mockResolvedValue(true);

  const registration = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue({ endpoint, unsubscribe }),
    },
  };

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: vi.fn().mockResolvedValue(registration),
    },
  });

  return unsubscribe;
}

describe('PushNotificationOptIn', () => {
  it('releases the browser subscription that was turned off', async () => {
    const browserUnsubscribe = stubBrowserSubscription(SUBSCRIPTION.endpoint);

    unsubscribeFromPush.mockResolvedValue({ ok: true, data: { removed: true } });

    render(
      <PushNotificationOptIn publicKey="public-key" subscriptions={[SUBSCRIPTION]} />
    );

    fireEvent.click(screen.getByRole('button', { name: /turn off/i }));

    await waitFor(() => {
      expect(unsubscribeFromPush).toHaveBeenCalledWith(SUBSCRIPTION.id);
    });

    await waitFor(() => {
      expect(browserUnsubscribe).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText(SUBSCRIPTION.browser ?? '')).toBeNull();
  });

  it('keeps a browser subscription that belongs to another entry', async () => {
    const browserUnsubscribe = stubBrowserSubscription('https://push.example/subscription/two');

    unsubscribeFromPush.mockResolvedValue({ ok: true, data: { removed: true } });

    render(
      <PushNotificationOptIn publicKey="public-key" subscriptions={[SUBSCRIPTION]} />
    );

    fireEvent.click(screen.getByRole('button', { name: /turn off/i }));

    await waitFor(() => {
      expect(unsubscribeFromPush).toHaveBeenCalledWith(SUBSCRIPTION.id);
    });

    await waitFor(() => {
      expect(screen.queryByText(SUBSCRIPTION.browser ?? '')).toBeNull();
    });

    expect(browserUnsubscribe).not.toHaveBeenCalled();
  });

  it('keeps the browser subscription when the server refuses the removal', async () => {
    const browserUnsubscribe = stubBrowserSubscription(SUBSCRIPTION.endpoint);

    unsubscribeFromPush.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'You may not remove this subscription.' },
    });

    render(
      <PushNotificationOptIn publicKey="public-key" subscriptions={[SUBSCRIPTION]} />
    );

    fireEvent.click(screen.getByRole('button', { name: /turn off/i }));

    await waitFor(() => {
      expect(
        screen.getByText('You may not remove this subscription.')
      ).toBeTruthy();
    });

    expect(browserUnsubscribe).not.toHaveBeenCalled();
  });
});
