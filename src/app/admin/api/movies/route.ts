import 'server-only';

import { ValidationError } from '@/platform/errors';
import { resolveActor } from '@/modules/authorization';
import { createMovie, updateMovie } from '@/workflows/admin/movies';

import {
  assertSameOrigin,
  authorizeMovieAdmin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from './_shared';

/**
 * Admin standalone-movie API.
 *
 * Movies are an independent content type. This surface creates and edits a
 * movie's metadata, associations, publication state, and direct HTTPS video
 * source. Authorization is enforced server-side at this entrypoint and again
 * inside the workflow.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function requireObjectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object.');
  }

  return body as Record<string, unknown>;
}

export async function POST(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    assertSameOrigin(request);

    const actor = await resolveActor();
    authorizeMovieAdmin(actor);

    const movie = await createMovie(actor, await readJsonBody(request));

    return jsonResponse({ data: movie }, 201, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}

export async function PUT(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    assertSameOrigin(request);

    const actor = await resolveActor();
    authorizeMovieAdmin(actor);

    const body = requireObjectBody(await readJsonBody(request));
    const { movieId, ...payload } = body;

    if (typeof movieId !== 'string' || movieId.trim().length === 0) {
      throw new ValidationError('The movieId field is required.', {
        movieId: ['The movieId field is required.'],
      });
    }

    const movie = await updateMovie(actor, movieId, payload);

    return jsonResponse({ data: movie }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}
