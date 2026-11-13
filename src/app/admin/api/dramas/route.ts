import 'server-only';

import { resolveActor } from '@/modules/authorization';
import { listDramas, createDrama, updateDrama, deleteDrama, parseListDramasQuery } from '@/workflows/admin/dramas';
import {
  authorizeDramaAdmin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
} from './_shared';

/**
 * Admin drama CRUD and listing API.
 *
 * Supports creation, listing with pagination and filters, updating, and soft-deletion
 * of dramas. Authorization is enforced server-side at this entrypoint and again inside
 * the workflow functions, regardless of what any client renders.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeDramaAdmin(actor);

    // Parse query parameters
    const url = new URL(request.url);
    const query: { page?: string; pageSize?: string; sort?: string; order?: string; status?: string; search?: string } = {};
    if (url.searchParams.has('page')) query.page = url.searchParams.get('page')!;
    if (url.searchParams.has('pageSize')) query.pageSize = url.searchParams.get('pageSize')!;
    if (url.searchParams.has('sort')) query.sort = url.searchParams.get('sort')!;
    if (url.searchParams.has('order')) query.order = url.searchParams.get('order')!;
    if (url.searchParams.has('status')) query.status = url.searchParams.get('status')!;
    if (url.searchParams.has('search')) query.search = url.searchParams.get('search')!;

    const parsedQuery = parseListDramasQuery(query);
    const result = await listDramas(actor, parsedQuery);

    return jsonResponse(
      {
        data: result.dramas,
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

export async function POST(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeDramaAdmin(actor);

    const body = await request.json();
    const result = await createDrama(actor, body);

    if (result.ok) {
      return jsonResponse(
        { ok: true, drama: result.drama },
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

export async function PUT(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeDramaAdmin(actor);

    const body = await request.json();
    const result = await updateDrama(actor, body.dramaId, body);

    if (result.ok) {
      return jsonResponse(
        { ok: true, drama: result.drama },
        200,
        requestId
      );
    }

    if (result.error && typeof result.error === 'object' && 'code' in result.error) {
      return jsonResponse(
        { ok: false, error: result.error },
        400,
        requestId
      );
    }

    return jsonResponse(
      { ok: false, error: { code: 'not_found', message: 'Drama not found.' } },
      404,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeDramaAdmin(actor);

    const { dramaId } = await request.json();
    const result = await deleteDrama(actor, dramaId);

    if (result.ok) {
      return jsonResponse({ ok: true }, 204, requestId);
    }

    if (result.error && typeof result.error === 'object' && 'code' in result.error) {
      return jsonResponse(
        { ok: false, error: result.error },
        404,
        requestId
      );
    }

    return jsonResponse(
      { ok: false, error: { code: 'internal', message: 'Failed to delete drama.' } },
      500,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}