import 'server-only';

import { resolveActor } from '@/modules/authorization';
import { trashRestoreRequestSchema } from '@/lib/contracts/trash';
import { ValidationError } from '@/platform/errors';
import { restoreTrashItem } from '@/workflows/admin/restore';
import {
  assertSameOrigin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from '@/platform/Http/admin-route';

export const dynamic = 'force-dynamic';

/**
 * POST /admin/api/trash/restore
 *
 * Restores one trashed item. The workflow re-checks the permission for the
 * content type and restores the hierarchy that was trashed with the item.
 */
export async function POST(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'trash');

  try {
    assertSameOrigin(request);

    const actor = await resolveActor();
    const parsed = trashRestoreRequestSchema.safeParse(await readJsonBody(request));

    if (!parsed.success) {
      throw new ValidationError('The restore request is invalid.');
    }

    const result = await restoreTrashItem(actor, parsed.data.contentType, parsed.data.id);

    return jsonResponse({ data: result }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger, 'trash');
  }
}
