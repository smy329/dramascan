import 'server-only';

import { parseServerConfig } from './schema';

export type { Environment, ServerConfig } from './schema';
export { ConfigurationError, parseServerConfig } from './schema';

/**
 * Validated server-only configuration. Importing this module in a Client
 * Component fails at build time because of `server-only`.
 */
export const serverConfig = parseServerConfig(process.env);
