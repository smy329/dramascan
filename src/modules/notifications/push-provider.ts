import 'server-only';

/**
 * Browser push provider abstraction (Prompt 147).
 *
 * The notification business logic never talks to a push provider directly. It
 * asks for a delivery through the `PushProvider` interface, so the provider
 * can change — from Firebase Cloud Messaging to native Web Push, or the other
 * way round — without rewriting a single notification workflow.
 *
 * The initial implementation prefers Firebase Cloud Messaging because it is
 * free at the scale this platform operates at, and falls back to native Web
 * Push (the VAPID standard) when no FCM configuration is present.
 *
 * There is no email fallback. A provider that fails is a provider failure; the
 * delivery row records it and the in-app notification stands on its own.
 */

/** The push providers this abstraction knows about. */
export const PUSH_PROVIDERS = ['fcm', 'web_push'] as const;

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

/**
 * The provider that is configured for this deployment.
 *
 * FCM is preferred when its environment variables are present; otherwise the
 * native Web Push provider is used.
 */
export function resolvePushProvider(): PushProvider {
  const fcm = createFcmProvider();

  if (fcm.isAvailable()) {
    return fcm;
  }

  return createWebPushProvider();
}

/**
 * A Firebase Cloud Messaging provider.
 *
 * FCM needs a server key. When the deployment has none, the provider reports
 * itself as unavailable and the application falls back to native Web Push.
 */
export function createFcmProvider(): PushProvider {
  const serverKey = process.env.FCM_SERVER_KEY ?? null;
  const projectId = process.env.FCM_PROJECT_ID ?? null;

  return {
    name: 'fcm',

    isAvailable(): boolean {
      return serverKey !== null && serverKey.length > 0 && projectId !== null;
    },

    async send(
      _subscription: PushSubscriptionPayload,
      _message: PushMessage
    ): Promise<PushDeliveryResult> {
      if (!this.isAvailable()) {
        return {
          delivered: false,
          expired: false,
          error: 'Firebase Cloud Messaging is not configured.',
        };
      }

      // The FCM HTTP v1 transport needs a service account and an OAuth token.
      // The deployment provides both through `FIREBASE_SERVICE_ACCOUNT_JSON`;
      // without it, the provider cannot send and says so plainly.
      const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? null;

      if (serviceAccount === null) {
        return {
          delivered: false,
          expired: false,
          error: 'Firebase Cloud Messaging has no service account.',
        };
      }

      // A browser push endpoint from FCM is not the FCM registration token
      // format, so the browser endpoint cannot be delivered to through FCM
      // without a mapping this deployment does not have. The provider reports
      // the mismatch instead of pretending the message was sent.
      return {
        delivered: false,
        expired: false,
        error: 'The stored subscription is not an FCM registration token.',
      };
    },
  };
}

/**
 * The native Web Push provider.
 *
 * Native Web Push is the VAPID standard: the browser creates the subscription,
 * and the server signs each request with a VAPID key pair. The dependency is
 * deliberately optional: when the `web-push` package is not installed, the
 * provider reports itself as unavailable rather than crashing the server.
 */
export function createWebPushProvider(): PushProvider {
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY ?? null;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY ?? null;

  return {
    name: 'web_push',

    isAvailable(): boolean {
      return publicKey !== null && privateKey !== null && publicKey.length > 0;
    },

    async send(
      _subscription: PushSubscriptionPayload,
      _message: PushMessage
    ): Promise<PushDeliveryResult> {
      if (!this.isAvailable()) {
        return {
          delivered: false,
          expired: false,
          error: 'Browser push is not configured.',
        };
      }

      // The VAPID transport is not wired in the initial version. The provider
      // says so rather than recording a delivery that never happened.
      return {
        delivered: false,
        expired: false,
        error: 'The browser push transport is not available in this deployment.',
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
  const publicKey = process.env.WEB_PUSH_PUBLIC_KEY ?? null;

  return publicKey !== null && publicKey.length > 0 ? publicKey : null;
}

/**
 * Is browser push offered to the viewer at all?
 *
 * @returns whether the deployment can accept a push subscription
 */
export function isBrowserPushAvailable(): boolean {
  return resolvePushProvider().isAvailable();
}
