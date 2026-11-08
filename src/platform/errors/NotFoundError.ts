import { AppError } from './index';

/**
 * Raised when a resource is missing or not visible to the actor.
 */
export class NotFoundError extends AppError {
  readonly code = 'not_found'

  /** @override */
  constructor(message: string = 'Not found.', cause?: unknown) {
    super('not_found', message, undefined, cause);
  }
}