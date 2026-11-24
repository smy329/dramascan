import 'server-only';

import {
  assertSameOrigin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from '@/platform/Http';
import { recordPlaybackEventWorkflow } from '@/workflows/analytics/record-playback';

/**
 * The playback analytics endpoint (Prompts 141, 142).
 *
 * The player reports discrete events — play/pause, seek, completion, exit —
 * and the server turns them into bounded analytics rows. The endpoint is a
 * REST beacon with a keepalive `fetch`, because the last event has to survive
 * the viewer closing the page.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'analytics');

  try {
    // A playback event is a mutation of the analytics rows.
    assertSameOrigin(request);

    const result = await recordPlaybackEventWorkflow(await readJsonBody(request));

    return jsonResponse(
      { data: { recorded: result.recorded, duplicate: result.duplicate } },
      200,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger, 'analytics');
  }
}
