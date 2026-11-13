import 'server-only';

import { resolveActor } from '@/modules/authorization';
import { createEpisode, updateEpisode, replaceEpisodeVideoSource, listEpisodes, deleteEpisode } from '@/workflows/admin/episodes';
import {
  authorizeEpisodeAdmin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
} from './_shared';

/** Admin episode CRUD API.
 * Supports creation, listing, updating, video source replacement, and soft-deletion of episodes
 * associated with a drama and optional season. Authorization is enforced server-side at this
 * entrypoint and again inside the workflow functions.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeEpisodeAdmin(actor);

    const { dramaId } = await request.json();
    const result = await listEpisodes(actor, dramaId);

    return jsonResponse(
      {
        data: result.episodes,
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