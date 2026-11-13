import 'server-only';

import { requirePermission, type ActorContext } from '@/modules/authorization';
import { AppError, AuthorizationError, InternalError, ValidationError } from '@/platform/errors';
import { mapErrorToRest } from '@/platform/Http';
import { createRequestLogger, generateRequestId } from '@/platform/logging';

/** Episode administration permission key. */
export const EPISODE_MANAGE_PERMISSION = 'episode.manage';

export type AdminRouteContext = {
  requestId: string;
  logger: ReturnType<typeof createRequestLogger>['logger'];
};

export function beginAdminRequest(request: Request): AdminRouteContext {
  const requestId = request.headers.get('x-request-id')?.trim() || generateRequestId();
  const { logger } = createRequestLogger({ requestId, module: 'episodes' });

  return { requestId, logger };
}

export function authorizeEpisodeAdmin(actor: ActorContext): ActorContext {
  return requirePermission(actor, EPISODE_MANAGE_PERMISSION);
}

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
  try {
    return request.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON.');
  }
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
    logger.error({ err: error, event: 'episodes.request_failed' }, 'Admin route failed');
    appError = new InternalError('An unexpected error occurred.', error);
  }

  const mapped = mapErrorToRest(appError, requestId);

  return jsonResponse(mapped.body, mapped.status, requestId);
}