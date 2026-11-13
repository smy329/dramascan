import 'server-only';

import { resolveActor } from '@/modules/authorization';
import { createSeason, updateSeason, listSeasons, deleteSeason } from '@/workflows/admin/seasons';
import {
  authorizeSeasonAdmin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
} from './_shared';

/**
 * Admin season CRUD API.
 *
 * Supports creation, listing, updating, and soft-deletion (moving to trash)
 * of seasons associated with a drama. Authorization is enforced server-side at this
 * entrypoint and again inside the workflow functions.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeSeasonAdmin(actor);

    const { dramaId } = await request.json();
    const result = await listSeasons(actor, dramaId);

    return jsonResponse(
      {
        data: result.seasons,
        meta: {
          total: result.total,
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
    authorizeSeasonAdmin(actor);

    const body = await request.json();
    const result = await createSeason(actor, body.dramaId, body);

    if (result.ok) {
      return jsonResponse(
        { ok: true, season: result.season },
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
    authorizeSeasonAdmin(actor);

    const body = await request.json();
    const result = await updateSeason(actor, body.seasonId, body);

    if (result.ok) {
      return jsonResponse(
        { ok: true, season: result.season },
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
      { ok: false, error: { code: 'not_found', message: 'Season not found.' } },
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
    authorizeSeasonAdmin(actor);

    const { seasonId } = await request.json();
    const result = await deleteSeason(actor, seasonId);

    if (result.ok) {
      return jsonResponse(
        { ok: true, affectedEpisodes: result.affectedEpisodes },
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
      { ok: false, error: { code: 'not_found', message: 'Season not found.' } },
      404,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}