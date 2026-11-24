import 'server-only';

import {
  assertSameOrigin,
  beginAdminRequest,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from '@/platform/Http';
import { recordContentViewWorkflow } from '@/workflows/analytics/record-view';

/**
 * The view-tracking endpoint (Prompt 140).
 *
 * The details page tells the server that a visitor opened a title. The server
 * decides whether that counts: the visitor is resolved from the session and
 * the cookie, the title is checked against the public availability rules, and
 * the six-hour window decides whether the view is new.
 *
 * The endpoint is a Route Handler because it is the only place that may write
 * the anonymous session cookie.
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request): Promise<Response> {
  const { requestId, logger } = beginAdminRequest(request, 'analytics');

  try {
    // A view report is a mutation of the analytics rows: a cross-site request
    // must not be able to count views for another site.
    assertSameOrigin(request);

    const result = await recordContentViewWorkflow(await readJsonBody(request));

    return jsonResponse(
      { data: { counted: result.counted, alreadyCounted: result.alreadyCounted } },
      200,
      requestId
    );
  } catch (error) {
    return errorResponse(error, requestId, logger, 'analytics');
  }
}
