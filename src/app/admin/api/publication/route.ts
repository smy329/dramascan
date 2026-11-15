import 'server-only';

import { resolveActor } from '@/modules/authorization';
import { parsePublicationRequest } from '@/modules/content/validation';
import { publishContent, unpublishContent } from '@/workflows/admin/publication';
import {
  assertSameOrigin,
  authorizePublication,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from './_shared';

/**
 * Admin content publication API.
 *
 * Manual publish/unpublish for dramas, seasons, episodes, and standalone
 * movies. The route is a thin adapter: same-origin guard, actor resolution,
 * body parsing, and per-content-type authorization; all publication logic and
 * validation live in the workflow layer.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request);

  try {
    assertSameOrigin(request);

    const actor = await resolveActor();
    const body = await readJsonBody(request);
    const parsed = parsePublicationRequest(body);
    const authorizedActor = authorizePublication(actor, parsed.contentType);

    const result = parsed.action === 'publish' ? await publishContent(authorizedActor, parsed) : await unpublishContent(authorizedActor, parsed);

    return jsonResponse({ data: result }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger);
  }
}
