import 'server-only';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { schema, type Schema } from '@/db/schema';
import { getPool } from '@/platform/db/pool';

/**
 * Drizzle database client. The schema registry is assembled in
 * `src/db/schema.ts`; connection management stays in the platform pool.
 */
export const db: NodePgDatabase<Schema> = drizzle(getPool(), { schema });

export type Database = typeof db;
