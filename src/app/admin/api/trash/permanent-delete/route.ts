import 'server-only';

import { resolveActor } from '@/modules/authorization';
import {
  parsePermanentDeleteBulkRequest,
  parsePermanentDeleteRequest,
  permanentDelete,
  permanentDeleteBulk,
  previewPermanentDelete,
} from '@/workflows/admin/permanent-delete';
import {
  assertSameOrigin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from '@/platform/Http/admin-route';

export const dynamic = 'force-dynamic';

/**
 * POST /admin/api/trash/permanent-delete
 *
 * Permanently deletes trashed content. Super Admin only.
 *
 * The body is either a single request (`{ contentType, id }`) or a bulk
 * request (`{ items: [{ contentType, id }] }`). The single form first reports
 * the impact so the administrator can confirm it; the bulk form deletes every
 * item in its own transaction and reports each result separately.
 */
export async function POST(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'trash');

  try {
    assertSameOrigin(request);

    const actor = await resolveActor();
    const body = (await readJsonBody(request)) as Record<string, unknown>;

    if (body && Array.isArray(body.items)) {
      const requests = parsePermanentDeleteBulkRequest(body.items);
      const result = await permanentDeleteBulk(actor, requests);

      return jsonResponse({ data: result }, 200, requestId);
    }

    const parsed = parsePermanentDeleteRequest(body);

    if (body.preview === true) {
      const impact = await previewPermanentDelete(actor, parsed.contentType, parsed.id);

      return jsonResponse({ data: impact }, 200, requestId);
    }

    const impact = await permanentDelete(actor, parsed.contentType, parsed.id);

    return jsonResponse({ data: impact }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger, 'trash');
  }
}
