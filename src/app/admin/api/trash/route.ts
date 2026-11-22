import 'server-only';

import { resolveActor } from '@/modules/authorization';
import { listTrashItems, parseTrashListQuery } from '@/workflows/admin/trash';
import {
  assertSameOrigin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
} from '@/platform/Http/admin-route';

export const dynamic = 'force-dynamic';

/**
 * GET /admin/api/trash?type=all&page=1&pageSize=20&search=
 *
 * Lists the trashed content the actor may manage. The route is a thin
 * adapter: the query is parsed, the actor is resolved server-side, and the
 * workflow owns every visibility and ordering rule.
 */
export async function GET(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'trash');

  try {
    assertSameOrigin(request);

    const actor = await resolveActor();
    const url = new URL(request.url);
    const query = parseTrashListQuery({
      type: url.searchParams.get('type') ?? 'all',
      page: url.searchParams.get('page') ?? 1,
      pageSize: url.searchParams.get('pageSize') ?? 20,
      search: url.searchParams.get('search') ?? '',
    });

    const result = await listTrashItems(actor, query);

    // `data` carries the collection, `meta` carries the pagination. The
    // collection is never repeated inside `meta`.
    return jsonResponse(
      {
        data: result.items,
        meta: {
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
          totalPages: result.totalPages,
          hasNextPage: result.hasNextPage,
          hasPreviousPage: result.hasPreviousPage,
          retentionDays: result.retentionDays,
        },
      },
      200,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger, 'trash');
  }
}
