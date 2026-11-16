import 'server-only';

import { z } from 'zod';

import { resolveActor } from '@/modules/authorization';
import { ValidationError } from '@/platform/errors';
import {
  addSimilarDrama,
  listSimilarDramas,
  parseListSimilarDramasQuery,
  removeSimilarDrama,
  updateSimilarDramaPosition,
} from '@/workflows/admin/similar-dramas';
import {
  assertSameOrigin,
  authorizeSimilarDramaAdmin,
  beginAdminRequest,
  emptyResponse,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from './_shared';

/**
 * Admin similar drama API.
 *
 * `GET` lists recommendations for `?dramaId=`. Mutations carry the parent id in
 * the body because the collection route has no dynamic segment. A missing
 * parent is always a 404; a valid parent with no recommendations is a 200 with
 * an empty collection.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const addBodySchema = z.strictObject({
  dramaId: z.uuid(),
  similarDramaId: z.uuid(),
  position: z.number().int().min(0).max(1_000_000).optional(),
});

const updateBodySchema = z.strictObject({
  dramaId: z.uuid(),
  similarDramaId: z.uuid(),
  position: z.number().int().min(0).max(1_000_000),
});

const deleteBodySchema = z.strictObject({
  dramaId: z.uuid(),
  similarDramaId: z.uuid(),
});

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};

    for (const issue of parsed.error.issues) {
      const field = issue.path.length > 0 ? String(issue.path[0]) : 'form';
      (fieldErrors[field] ??= []).push(issue.message);
    }

    throw new ValidationError('The request contains invalid fields.', fieldErrors);
  }

  return parsed.data;
}

/** GET /admin/api/similar-dramas?dramaId={id} - list recommendations */
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

    const query: Record<string, string> = {};
    for (const key of ['page', 'pageSize', 'sort', 'order', 'search'] as const) {
      const value = url.searchParams.get(key);
      if (value !== null) query[key] = value;
    }

    const result = await listSimilarDramas(actor, dramaId, parseListSimilarDramasQuery(query));

    return jsonResponse(
      {
        data: result.items,
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

/** POST /admin/api/similar-dramas - add a recommendation */
export async function POST(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeSimilarDramaAdmin(actor);
    assertSameOrigin(request);

    const body = parseBody(addBodySchema, await readJsonBody(request));
    const created = await addSimilarDrama(actor, body.dramaId, body.similarDramaId, body.position);

    return jsonResponse({ data: created }, 201, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}

/** PUT /admin/api/similar-dramas - set a recommendation's position */
export async function PUT(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeSimilarDramaAdmin(actor);
    assertSameOrigin(request);

    const body = parseBody(updateBodySchema, await readJsonBody(request));
    const updated = await updateSimilarDramaPosition(
      actor,
      body.dramaId,
      body.similarDramaId,
      body.position
    );

    return jsonResponse({ data: updated }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}

/** DELETE /admin/api/similar-dramas - remove a recommendation (204, no body) */
export async function DELETE(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeSimilarDramaAdmin(actor);
    assertSameOrigin(request);

    const body = parseBody(deleteBodySchema, await readJsonBody(request));
    await removeSimilarDrama(actor, body.dramaId, body.similarDramaId);

    return emptyResponse(requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}
