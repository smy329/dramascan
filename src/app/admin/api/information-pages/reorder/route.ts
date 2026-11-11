import { resolveActor } from '@/modules/authorization';
import { reorderInformationPages } from '@/modules/content';

import {
  assertSameOrigin,
  authorizeInformationPageAdmin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from '../_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Set the footer display order transactionally from an ordered array of ids. */
export async function PUT(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeInformationPageAdmin(actor);
    assertSameOrigin(request);

    const body = await readJsonBody(request);
    const pages = await reorderInformationPages(actor, body);

    return jsonResponse({ data: pages }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}
