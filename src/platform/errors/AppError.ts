/**
 * Base application error class owned by `src/platform/errors`.
 *
 * All domain errors must extend this class (directly or indirectly).
 * The `code` is a stable snake_case string used for client response mapping.
 * The `message` is safe for end users — never expose SQL, credentials, stack traces,
 * or internal paths. The `cause` is preserved for logging only; it is never sent
 * to the client.
 *
 * Services throw typed errors. Entrypoints (Server Actions, REST handlers) map
 * them to HTTP responses or `ActionResult` once, using the `platform/http` mapping.
 */
export class AppError extends Error {
  /** @override */
  readonly code: string
  /** @override */
  readonly fieldErrors?: Record<string, string[]>
  /** @override */
  readonly cause?: unknown

  /** @override */
  constructor(code: string, message: string, fieldErrors?: Record<string, string[]>, cause?: unknown) {
    super(message)
    this.code = code
    this.message = message
    this.fieldErrors = fieldErrors
    this.cause = cause
    Object.setPrototypeOf(this, AppError.prototype)
  }
}

/**
 * Creates an AppError instance from a Zod validation error,
 * extracting field-level messages.
 */
export function makeValidationError(
  cause: unknown,
  fieldErrors: Record<string, string[]>
): AppError {
  return new AppError('validation_error', 'The request contains invalid fields.', fieldErrors, cause)
}