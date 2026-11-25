import 'server-only';

/**
 * Browser push provider abstraction (Prompt 147).
 *
 * The notification business logic never talks to a push provider directly. It
 * asks for a delivery through the `PushProvider` interface, so the provider
 * can change — from native Web Push to Firebase Cloud Messaging, or the other
 * way round — without rewriting a single notification workflow.
 *
 * The initial implementation uses **native Web Push** (the VAPID standard).
 * Firebase Cloud Messaging was evaluated and rejected: its browser SDK yields
 * a registration token, not the `endpoint` + `p256dh` + `auth` subscription
 * the browser hands the application, so it does not fit the stored
 * subscription model without a second identity system. Native Web Push is
 * free, standard, and speaks the subscription the browser already produced
 * (D-066).
 *
 * There is no email fallback. A provider that fails is a provider failure; the
 * delivery row records it and the in-app notification stands on its own.
 */

/** The push providers this abstraction knows about. */
export const PUSH_PROVIDERS = ['web_push', 'fcm'] as const;

/** One push provider. */
export type PushProviderName = (typeof PUSH_PROVIDERS)[number];

/** A browser push subscription, as the browser hands it to us. */
export type PushSubscriptionPayload = {
  /** The provider's endpoint URL. */
  endpoint: string;
  /** The client's public key, in base64url. */
  p256dh: string | null;
  /** The client's authentication secret, in base64url. */
  auth: string | null;
  /** A stable identifier of the browser profile, when the provider offers one. */
  browser: string | null;
  /** The browser's user agent, when the caller has it. */
  userAgent: string | null;
};

/** A push message. */
export type PushMessage = {
  /** The notification title. */
  title: string;
  /** The notification body. */
  body: string;
  /** A deep link into the site. */
  link?: string | null;
  /** An identifier the provider uses to collapse duplicates. */
  collapseKey?: string | null;
};

/** The outcome of one delivery attempt. */
export type PushDeliveryResult = {
  /** Whether the provider accepted the message. */
  delivered: boolean;
  /**
   * Whether the subscription is permanently unusable.
   *
   * A `410 Gone` or a `404 Not Found` means the endpoint is gone: the
   * subscription must be removed, and the message must not be retried.
   */
  expired: boolean;
  /** A short, credential-free description of what happened. */
  error: string | null;
};

/**
 * The contract every push provider implements.
 */
export type PushProvider = {
  /** The provider's name. */
  readonly name: PushProviderName;
  /** Whether the provider is configured and ready to deliver. */
  isAvailable(): boolean;
  /**
   * Deliver one message to one subscription.
   *
   * The implementation never throws for an ordinary delivery failure: it
   * returns a result, so the caller can record the outcome and stop.
   */
  send(
    _subscription: PushSubscriptionPayload,
    _message: PushMessage
  ): Promise<PushDeliveryResult>;
};

/** The default lifetime of a queued push message: one hour. */
export const DEFAULT_PUSH_TTL_SECONDS = 3600;

/** The longest lifetime a push service accepts: four weeks. */
const MAX_PUSH_TTL_SECONDS = 2_419_200;

/**
 * The provider that is configured for this deployment.
 *
 * Native Web Push is selected whenever a VAPID key pair is present. Without
 * one, the provider is still returned so the caller gets an honest
 * "not configured" failure instead of a crash.
 */
export function resolvePushProvider(): PushProvider {
  return createWebPushProvider();
}

/**
 * The native Web Push provider.
 *
 * Native Web Push is the VAPID standard: the browser creates the subscription,
 * and the server signs each request with a VAPID key pair. The `web-push`
 * package performs the encryption and the request. It is imported lazily so a
 * deployment that does not offer push never loads it.
 */
