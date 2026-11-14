import 'server-only';

import { resolveActor } from '@/modules/authorization';
import { createEpisode, updateEpisode, listEpisodes, replaceEpisodeVideoSource, deleteEpisode, renumberEpisodes, reorderEpisodes, moveEpisodesToSeason } from '@/workflows/admin/episodes';
import {
  authorizeEpisodeAdmin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
} from './_shared';

/**
 * Admin episode CRUD and management API.
 *
 * Supports creation, listing (with pagination, sorting, search), updating,
 * video source replacement (Phase 6), soft-deletion, renumbering, reordering,
 * and moving episodes between seasons. Authorization is enforced server-side
 * at this entrypoint and again inside the workflow functions.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeEpisodeAdmin(actor);

    const { dramaId } = await request.json();
    const result = await listEpisodes(actor, dramaId, {});

    return jsonResponse(
      {
        data: result.episodes,
        meta: {
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          totalPages: result.totalPages,
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
    authorizeEpisodeAdmin(actor);

    const body = await request.json();
    const result = await createEpisode(actor, body.dramaId, body);

    if (result.ok) {
      return jsonResponse(
        { ok: true, episode: result.episode },
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
    authorizeEpisodeAdmin(actor);

    const body = await request.json();
    const result = await updateEpisode(actor, body.episodeId, body);

    if (result.ok) {
      return jsonResponse(
        { ok: true, episode: result.episode },
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
      { ok: false, error: { code: 'not_found', message: 'Episode not found.' } },
      404,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeEpisodeAdmin(actor);

    const { episodeId, videoSource } = await request.json();
    const result = await replaceEpisodeVideoSource(actor, episodeId, videoSource);

    if (result.ok) {
      return jsonResponse(
        { ok: true, episode: result.episode },
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
      { ok: false, error: { code: 'not_found', message: 'Episode not found.' } },
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
    authorizeEpisodeAdmin(actor);

    const { episodeId } = await request.json();
    const result = await deleteEpisode(actor, episodeId);

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
      { ok: false, error: { code: 'internal', message: 'Failed to delete episode.' } },
      500,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}

export async function PUT_renumber(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeEpisodeAdmin(actor);

    const { dramaId, seasonId } = await request.json();
    const result = await renumberEpisodes(actor, dramaId, seasonId);

    if (result.ok) {
      return jsonResponse(
        { ok: true, episodesModified: result.episodesModified },
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
      { ok: false, error: { code: 'not_found', message: 'Drama or season not found.' } },
      404,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}

export async function PUT_reorder(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeEpisodeAdmin(actor);

    const { dramaId, episodeIds } = await request.json();
    const result = await reorderEpisodes(actor, dramaId, episodeIds);

    if (result.ok) {
      return jsonResponse(
        { ok: true, episodesReordered: result.episodesReordered },
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
      { ok: false, error: { code: 'not_found', message: 'Drama or episodes not found.' } },
      404,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}

export async function POST_move(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeEpisodeAdmin(actor);

    const { dramaId, episodeIds, targetSeasonId } = await request.json();
    const result = await moveEpisodesToSeason(actor, dramaId, episodeIds, targetSeasonId);

    if (result.ok) {
      return jsonResponse(
        { ok: true, episodesMoved: result.episodesMoved },
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
      { ok: false, error: { code: 'not_found', message: 'Drama, season, or episodes not found.' } },
      404,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}
