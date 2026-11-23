import 'server-only';

import { resolveActor } from '@/modules/authorization';
import { parsePlaybackProgressInput } from '@/modules/users';
import {
  assertSameOrigin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from '@/platform/Http';
import { savePlaybackProgressWorkflow } from '@/workflows/playback/save-playback-progress';

/**
 * The playback heartbeat.
 *
 * The browser reports the viewer's position while the episode plays, and it
 * has to be able to do so while the page is being closed — which is why this
 * is a REST beacon with a keepalive `fetch` (`ARCHITECTURE.md` §9.2) and not a
 * Server Action.
 *
 * The route is a thin adapter: it reads the request, resolves the viewer,
 * validates the payload, calls one workflow, and maps the typed error to a
 * status code. The domain rules live in the modules and the workflow.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'playback');

  try {
    // A beacon is a mutation: a cross-site request must not be able to write
    // a viewer's position.
    assertSameOrigin(request);

    const actor = await resolveActor();
    const values = parsePlaybackProgressInput(await readJsonBody(request));

    const result = await savePlaybackProgressWorkflow(actor, values);

    return jsonResponse({ data: result }, 200, requestId);
  } catch (error) {
    return errorResponse(error, requestId, logger, 'playback');
  }
}
