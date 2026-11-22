import 'server-only';

import { resolveActor } from '@/modules/authorization';
import { suggestSimilarDramas } from '@/workflows/admin/similar-dramas';
import {
  authorizeSimilarDramaAdmin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
} from '../_shared';

/**
 * GET /admin/api/similar-dramas/suggestions?dramaId={id}
 *
 * Returns the scored automatic recommendations for one drama. The list is a
 * suggestion only: nothing is persisted until the administrator adds a row.
 */
export async function GET(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeSimilarDramaAdmin(actor);

    const url = new URL(request.url);
    const dramaId = url.searchParams.get('dramaId');

    if (!dramaId) {
      return jsonResponse(
        {
          ok: false,
          error: { code: 'validation_error', message: 'dramaId query parameter is required.' },
        },
        400,
        requestId
      );
    }

    const suggestions = await suggestSimilarDramas(actor, dramaId);

    return jsonResponse({ data: suggestions }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}
