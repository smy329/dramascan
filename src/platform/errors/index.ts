/**
 * Error hierarchy module owned by `src/platform/errors`.
 *
 * Exports the `AppError` base class and all subclasses. Domain modules import
 * from this module rather than defining their own error types. This ensures a
 * single source of truth for error codes and HTTP mappings.
 *
 * Usage:
 *   import { ValidationError, NotFoundError } from '@/platform/errors';
 *   throw new ValidationError('Invalid input', { title: ['Title is required.'] });
 */
// Re-export all error classes from their individual modules.
export { AppError } from './AppError';
export { ValidationError } from './ValidationError';
export { AuthenticationError } from './AuthenticationError';
export { AuthorizationError } from './AuthorizationError';
export { NotFoundError } from './NotFoundError';
export { ConflictError } from './ConflictError';
export { RateLimitError } from './RateLimitError';
export { InternalError } from './InternalError';
export { makeValidationError } from './AppError';
