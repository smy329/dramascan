import { AppError } from './index';

/**
 * Raised when an unexpected server failure occurs.
 */
export class InternalError extends AppError {
  override readonly code = 'internal_error'

  /** @override */
  constructor(message: string = 'Internal server error.', cause?: unknown) {
    super('internal_error', message, undefined, cause);
  }
}
