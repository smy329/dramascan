'use client';

import { useState, useTransition } from 'react';
import { BellRing, Loader2, PowerOff } from 'lucide-react';

import type { PushSubscription } from '@/modules/notifications/subscriptions.shared';
import { subscribeToPush, unsubscribeFromPush } from '@/workflows/notifications/subscriptions';

/**
 * The browser push opt-in (Prompt 148).
 *
 * The permission is asked for at the moment the viewer asks for it — never on
 * the first page load. A browser that is asked for a permission without a
 * gesture answers "denied", and the viewer never sees the choice again; the
 * opt-in therefore lives behind a button the viewer presses.
 *
 * The component is honest about the two states it cannot change: a browser
 * that does not support push, and a deployment that has no push transport
 * configured. Neither is reported as a successful subscription.
 */

export type PushNotificationOptInProps = Readonly<{
  /**
   * The VAPID public key the browser needs to create a subscription.
   *
   * `null` means the deployment cannot accept a browser push subscription.
   */
  publicKey: string | null;
  /** The viewer's stored subscriptions. */
  subscriptions: readonly PushSubscription[];
}>;

type PushState = 'idle' | 'working' | 'enabled' | 'denied' | 'unavailable' | 'failed';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);

  for (let index = 0; index < raw.length; index += 1) {
    output[index] = raw.charCodeAt(index);
  }

  return output;
}

/** Encode the browser's subscription keys as base64url, the form the server stores. */
function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Release the browser's own push subscription when it is the one that was
 * turned off.
 *
 * The server row and the browser subscription are two different things: the
 * push service keeps delivering to a browser subscription until the browser
 * releases it. Only the subscription whose endpoint matches is released — a
 * viewer may hold several, and turning one off must not turn off the others.
 *
 * A browser that refuses, or a page with no service worker, leaves the
 * subscription in place: the server row is already gone, so the notification
 * is not delivered any more.
 *
 * @param endpoint the endpoint of the subscription that was turned off
 */
async function releaseBrowserSubscription(endpoint: string): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  try {
    // `getRegistration` resolves straight away when no service worker is
    // registered, unlike `ready`, which would wait for ever.
    const registration = await navigator.serviceWorker.getRegistration();

    if (!registration?.pushManager) {
      return;
    }

    const current = await registration.pushManager.getSubscription();

    if (current && current.endpoint === endpoint) {
      await current.unsubscribe();
    }
  } catch {
    // The browser may refuse to release the subscription. The server row is
    // gone, so nothing is delivered through it any more.
  }
}

export function PushNotificationOptIn({
  publicKey,
  subscriptions: initialSubscriptions,
}: Readonly<PushNotificationOptInProps>) {
  const [state, setState] = useState<PushState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<PushSubscription[]>([
    ...initialSubscriptions,
  ]);
  const [isPending, startTransition] = useTransition();

  const enable = async () => {
    setState('working');
    setMessage(null);

    if (publicKey === null) {
      setState('unavailable');
      setMessage('Browser push is not available in this deployment yet.');
      return;
    }

    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setState('unavailable');
      setMessage('This browser does not support browser push.');
      return;
    }

    let permission: NotificationPermission;

    try {
      permission = await Notification.requestPermission();
    } catch {
      setState('failed');
      setMessage('The browser refused the notification permission.');
      return;
    }

    if (permission !== 'granted') {
      setState('denied');
      setMessage('Browser notifications are blocked for this site.');
      return;
    }

    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();

      const subscription =
        existing ??
        await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });

      const keys = subscription.getKey('p256dh');
      const auth = subscription.getKey('auth');

      // Older browsers expose the keys as plain strings on the serialised
      // subscription instead of through `getKey`.
      const serialised = subscription.toJSON() as unknown as {
        p256dh?: string;
        auth?: string;
        keys?: Record<string, string>;
      };

      const p256dh = keys
        ? arrayBufferToBase64Url(keys)
        : serialised.keys?.p256dh ?? serialised.p256dh ?? null;
      const authSecret = auth
        ? arrayBufferToBase64Url(auth)
        : serialised.keys?.auth ?? serialised.auth ?? null;

      const result = await subscribeToPush({
        endpoint: subscription.endpoint,
        p256dh,
        auth: authSecret,
        browser: navigator.userAgent,
      });

      if (!result.ok) {
        setState('failed');
        setMessage(result.error.message);
        return;
      }

      setSubscriptions(current => {
        const withoutDuplicate = current.filter(row => row.endpoint !== result.data.endpoint);
        return [result.data, ...withoutDuplicate];
      });

      setState('enabled');
      setMessage('Browser push is enabled for this browser.');
    } catch {
      setState('failed');
      setMessage('This browser could not create a push subscription.');
    }
  };

  const disable = (subscription: PushSubscription) => {
    startTransition(async () => {
      const result = await unsubscribeFromPush(subscription.id);

      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }

      await releaseBrowserSubscription(subscription.endpoint);

      setSubscriptions(current => current.filter(row => row.id !== subscription.id));
      setState('idle');
      setMessage('Browser push was turned off for this browser.');
    });
  };

  return (
    <section
      aria-labelledby="browser-push-heading"
      className="rounded-xl border border-border bg-card p-5"
    >
      <h2 id="browser-push-heading" className="text-base font-medium text-foreground">
        Browser push
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Turn browser push on to be told about new episodes even when this tab is closed.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void enable()}
          disabled={state === 'working' || isPending}
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50"
        >
          {state === 'working' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <BellRing className="size-4" aria-hidden="true" />
          )}
          {state === 'working' ? 'Enabling…' : 'Enable browser push'}
        </button>

        {message ? (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        ) : null}
      </div>

      {subscriptions.length > 0 ? (
        <ul className="mt-5 space-y-2 border-t border-border pt-4">
          {subscriptions.map(subscription => (
            <li
              key={subscription.id}
              className="flex flex-wrap items-center justify-between gap-3 text-sm"
            >
              <span className="min-w-0 truncate text-muted-foreground">
                {subscription.browser ?? 'This browser'}
              </span>
              <button
                type="button"
                onClick={() => disable(subscription)}
                disabled={isPending}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50"
              >
                <PowerOff className="size-3.5" aria-hidden="true" />
                Turn off
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
