import type { ExtractTablesWithRelations } from 'drizzle-orm/relations';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';

import type { Schema } from '@/db/schema';

/**
 * A database handle that can run queries.
 *
 * The application's default handle is the pooled client; a transaction handle
 * is bound to a single connection. Both satisfy this type, so a module service
 * can run either on the pool or inside a caller's transaction without
 * duplicating its implementation.
 *
 * The type deliberately describes the *query surface only*. It does not expose
 * `transaction()`, because a service that owns a transaction must not open a
 * nested one: a Drizzle transaction is bound to one connection, and running
 * two queries concurrently on it is a driver-level error.
 */
export type DbExecutor = PgDatabase<
  PgQueryResultHKT,
  Schema,
  ExtractTablesWithRelations<Schema>
>;
