import { AppError } from './index';

/**
 * Raised when the actor is authenticated but not permitted to perform the requested
 * action on the target resource.
 */
export class AuthorizationError extends AppError {
  readonly code = 'forbidden'

  /** @override */
  constructor(message: string = 'Forbidden.', cause?: unknown) {
    super('forbidden', message, undefined, cause);
  }
}