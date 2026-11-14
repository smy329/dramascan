import 'server-only';

import { requirePermission, type ActorContext } from '@/modules/authorization';
import { AppError, AuthorizationError, InternalError } from '@/platform/errors';
import { mapErrorToRest } from '@/platform/Http';
import { createRequestLogger, generateRequestId } from '@/platform/logging';

/** Drama administration permission key. */
export const DRAMA_MANAGE_PERMISSION = 'drama.manage';

export type AdminRouteContext = {
  requestId: string;
  logger: ReturnType<typeof createRequestLogger>['logger'];
};

export function beginAdminRequest(request: Request): AdminRouteContext {
  const requestId = request.headers.get('x-request-id')?.trim() || generateRequestId();
  const { logger } = createRequestLogger({ requestId, module: 'dramas' });

  return { requestId, logger };
}

/**
 * Entrypoint authorization. Services re-check the same permission; this guard
 * ensures anonymous and under-privileged callers are rejected before any work.
 */
export function authorizeDramaAdmin(actor: ActorContext): ActorContext {
  return requirePermission(actor, DRAMA_MANAGE_PERMISSION);
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

export function readJsonBody(request: Request): Promise<unknown> {
  return request.json();
}

export function jsonResponse(
  body: unknown,
  status: number,
  requestId: string
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-Id': requestId,
    },
  });
}

export function errorResponse(
  error: unknown,
  requestId: string,
  logger: AdminRouteContext['logger']
): Response {
  let appError: AppError;

  if (error instanceof AppError) {
    appError = error;
  } else {
    logger.error({ err: error, event: 'dramas.request_failed' }, 'Admin route failed');
    appError = new InternalError('An unexpected error occurred.', error);
  }

  const mapped = mapErrorToRest(appError, requestId);

  return jsonResponse(mapped.body, mapped.status, requestId);
}
