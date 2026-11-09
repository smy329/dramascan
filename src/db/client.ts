import 'server-only';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getPool } from '@/platform/db/pool';

/**
 * Drizzle database client. The schema registry is assembled here when the
 * domain schemas are implemented; connection management stays in the platform
 * pool.
 */
export const db: NodePgDatabase<Record<string, never>> = drizzle(getPool());

export type Database = typeof db;
