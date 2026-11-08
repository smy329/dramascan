import { AppError } from './index';

/**
 * Raised when the client sends invalid or malformed input.
 */
export class ValidationError extends AppError {
  readonly code = 'validation_error'

  /** @override */
  constructor(message: string, fieldErrors?: Record<string, string[]>, cause?: unknown) {
    super('validation_error', message, fieldErrors, cause);
  }
}