import 'server-only';

import { serverConfig } from '@/platform/config';

import {
  DEFAULT_PUSH_TIMEOUT_MS,
  sendWebPush,
  validatePushEndpoint,
  type PushTransportConfig,
} from './push-transport';

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
 * The transport itself — the endpoint rules, the address check, and the
 * request — lives in `push-transport.ts`, so the application and the
 * short-lived maintenance command share one implementation (D-070).
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
 * package performs the encryption and the request; the transport module owns
 * it, so the maintenance command can use it too.
 */
export function createWebPushProvider(config: PushTransportConfig = readTransportConfig()): PushProvider {
  return {
    name: 'web_push',

    isAvailable(): boolean {
      return config.publicKey !== null && config.privateKey !== null;
    },

    async send(
      subscription: PushSubscriptionPayload,
      message: PushMessage
    ): Promise<PushDeliveryResult> {
      return sendWebPush(
        {
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
        {
          title: message.title,
          body: message.body,
          link: message.link ?? null,
          collapseKey: message.collapseKey ?? null,
        },
        config
      );
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
  const serverKey = serverConfig.fcmServerKey;
  const projectId = serverConfig.fcmProjectId;

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
  return serverConfig.webPushPublicKey;
}

/**
 * Is browser push offered to the viewer at all?
 *
 * @returns whether the deployment can accept a push subscription
 */
export function isBrowserPushAvailable(): boolean {
  return resolvePushProvider().isAvailable();
}

/**
 * Is this endpoint one the deployment accepts?
 *
 * The check is the same one the transport applies before every delivery, so
 * a subscription is never stored that the server would refuse to contact.
 *
 * @param endpoint the endpoint the browser handed over
 * @returns whether the endpoint is acceptable
 */
export function isAcceptablePushEndpoint(endpoint: string): boolean {
  return validatePushEndpoint(endpoint, serverConfig.pushAllowedHosts).valid;
}

/** The transport configuration of this deployment. */
function readTransportConfig(): PushTransportConfig {
  return {
    publicKey: serverConfig.webPushPublicKey,
    privateKey: serverConfig.webPushPrivateKey,
    subject: serverConfig.webPushSubject ?? 'mailto:noreply@dramascan.local',
    ttlSeconds: serverConfig.webPushTtlSeconds,
    allowedHosts: serverConfig.pushAllowedHosts,
    timeoutMs: DEFAULT_PUSH_TIMEOUT_MS,
  };
}
