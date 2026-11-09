import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  primaryKey,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
  type UpdateDeleteAction,
} from 'drizzle-orm/pg-core';

/**
 * Shared PostgreSQL schema building blocks.
 *
 * These helpers keep identity, timestamp, and constraint naming consistent
 * across every domain module. They are infrastructure only: a module's
 * `schema.ts` still owns its tables and must never import another module's
 * `schema.ts`.
 */

/**
 * PostgreSQL 18 UUIDv7 generator. UUIDv7 is time-ordered, non-enumerable, and
 * URL-safe, which matches the identity strategy in D-013.
 */
export const uuidV7Default = sql`uuidv7()`;

/** Application-owned primary key: `uuid` with a server-side UUIDv7 default. */
export function uuidPrimaryKey(name = 'id') {
  return uuid(name).notNull().default(uuidV7Default);
}

/** `created_at timestamptz not null default now()`. */
export function createdAt() {
  return timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
}

/**
 * `updated_at timestamptz not null default now()`.
 *
 * The repository sets this value on every update. A database trigger is
 * optional and must be documented if added.
 */
export function updatedAt() {
  return timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
}

/** `deleted_at timestamptz null`; `deleted_at IS NOT NULL` means Trash. */
export function deletedAt() {
  return timestamp('deleted_at', { withTimezone: true, mode: 'date' });
}

/** Standard mutable timestamps shared by most application-owned tables. */
export function timestamps() {
  return {
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  };
}

/** Standard soft-delete column, kept separate for append-only tables. */
export function softDelete() {
  return {
    deletedAt: deletedAt(),
  };
}

/**
 * Constraint and index names follow CONVENTIONS.md §5.4. Passing the same
 * inputs produces the same name in every module, migration, and test.
 */
export const constraintNames = {
  primaryKey: (table: string): string => `pk_${table}`,
  foreignKey: (table: string, column: string): string => `fk_${table}_${column}`,
  unique: (table: string, ...columns: string[]): string => `uq_${table}_${columns.join('_')}`,
  check: (table: string, rule: string): string => `ck_${table}_${rule}`,
  index: (table: string, ...columns: string[]): string => `idx_${table}_${columns.join('_')}`,
  activeUnique: (table: string, ...columns: string[]): string =>
    `uq_${table}_${columns.join('_')}_active`,
  fullText: (table: string): string => `idx_${table}_search`,
  trigram: (table: string, column: string): string => `idx_${table}_${column}_trgm`,
} as const;

/** Named primary key, for use in a `pgTable` extra-config callback. */
export function primaryKeyConstraint(table: string, columns: [AnyPgColumn, ...AnyPgColumn[]]) {
  return primaryKey({
    name: constraintNames.primaryKey(table),
    columns,
  });
}

/** Named foreign key, for use in a `pgTable` extra-config callback. */
export function foreignKeyConstraint(
  table: string,
  column: AnyPgColumn,
  foreignColumn: AnyPgColumn,
  actions: { onUpdate?: UpdateDeleteAction; onDelete?: UpdateDeleteAction } = {}
) {
  const builder = foreignKey({
    name: constraintNames.foreignKey(table, column.name),
    columns: [column],
    foreignColumns: [foreignColumn],
  });

  if (actions.onUpdate) {
    builder.onUpdate(actions.onUpdate);
  }
  if (actions.onDelete) {
    builder.onDelete(actions.onDelete);
  }

  return builder;
}

/** Named unique constraint, for use in a `pgTable` extra-config callback. */
export function uniqueConstraint(table: string, column: AnyPgColumn, ...columns: AnyPgColumn[]) {
  return unique(constraintNames.unique(table, column.name, ...columns.map(c => c.name))).on(
    column,
    ...columns
  );
}

/** Named index, for use in a `pgTable` extra-config callback. */
export function indexOn(table: string, column: AnyPgColumn, ...columns: AnyPgColumn[]) {
  return index(constraintNames.index(table, column.name, ...columns.map(c => c.name))).on(
    column,
    ...columns
  );
}

/** Named check constraint, for use in a `pgTable` extra-config callback. */
export function checkConstraint(table: string, rule: string, value: SQL) {
  return check(constraintNames.check(table, rule), value);
}
