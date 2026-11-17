import { AppError, AuthorizationError, InternalError, ValidationError } from '@/platform/errors';
import { createRequestLogger, generateRequestId } from '@/platform/logging';

import { mapErrorToRest } from './map-error';

/**
 * Shared HTTP adaptation for the administration API routes.
 *
 * The routes are thin adapters: they parse the request, resolve the actor,
 * call one workflow, and map the result or the typed error to a response. All
 * domain rules live in the modules and workflows.
 *
 * The response envelope is `{ data, meta }` for a successful read and
 * `{ data }` for a successful write; an error is `{ error: { code, message,
 * requestId } }`. Every response carries the `X-Request-Id` header.
 */

export type AdminRouteContext = {
  requestId: string;
  logger: ReturnType<typeof createRequestLogger>['logger'];
};

/** Request id and structured logger for one admin route request. */
export function beginAdminRequest(request: Request, module: string): AdminRouteContext {
  const requestId = request.headers.get('x-request-id')?.trim() || generateRequestId();
  const { logger } = createRequestLogger({ requestId, module });

  return { requestId, logger };
}

/**
 * Reject cross-site mutations. Same-origin browser requests include `Origin`
 * and/or `Sec-Fetch-Site`; non-browser clients that omit both are allowed.
 */
export function assertSameOrigin(request: Request): void {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new AuthorizationError('Cross-origin request rejected.');
  }

  const origin = request.headers.get('origin');
  if (!origin) {
    return;
  }

  if (origin !== new URL(request.url).origin) {
    throw new AuthorizationError('Cross-origin request rejected.');
  }
}

/**
 * Read and parse a JSON request body.
 *
 * A malformed body is a client error, not a server failure: the JSON parse
 * error is mapped to a validation error so the route answers 400 instead of
 * 500.
 */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ValidationError('The request body must be valid JSON.');
    }

    throw error;
  }
}

/** JSON response with the request id header. */
export function jsonResponse(body: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-Id': requestId,
    },
  });
}

/**
 * A 204 response must not carry a body or a JSON content type. Returning
 * `{ ok: true }` with status 204 is invalid and is silently dropped by fetch.
 */
export function emptyResponse(requestId: string): Response {
  return new Response(null, {
    status: 204,
    headers: { 'X-Request-Id': requestId },
  });
}

/** Map a thrown error to a safe JSON error response. */
export function errorResponse(
  error: unknown,
  requestId: string,
  logger: AdminRouteContext['logger'],
  module: string
): Response {
  let appError: AppError;

  if (error instanceof AppError) {
    appError = error;
  } else {
    logger.error({ err: error, event: `${module}.request_failed` }, 'Admin route failed');
    appError = new InternalError('An unexpected error occurred.', error);
  }

  const mapped = mapErrorToRest(appError, requestId);

  return jsonResponse(mapped.body, mapped.status, requestId);
}
