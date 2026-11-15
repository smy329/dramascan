import 'server-only';

import { resolveActor } from '@/modules/authorization';
import { listSimilarDramas, addSimilarDrama, removeSimilarDrama, updateSimilarDramaPosition, parseListSimilarDramasQuery } from '@/workflows/admin/similar-dramas';
import {
  authorizeSimilarDramaAdmin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
} from './_shared';

/**
 * Admin similar drama API.
 *
 * Supports listing, adding, removing, and updating position of similar dramas.
 * Authorization is enforced server-side at this entrypoint and again inside
 * the workflow functions, regardless of what any client renders.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** HTTP status per update error code. */
const UPDATE_ERROR_STATUS: Record<string, number> = {
  conflict: 409,
  not_found: 404,
};

/** GET /admin/api/similar-dramas - List similar dramas for a drama */
export async function GET(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeSimilarDramaAdmin(actor);

    // Parse query parameters
    const url = new URL(request.url);
    const query: { page?: string; pageSize?: string; sort?: string; order?: string; search?: string } = {};
    if (url.searchParams.has('page')) query.page = url.searchParams.get('page')!;
    if (url.searchParams.has('pageSize')) query.pageSize = url.searchParams.get('pageSize')!;
    if (url.searchParams.has('sort')) query.sort = url.searchParams.get('sort')!;
    if (url.searchParams.has('order')) query.order = url.searchParams.get('order')!;
    if (url.searchParams.has('search')) query.search = url.searchParams.get('search')!;

    // Get dramaId from path: /admin/api/similar-dramas?dramaId={id}
    const dramaId = url.searchParams.get('dramaId');

    if (!dramaId) {
      return jsonResponse(
        { ok: false, error: { code: 'validation_error', message: 'dramaId query parameter is required.' } },
        400,
        requestId
      );
    }

    const parsedQuery = parseListSimilarDramasQuery(query);
    const result = await listSimilarDramas(actor, dramaId, parsedQuery);

    return jsonResponse(
      {
        data: result.similar_dramas,
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

/** POST /admin/api/similar-dramas - Add a similar drama association */
export async function POST(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeSimilarDramaAdmin(actor);

    const body = await request.json();
    // Body contains: dramaId, similarDramaId
    const result = await addSimilarDrama(actor, body.dramaId, body.similarDramaId);

    if (result.ok) {
      return jsonResponse(
        { ok: true, similar_drama: result.similar_drama },
        201,
        requestId
      );
    }

    return jsonResponse(
      { ok: false, error: result.error },
      400,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}

/** DELETE /admin/api/similar-dramas - Remove a similar drama association */
export async function DELETE(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeSimilarDramaAdmin(actor);

    const body = await request.json();
    // Body contains: dramaId, similarDramaId
    const result = await removeSimilarDrama(actor, body.dramaId, body.similarDramaId);

    if (result.ok) {
      return jsonResponse({ ok: true }, 204, requestId);
    }

    return jsonResponse(
      { ok: false, error: result.error },
      404,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}

/** PUT /admin/api/similar-dramas - Update the position of a similar drama association */
export async function PUT(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeSimilarDramaAdmin(actor);

    const body = await request.json();
    // Body contains: dramaId, similarDramaId, position
    const result = await updateSimilarDramaPosition(actor, body.dramaId, body.similarDramaId, body.position);

    if (result.ok) {
      return jsonResponse(
        { ok: true, similar_drama: result.similar_drama },
        200,
        requestId
      );
    }

    if (result.error && typeof result.error === 'object' && 'code' in result.error) {
      const code = typeof result.error.code === 'string' ? result.error.code : '';
      const status = UPDATE_ERROR_STATUS[code] ?? 400;

      return jsonResponse(
        { ok: false, error: result.error },
        status,
        requestId
      );
    }

    return jsonResponse(
      { ok: false, error: { code: 'not_found', message: 'Similar drama association not found.' } },
      404,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}