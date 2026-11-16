import 'server-only';

import { resolveActor } from '@/modules/authorization';
import { searchSimilarDramaCandidates } from '@/workflows/admin/similar-dramas';
import {
  authorizeSimilarDramaAdmin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
} from '../_shared';

/** GET /admin/api/similar-dramas/candidates?dramaId={id}&search={term} */
export async function GET(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeSimilarDramaAdmin(actor);

    const url = new URL(request.url);
    const dramaId = url.searchParams.get('dramaId');
    const search = url.searchParams.get('search')?.trim() ?? '';

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

    if (search.length === 0) {
      return jsonResponse({ data: [] }, 200, requestId);
    }

    const candidates = await searchSimilarDramaCandidates(actor, dramaId, search);

    return jsonResponse({ data: candidates }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}