export function createWebPushProvider(): PushProvider {
  const publicKey = readEnvironment('WEB_PUSH_PUBLIC_KEY');
  const privateKey = readEnvironment('WEB_PUSH_PRIVATE_KEY');
  const subject = readEnvironment('WEB_PUSH_SUBJECT') ?? 'mailto:noreply@dramascan.local';
  const ttl = readTtlSeconds();

  return {
    name: 'web_push',

    isAvailable(): boolean {
      return publicKey !== null && privateKey !== null;
    },

    async send(
      subscription: PushSubscriptionPayload,
      message: PushMessage
    ): Promise<PushDeliveryResult> {
      if (publicKey === null || privateKey === null) {
        return {
          delivered: false,
          expired: false,
          error: 'Browser push is not configured.',
        };
      }

      if (subscription.p256dh === null || subscription.auth === null) {
        return {
          delivered: false,
          expired: false,
          error: 'The stored subscription has no encryption keys.',
        };
      }

      try {
        const webpush = await import('web-push');

        webpush.setVapidDetails(subject, publicKey, privateKey);

        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify({
            title: message.title,
            body: message.body,
            link: message.link ?? null,
            collapseKey: message.collapseKey ?? null,
          }),
          { TTL: ttl, urgency: 'normal' }
        );

        return { delivered: true, expired: false, error: null };
      } catch (error) {
        const statusCode = readStatusCode(error);

        if (statusCode === 404 || statusCode === 410) {
          return {
            delivered: false,
            expired: true,
            error: `The push subscription is gone (HTTP ${statusCode}).`,
          };
        }

        return {
          delivered: false,
          expired: false,
          // The underlying message may embed the endpoint, which is a
          // capability. Only the status code is safe to store.
          error:
            statusCode === null
              ? 'The push service could not be reached.'
              : `The push service rejected the message (HTTP ${statusCode}).`,
        };
      }
    },
  };
}

/**
 * A Firebase Cloud Messaging adapter.
 *
 * Kept as a separate implementation so the provider can change without
 * touching notification logic. It is not selected by `resolvePushProvider`:
 * the subscriptions this platform stores are native Web Push subscriptions,
 * not FCM registration tokens, so an FCM transport cannot address them.
 */
export function createFcmProvider(): PushProvider {
  const serverKey = readEnvironment('FCM_SERVER_KEY');
  const projectId = readEnvironment('FCM_PROJECT_ID');

  return {
    name: 'fcm',

    isAvailable(): boolean {
      return serverKey !== null && projectId !== null;
    },

    async send(): Promise<PushDeliveryResult> {
      return {
        delivered: false,
        expired: false,
        error: 'The stored subscription is not an FCM registration token.',
      };
    },
  };
}

/**
 * The public key the browser needs to create a subscription.
 *
 * @returns the VAPID public key, or `null` when push is not configured
 */
export function getBrowserPushPublicKey(): string | null {
  return readEnvironment('WEB_PUSH_PUBLIC_KEY');
}

/**
 * Is browser push offered to the viewer at all?
 *
 * @returns whether the deployment can accept a push subscription
 */
export function isBrowserPushAvailable(): boolean {
  return resolvePushProvider().isAvailable();
}

/** Read a trimmed environment value, treating an empty string as absent. */
function readEnvironment(name: string): string | null {
  const value = process.env[name]?.trim() ?? '';

  return value.length > 0 ? value : null;
}

/** Read the configured message lifetime, clamped to what a push service accepts. */
function readTtlSeconds(): number {
  const raw = Number(process.env.WEB_PUSH_TTL_SECONDS ?? DEFAULT_PUSH_TTL_SECONDS);

  if (!Number.isFinite(raw) || raw < 0) {
    return DEFAULT_PUSH_TTL_SECONDS;
  }

  return Math.min(Math.floor(raw), MAX_PUSH_TTL_SECONDS);
}

/** Read an HTTP status code from a provider error without trusting its message. */
function readStatusCode(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;

    if (typeof statusCode === 'number') {
      return statusCode;
    }
  }

  return null;
}
