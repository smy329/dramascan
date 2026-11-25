'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/contracts/common';
import { requireUserId, resolveActor } from '@/modules/authorization';
import {
  isAcceptablePushEndpoint,
  listSubscriptions,
  removeSubscription,
  saveSubscription,
  type PushSubscription,
} from '@/modules/notifications';
import { toActionError } from '@/workflows/action-errors';

/**
 * The browser push subscription actions (Prompt 148).
 *
 * The browser hands over its endpoint and the two keys it generated. The
 * action stores them against the signed-in viewer and nothing else: a client
 * cannot subscribe another viewer, and the endpoint is never exposed to
 * another viewer.
 *
 * The endpoint is a capability *and* an address the server will contact. It
 * is therefore validated before it is stored: only a public HTTPS endpoint
 * that the deployment accepts is kept (D-070).
 */

const subscriptionInputSchema = z.object({
  endpoint: z.string().min(1).max(2048),
  p256dh: z.string().max(512).nullable().optional(),
  auth: z.string().max(512).nullable().optional(),
  browser: z.string().max(200).nullable().optional(),
});

/**
 * Store a browser push subscription for the signed-in viewer.
 *
 * @param input the browser's subscription
 * @returns the stored subscription
 */
export async function subscribeToPush(input: unknown): Promise<ActionResult<PushSubscription>> {
  try {
    const actor = await resolveActor();
    const userId = requireUserId(actor);

    const parsed = subscriptionInputSchema.safeParse(input);

    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'validation_error',
          message: 'The push subscription is not valid.',
          fieldErrors: {
            body: parsed.error.issues.map(issue => issue.message),
          },
        },
      };
    }

    if (!isAcceptablePushEndpoint(parsed.data.endpoint)) {
      return {
        ok: false,
        error: {
          code: 'validation_error',
          message: 'The push subscription endpoint is not an accepted push address.',
          fieldErrors: {
            body: ['The push endpoint must be a public HTTPS address.'],
          },
        },
      };
    }

    const stored = await saveSubscription(userId, {
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.p256dh ?? null,
      auth: parsed.data.auth ?? null,
      browser: parsed.data.browser ?? null,
      userAgent: null,
    });

    if (!stored) {
      return {
        ok: false,
        error: {
          code: 'conflict',
          message:
            'This account already holds the maximum number of browser push subscriptions.',
        },
      };
    }

    return { ok: true, data: stored };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/**
 * Remove one of the viewer's push subscriptions.
 *
 * @param subscriptionId the subscription to remove
 * @returns whether the subscription was removed
 */
export async function unsubscribeFromPush(
  subscriptionId: unknown
): Promise<ActionResult<{ removed: boolean }>> {
  try {
    const actor = await resolveActor();
    const userId = requireUserId(actor);

    const parsed = z.string().uuid().safeParse(subscriptionId);

    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'validation_error', message: 'The subscription id is not valid.' },
      };
    }

    const removed = await removeSubscription(userId, parsed.data);

    return { ok: true, data: { removed } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/**
 * The viewer's active push subscriptions.
 *
 * @returns the subscriptions
 */
export async function readPushSubscriptions(): Promise<ActionResult<PushSubscription[]>> {
  try {
    const actor = await resolveActor();
    const userId = requireUserId(actor);

    return { ok: true, data: await listSubscriptions(userId) };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
