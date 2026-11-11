import { resolveActor } from '@/modules/authorization';
import { listInformationPages, parseListInformationPagesQuery } from '@/modules/content';

import {
  authorizeInformationPageAdmin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
} from './_shared';

/**
 * Admin footer/information-page API.
 *
 * This is the persistent control surface for the public footer. It is ready for
 * the future admin settings UI; no admin UI is introduced by this prompt.
 *
 * Authorization is enforced server-side at this entrypoint and again inside the
 * content service, regardless of what any client renders.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeInformationPageAdmin(actor);

    const query = parseListInformationPagesQuery(
      Object.fromEntries(new URL(request.url).searchParams)
    );
    const result = await listInformationPages(actor, query);

    return jsonResponse(
      {
        data: result.pages,
        meta: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalPages: result.totalPages,
          hasNextPage: result.hasNextPage,
          hasPreviousPage: result.hasPreviousPage,
        },
      },
      200,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}
