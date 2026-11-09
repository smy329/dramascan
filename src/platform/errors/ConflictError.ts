import { AppError } from './index';

/**
 * Raised when there is a state conflict, duplicate, or invariant violation.
 */
export class ConflictError extends AppError {
  override readonly code = 'conflict'

  /** @override */
  constructor(message: string = 'Conflict.', cause?: unknown) {
    super('conflict', message, undefined, cause);
  }
}
