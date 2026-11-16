import 'server-only';

import { listPublicDramas } from '@/modules/content';
import { AppError, InternalError } from '@/platform/errors';
import { mapErrorToRest } from '@/platform/Http';
import { createRequestLogger, generateRequestId } from '@/platform/logging';

/**
 * Anonymous public drama catalogue API.
 *
 * The response is the approved `{ data, meta }` envelope with an explicit
 * camelCase DTO. Visibility is decided by the content module's public query
 * service; caller-supplied `publication_status`, `visibility`, or unknown
 * parameters are discarded and cannot widen the result.
 *
 * Only `page` and `pageSize` are read from the query string; both are validated
 * and bounded by `parsePublicDramaListQuery`.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const requestId = request.headers.get('x-request-id')?.trim() || generateRequestId();
  const { logger } = createRequestLogger({ requestId, module: 'public-dramas' });

  try {
    const { searchParams } = new URL(request.url);

    const result = await listPublicDramas({
      page: searchParams.get('page') ?? undefined,
      pageSize: searchParams.get('pageSize') ?? undefined,
    });

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
    let appError: AppError;

    if (error instanceof AppError) {
      appError = error;
    } else {
      logger.error({ err: error, event: 'public-dramas.request_failed' }, 'Public route failed');
      appError = new InternalError('An unexpected error occurred.', error);
    }

    const mapped = mapErrorToRest(appError, requestId);

    return jsonResponse(mapped.body, mapped.status, requestId);
  }
}
