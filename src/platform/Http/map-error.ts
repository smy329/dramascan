/**
 * Maps application errors to HTTP responses and Server Action results.
 *
 * This module is the single place where error-to-HTTP and error-to-ActionResult
 * semantics are defined. Services throw typed errors; entrypoints (REST handlers,
 * Server Actions) call this module to adapt the error to the appropriate transport.
 *
 * Rules:
 * - Services never import from this module. Services throw; entrypoints map.
 * - Unknown errors (not instances of known subclasses) are wrapped as `InternalError`.
 * - The `cause` is logged but never included in client-facing responses.
 * - `requestId` is injected by the entrypoint/middleware, not by this module.
 */
import {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalError,
} from '@/platform/errors';

/**
 * Maps an AppError to a REST HTTP response body and status code.
 *
 * The `requestId` must be provided by the caller (middleware or entrypoint);
 * it is included in the JSON body and the `X-Request-Id` header.
 */
export function mapErrorToRest(
  error: AppError,
  requestId: string
): { status: number; body: unknown } {
  if (error instanceof ValidationError) {
    return {
      status: 400,
      body: {
        error: {
          code: error.code,
          message: error.message,
          fieldErrors: error.fieldErrors,
          requestId,
        },
      },
    };
  }

  if (error instanceof AuthenticationError) {
    return {
      status: 401,
      body: {
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      },
    };
  }

  if (error instanceof AuthorizationError) {
    return {
      status: 403,
      body: {
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      },
    };
  }

  if (error instanceof NotFoundError) {
    return {
      status: 404,
      body: {
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      },
    };
  }

  if (error instanceof ConflictError) {
    return {
      status: 409,
      body: {
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      },
    };
  }

  if (error instanceof RateLimitError) {
    const retryAfter = error.retryAfter
      ? typeof error.retryAfter === 'number'
        ? error.retryAfter
        : Math.floor(error.retryAfter.getTime() / 1000)
      : undefined;

    return {
      status: 429,
      body: {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          retryAfter,
        },
      },
    };
  }

  // Unknown errors: wrap as InternalError, preserving the original cause for logs.
  const internal = new InternalError(
    'An unexpected error occurred.',
    error instanceof Error ? error : undefined
  );
  return {
    status: 500,
    body: {
      error: {
        code: internal.code,
        message: internal.message,
        requestId,
      },
    },
  };
}

/**
 * Maps an AppError to a Server Action `ActionResult`.
 *
 * Server Actions must return `{ ok: true; data } | { ok: false; error }` and must
 * not throw across the boundary. This function adapts any `AppError` to that shape.
 *
 * The `requestId` is optional in Server Actions (unlike REST where it's required
 * in the header), but may be included if available.
 *
 * The returned error shape includes `retryAfter` when the source error is a
 * `RateLimitError`, otherwise it follows the standard `ActionError` shape.
 */
export function mapErrorToActionResult(
  error: AppError,
  requestId?: string
): {
  ok: false;
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[]> | undefined;
    requestId?: string | undefined;
    retryAfter?: number | Date | undefined;
  };
} {
  if (error instanceof ValidationError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        fieldErrors: error.fieldErrors,
        requestId,
      },
    };
  }

  if (error instanceof AuthenticationError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        requestId,
      },
    };
  }

  if (error instanceof AuthorizationError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        requestId,
      },
    };
  }

  if (error instanceof NotFoundError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        requestId,
      },
    };
  }

  if (error instanceof ConflictError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        requestId,
      },
    };
  }

  if (error instanceof RateLimitError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        retryAfter: error.retryAfter,
        requestId,
      },
    };
  }

  // Unknown errors: wrap as InternalError.
  const internal = new InternalError(
    'An unexpected error occurred.',
    error instanceof Error ? error : undefined
  );
  return {
    ok: false,
    error: {
      code: internal.code,
      message: internal.message,
      requestId,
    },
  };
}

/** Wrapper for entrypoints that catches any thrown error and maps it to a safe
 * response, ensuring no raw `Error` objects or stack traces ever reach the client.
 *
 * REST route handlers: use `mapErrorToRest` and set the HTTP status body/json.
 * Server Actions: use `mapErrorToActionResult` and return the result directly.
 *
 * Example REST handler pattern:
 *   try {
 *     const result = await service(...);
 *     return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
 *   } catch (error) {
 *     const mapped = mapErrorToRest(error as AppError, requestId);
 *     return new Response(JSON.stringify(mapped.body), { status: mapped.status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId } });
 *   }
 *
 * Example Server Action pattern:
 *   try {
 *     const result = await service(...);
 *     return { ok: true, data: result };
 *   } catch (error) {
 *     return mapErrorToActionResult(error as AppError, requestId);
 *   }
 */
export type { AppError, InternalError, RateLimitError };
