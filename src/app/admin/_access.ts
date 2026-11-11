import 'server-only';

import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';

import { resolveAdminPageAccess } from '@/components/admin/admin-access';
import { buildAdminSignInUrl } from '@/lib/redirects';
import { resolveActor, type ActorContext } from '@/modules/authorization';
import { getActiveSession } from '@/platform/auth/session';

export type AdminPageContext = Readonly<{
  actor: ActorContext;
  user: Readonly<{ name: string; email: string }>;
}>;

// One actor and one session read per request, shared by the layout and page.
const getCachedActor = cache(resolveActor);
const getCachedSession = cache(getActiveSession);

/**
 * Server-side gate for every admin route.
 *
 * The layout and the page both call this, so a layout bypass cannot leave the
 * page open. Navigation visibility is never authorization.
 */
export async function requireAdminPageAccess(
  requestedPath: string
): Promise<AdminPageContext> {
  const actor = await getCachedActor();
  const access = resolveAdminPageAccess(actor, requestedPath);

  if (access.status === 'anonymous') {
    redirect(access.signInUrl);
  }

  if (access.status === 'forbidden') {
    notFound();
  }

  const session = await getCachedSession();

  // The session disappeared between the two reads; start sign-in again.
  if (!session) {
    redirect(buildAdminSignInUrl(requestedPath));
  }

  return {
    actor: access.actor,
    user: {
      name: session.userName || session.userEmail,
      email: session.userEmail,
    },
  };
}
