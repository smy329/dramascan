import { AppError } from './index';

/**
 * Raised when the client has exceeded a rate limit.
 */
export class RateLimitError extends AppError {
  override readonly code = 'rate_limited'
  readonly retryAfter?: number | Date

  /** @override */
  constructor(message: string = 'Rate limit exceeded.', retryAfter?: number | Date, cause?: unknown) {
    super('rate_limited', message, undefined, cause);
    this.retryAfter = retryAfter;
  }
}
