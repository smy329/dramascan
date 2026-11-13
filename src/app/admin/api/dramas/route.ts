import 'server-only';

import { resolveActor } from '@/modules/authorization';
import { listDramas, createDrama, updateDrama, deleteDrama } from '@/workflows/admin/dramas';
import {
  authorizeDramaAdmin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
} from './_shared';

/**
 * Admin drama CRUD API.
 *
 * Supports creation, listing, updating, and soft-deletion of dramas.
 * Authorization is enforced server-side at this entrypoint and again inside
 * the workflow functions, regardless of what any client renders.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeDramaAdmin(actor);

    const result = await listDramas(actor);

    return jsonResponse(
      {
        data: result.dramas,
        meta: {
          page: 1,
          pageSize: result.dramas.length,
          total: result.total,
          totalPages: result.total === 0 ? 0 : 1,
          hasNextPage: false,
          hasPreviousPage: false,
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