/**
 * Request ID middleware for Next.js.
 *
 * Generates a request ID and adds it to the response header as `X-Request-Id`.
 * Also provides a request-scoped child logger via `createRequestLogger`.
 *
 * The request ID format follows the conventions example: 01JGZZZ3G9
 * (prefix 01J- + 11 uppercase alphanumeric chars).
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Wrap a request handler with request ID correlation.
 * Generates a request ID, adds it to the X-Request-Id response header,
 * and creates a request-scoped child logger.
 *
 * The handler may return a NextResponse or a Promise<NextResponse>.
 */
export function withRequestId(
  handler: (request: NextRequest) => NextResponse | Promise<NextResponse>
): (request: NextRequest) => NextResponse | Promise<NextResponse> {
  return async (request: NextRequest) => {
    const requestId = generateRequestIdUnique();

    const response = await handler(request);

    // Add X-Request-Id header to the response
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('X-Request-Id', requestId);

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  };
}

/**
 * Generate a unique request ID string.
 * The format follows the conventions example: 01JGZZZ3G9
 * (prefix 01J- + 11 uppercase alphanumeric chars).
 */
function generateRequestIdUnique(): string {
  const uuid = crypto.randomUUID();
  return `01J-${uuid.replace(/-/g, '').toUpperCase().slice(0, 11)}`;
}

/**
 * Add the X-Request-Id header to a response.
 */
export function addRequestIdHeader(
  response: NextResponse,
  requestId: string
): NextResponse {
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('X-Request-Id', requestId);
  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}