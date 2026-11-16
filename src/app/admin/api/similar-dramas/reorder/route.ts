import 'server-only';

import { z } from 'zod';

import { resolveActor } from '@/modules/authorization';
import { ValidationError } from '@/platform/errors';
import { reorderSimilarDramas } from '@/workflows/admin/similar-dramas';
import {
  assertSameOrigin,
  authorizeSimilarDramaAdmin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from '../_shared';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const reorderBodySchema = z.strictObject({
  dramaId: z.uuid(),
  orderedIds: z.array(z.uuid()).min(1).max(500),
});

/** PUT /admin/api/similar-dramas/reorder - replace the stored order atomically */
export async function PUT(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    const actor = await resolveActor();
    authorizeSimilarDramaAdmin(actor);
    assertSameOrigin(request);

    const parsed = reorderBodySchema.safeParse(await readJsonBody(request));

    if (!parsed.success) {
      throw new ValidationError('The reorder request is invalid.');
    }

    const ordered = await reorderSimilarDramas(actor, parsed.data.dramaId, parsed.data.orderedIds);

    return jsonResponse({ data: ordered }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}
