import pino from 'pino';

/**
 * Pino logger configuration.
 *
 * - Structured JSON output, one line per event.
 * - Required fields per the conventions: `time`, `level`, `msg`, `requestId`, `module`, and either `event` or `action`.
 * - Redaction of sensitive fields is handled by Pino's redaction.
 * - Log level is derived from the LOG_LEVEL environment variable,
 *   falling back to `info` in production and `debug` in development.
 */
const pinoOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  // Ensure JSON output (default for pino), suitable for journald/ELK/etc.
  // One line per event.
  // Redact sensitive data from logs
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'password',
    'token',
    'secret',
    'apiKey',
    'clientSecret',
    'set-cookie',
  ],
};

// Create the logger instance
const logger = pino(pinoOptions);

/**
 * Generate a short request ID (compatible with the conventions example format: 01JGZZZ3G9).
 */
function generateRequestId(): string {
  const uuid = crypto.randomUUID();
  // Format: 01J-<11 uppercase chars without dashes>
  return `01J-${uuid.replace(/-/g, '').toUpperCase().slice(0, 11)}`;
}

/**
 * Create a request-scoped child logger with requestId and module context.
 *
 * @param options - Optional request ID and/or module context. If requestId is not provided,
 *   a new one will be generated. The module should be the owning module name (e.g. "content", "episode").
 */
function createRequestLogger(
  options: { requestId?: string; module?: string }
): {
  logger: pino.Logger;
  requestId: string;
  module: string | undefined;
} {
  const requestId: string = options.requestId ?? generateRequestId();
  const moduleName: string | undefined = options.module;

  const log = moduleName
    ? logger.child({ module: moduleName, requestId })
    : logger.child({ requestId });

  return { logger: log, requestId, module: moduleName };
}

/**
 * Logger context adapter for service functions.
 *
 * Services accept a logging context object with a `logger` property
 * rather than creating ad-hoc loggers. The context logger is the
 * application-level pino instance, ensuring one log line per request
 * and consistent correlation fields.
 *
 * Example:
 *   interface ServiceContext {
 *     logger: ReturnType<typeof createRequestLogger>['logger'];
 *     requestId: string;
 *   }
 */
export type ServiceContext = {
  logger: ReturnType<typeof createRequestLogger>['logger'];
  requestId: string;
};

/**
 * No-op no-log marker for cases where logging is explicitly disabled
 * (e.g. performance-sensitive paths). Consumers should check `logger.enabled`
 * before including potentially expensive log calls.
 */
export const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
};

/**
 * Fast-path no-op when the logger level suppresses a given level.
 * Use this for high-frequency operations where a full logger call
 * would be too expensive.
 */
export function nopForLevel(): {
  info: () => void;
  warn: () => void;
  error: () => void;
  debug: () => void;
  trace: () => void;
} {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
  };
}

export default logger;
export { generateRequestId, createRequestLogger };
