import { resolveActor } from '@/modules/authorization';
import { updateInformationPage } from '@/modules/content';

import {
  assertSameOrigin,
  authorizeInformationPageAdmin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from '../_shared';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeInformationPageAdmin(actor);
    assertSameOrigin(request);

    const { id } = await context.params;
    const body = await readJsonBody(request);
    const page = await updateInformationPage(actor, id, body);

    return jsonResponse({ data: page }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}
