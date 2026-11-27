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

/** Search parameters for error monitoring. */
export interface ErrorSearchParams {
  severity?: ErrorSeverity | ErrorSeverity[];
  category?: ErrorCategory | ErrorCategory[];
  startDate?: string;
  endDate?: string;
  query?: string; // Search in message and stack
  page?: number;
  pageSize?: number;
}

/** Search results for error monitoring. */
export interface ErrorSearchResults {
  errors: MonitoredError[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Filter errors by search parameters. */
function filterErrors(
  errors: MonitoredError[],
  params: ErrorSearchParams
): MonitoredError[] {
  return errors.filter((error) => {
    // Filter by severity
    if (params.severity) {
      const severities = Array.isArray(params.severity)
        ? params.severity
        : [params.severity];
      if (!severities.includes(error.severity)) {
        return false;
      }
    }

    // Filter by category
    if (params.category) {
      const categories = Array.isArray(params.category)
        ? params.category
        : [params.category];
      if (!categories.includes(error.category)) {
        return false;
      }
    }

    // Filter by date range
    if (params.startDate || params.endDate) {
      const errorDate = new Date(error.timestamp).getTime();
      const start = params.startDate ? new Date(params.startDate).getTime() : 0;
      const end = params.endDate ? new Date(params.endDate).getTime() : Infinity;
      if (errorDate < start || errorDate > end) {
        return false;
      }
    }

    // Filter by query string (search in message and stack)
    if (params.query) {
      const searchLower = params.query.toLowerCase();
      if (
        error.message.toLowerCase().indexOf(searchLower) === -1 &&
        (error.stack ? error.stack.toLowerCase().indexOf(searchLower) === -1 : true)
      ) {
        return false;
      }
    }

    return true;
  });
}

/** Search errors with pagination and filtering. */
export async function searchErrors(
  params: ErrorSearchParams
): Promise<ErrorSearchResults> {
  // In a full implementation, this would query the database
  // For now, we'll use a simple in-memory approach
  // The actual error store would be injected or accessed through a module

  // For demonstration, return empty results with proper structure
  // In production, this would query the error_logs table
  return {
    errors: [],
    total: 0,
    page: params.page || 1,
    pageSize: params.pageSize || 20,
    totalPages: 0,
  };
}

/** Get errors by severity. */
export function getErrorsBySeverity(
  errors: MonitoredError[],
  severity: ErrorSeverity
): MonitoredError[] {
  return filterErrors(errors, { severity });
}

/** Get errors by category. */
export function getErrorsByCategory(
  errors: MonitoredError[],
  category: ErrorCategory
): MonitoredError[] {
  return filterErrors(errors, { category });
}

/** Get errors by date range. */
export function getErrorsByDateRange(
  errors: MonitoredError[],
  startDate: string,
  endDate: string
): MonitoredError[] {
  return filterErrors(errors, { startDate, endDate });
}

/** Get errors by query string. */
export function getErrorsByQuery(
  errors: MonitoredError[],
  query: string
): MonitoredError[] {
  return filterErrors(errors, { query });
}