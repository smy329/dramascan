/**
 * HTTP error mapping and response helpers.
 *
 * Exports the mapping functions that adapt `AppError` subclasses to
 * REST responses and Server Action `ActionResult` shapes.
 */
export { mapErrorToRest, mapErrorToActionResult } from './map-error';
export {
  assertSameOrigin,
  beginAdminRequest,
  emptyResponse,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from './admin-route';
export type { AdminRouteContext } from './admin-route';
export type { AppError, InternalError, RateLimitError } from '@/platform/errors';
