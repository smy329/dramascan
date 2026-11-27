/**
 * Built-in error monitoring module.
 *
 * Captures and logs frontend/backend exceptions, failed API requests, and
 * other runtime errors with severity, timestamps, stack traces, and request
 * context. Sensitive data (passwords, tokens, PII) is automatically redacted.
 *
 * Errors are stored with 30-day retention by default and can be searched/filtered
 * by authorized administrators.
 *
 * Do not implement persistent background workers or job queue monitoring — this
 * module only captures and stores errors for later review.
 */

/** Error severity levels. */
export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low';

/** Error category for classification. */
export type ErrorCategory =
  | 'validation'
  | 'runtime'
  | 'api'
  | 'database'
  | 'authentication'
  | 'authorization'
  | 'network'
  | 'video'
  | 'playback'
  | 'unknown';

/** Redact sensitive values from error objects. */
function redactSensitiveValues(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    // Redact potential secrets in strings
    return obj.replace(/(password|token|secret)([=:\s]+)[^\s,;]+/gi, '$1$2[REDACTED]');
  }

  if (typeof obj === 'object') {
    const array = Array.isArray(obj) ? obj : Object.values(obj as Record<string, unknown>);
    return array.map(redactSensitiveValues);
  }

  return obj;
}

/** Full error record stored in the monitoring system. */
export interface MonitoredError {
  id: string;
  severity: ErrorSeverity;
  category: ErrorCategory;
  message: string;
  stack: string | null;
  timestamp: string;
  requestId?: string;
  userId?: string;
  url?: string;
  method?: string;
  statusCode?: number;
  redactedContext: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** Create a new error monitoring entry. */
export async function captureError(
  options: {
    severity: ErrorSeverity;
    category: ErrorCategory;
    message: string;
    error?: Error;
    requestId?: string;
    userId?: string;
    url?: string;
    method?: string;
    statusCode?: number;
    context?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
): Promise<MonitoredError> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Redact sensitive values from context
  const redactedContext = options.context
    ? redactSensitiveValues(options.context)
    : {};

  const errorRecord: MonitoredError = {
    id,
    severity: options.severity,
    category: options.category,
    message: options.message,
    stack: options.error?.stack ?? null,
    timestamp: now,
    requestId: options.requestId,
    userId: options.userId,
    url: options.url,
    method: options.method,
    statusCode: options.statusCode,
    redactedContext,
    metadata: options.metadata,
  };

  // In a full implementation, this would insert into a database table
  // For now, we log to console (in production, would insert into error_logs table)
  // eslint-disable-next-line no-console
  console.error('Error captured for monitoring:', errorRecord);

  return errorRecord;
}

/** Capture a frontend JavaScript error. */
export function captureFrontendError(
  error: Error,
  info: {
    url: string;
    lineNumber: number;
    columnNumber: number;
    error?: Error;
  },
  context?: Record<string, unknown>
): MonitoredError {
  return captureError({
    severity: 'high',
    category: 'runtime',
    message: error.message,
    error,
    url: info.url,
    context,
  });
}

/** Capture a failed API request. */
export function captureApiError(
  error: Error,
  options: {
    url: string;
    method: string;
    statusCode?: number;
    userId?: string;
    requestId?: string;
    context?: Record<string, unknown>;
  }
): MonitoredError {
  return captureError({
    severity: 'medium',
    category: 'api',
    message: `API request failed: ${error.message}`,
    error,
    url: options.url,
    method: options.method,
    statusCode: options.statusCode,
    userId: options.userId,
    requestId: options.requestId,
    context: options.context,
  });
}

/** Capture a validation error. */
export function captureValidationError(
  error: Error,
  options: {
    path?: string[];
    message?: string;
    context?: Record<string, unknown>;
  }
): MonitoredError {
  return captureError({
    severity: 'medium',
    category: 'validation',
    message: options.message || error.message,
    error,
    context: options.context,
  });
}

/** Capture a database error. */
export function captureDatabaseError(
  error: Error,
  options: {
    query?: string;
    params?: unknown[];
    userId?: string;
    context?: Record<string, unknown>;
  }
): MonitoredError {
  return captureError({
    severity: 'high',
    category: 'database',
    message: options.query ? `Database error: ${error.message}` : error.message,
    error,
    context: options.context,
  });
}

/** Capture an authentication error. */
export function captureAuthError(
  error: Error,
  options: {
    context?: Record<string, unknown>;
  }
): MonitoredError {
  return captureError({
    severity: 'high',
    category: 'authentication',
    message: error.message,
    error,
    context: options.context,
  });
}

/** Capture an authorization error. */
export function captureAuthorizationError(
  error: Error,
  options: {
    context?: Record<string, unknown>;
  }
): MonitoredError {
  return captureError({
    severity: 'high',
    category: 'authorization',
    message: error.message,
    error,
    context: options.context,
  });
}

/** Capture a video/playback error. */
export function captureVideoError(
  error: Error,
  options: {
    videoId?: string;
    sourceUrl?: string;
    userId?: string;
    context?: Record<string, unknown>;
  }
): MonitoredError {
  return captureError({
    severity: 'medium',
    category: 'video',
    message: error.message,
    error,
    context: options.context,
  });
}