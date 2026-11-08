import { AppError } from './index';

/**
 * Raised when there is no valid session or the user is not authenticated.
 */
export class AuthenticationError extends AppError {
  readonly code = 'authentication_required'

  /** @override */
  constructor(message: string = 'Authentication required.', cause?: unknown) {
    super('authentication_required', message, undefined, cause);
  }
}