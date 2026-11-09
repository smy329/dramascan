/**
 * HTTP error mapping and response helpers.
 *
 * Exports the mapping functions that adapt `AppError` subclasses to
 * REST responses and Server Action `ActionResult` shapes.
 */
export { mapErrorToRest, mapErrorToActionResult } from './map-error';
export type { AppError, InternalError, RateLimitError } from '@/platform/errors';
