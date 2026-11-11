/**
 * Pure admin-area access decision.
 *
 * The layout and the page both turn this decision into Next.js control flow
 * (`redirect`/`notFound`); keeping the decision itself framework-free makes it
 * testable without a database, request, or browser.
 */

import type { ActorContext } from '@/modules/authorization/actors';
import { buildAdminSignInUrl } from '@/lib/redirects';
import { hasAdminAreaAccess } from './navigation';

export type AdminPageAccess =
  | Readonly<{ status: 'allowed'; actor: ActorContext }>
  | Readonly<{ status: 'anonymous'; signInUrl: string }>
  | Readonly<{ status: 'forbidden' }>;

/**
 * Anonymous visitors are sent to sign in and returned to the requested admin
 * path. Authenticated actors without admin-area access get a 404, which hides
 * the administration area without adding an error page.
 */
export function resolveAdminPageAccess(
  actor: ActorContext,
  requestedPath: string
): AdminPageAccess {
  if (actor.userId === null) {
    return { status: 'anonymous', signInUrl: buildAdminSignInUrl(requestedPath) };
  }

  if (!hasAdminAreaAccess(actor)) {
    return { status: 'forbidden' };
  }

  return { status: 'allowed', actor };
}
