import { sql } from 'drizzle-orm';
import { getTableConfig, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { schema } from '@/db/schema';
import {
  checkConstraint,
  constraintNames,
  foreignKeyConstraint,
  indexOn,
  primaryKeyConstraint,
  softDelete,
  timestamps,
  uniqueConstraint,
  uuidPrimaryKey,
} from '@/platform/db/schema-helpers';

describe('database schema helpers', () => {
  it('builds an application primary key with a UUIDv7 default', () => {
    const table = pgTable('sample_items', {
      id: uuidPrimaryKey(),
    });

    const id = getTableConfig(table).columns[0]!;

    expect(id.name).toBe('id');
    expect(id.columnType).toBe('PgUUID');
    expect(id.notNull).toBe(true);
    expect(id.hasDefault).toBe(true);
  });

  it('provides standard timestamps and a nullable soft-delete column', () => {
    const table = pgTable('sample_timestamps', {
      id: uuidPrimaryKey(),
      ...timestamps(),
      ...softDelete(),
    });

    const columns = getTableConfig(table).columns;
    expect(columns.map(column => column.name)).toEqual([
      'id',
      'created_at',
      'updated_at',
      'deleted_at',
    ]);

    const created = columns[1]!;
    const updated = columns[2]!;
    const deleted = columns[3]!;

    expect(created.columnType).toBe('PgTimestamp');
    expect(created.notNull).toBe(true);
    expect(created.hasDefault).toBe(true);
    expect(updated.columnType).toBe('PgTimestamp');
    expect(updated.notNull).toBe(true);
    expect(updated.hasDefault).toBe(true);
    expect(deleted.columnType).toBe('PgTimestamp');
    expect(deleted.notNull).toBe(false);
    expect(deleted.hasDefault).toBe(false);
  });

  it('generates the documented constraint and index names', () => {
    expect(constraintNames.primaryKey('dramas')).toBe('pk_dramas');
    expect(constraintNames.foreignKey('episodes', 'drama_id')).toBe('fk_episodes_drama_id');
    expect(constraintNames.unique('dramas', 'slug')).toBe('uq_dramas_slug');
    expect(constraintNames.check('ratings', 'value_range')).toBe('ck_ratings_value_range');
    expect(constraintNames.index('episodes', 'drama_id', 'position')).toBe(
      'idx_episodes_drama_id_position'
    );
    expect(constraintNames.activeUnique('dramas', 'slug')).toBe('uq_dramas_slug_active');
    expect(constraintNames.fullText('dramas')).toBe('idx_dramas_search');
    expect(constraintNames.trigram('dramas', 'title')).toBe('idx_dramas_title_trgm');
  });

  it('names primary keys, foreign keys, unique constraints, indexes, and checks', () => {
    const parents = pgTable(
      'parents',
      {
        id: uuidPrimaryKey(),
      },
      table => [primaryKeyConstraint('parents', [table.id])]
    );

    const children = pgTable(
      'children',
      {
        id: uuidPrimaryKey(),
        parentId: uuid('parent_id').notNull(),
        label: text('label').notNull(),
      },
      table => [
        primaryKeyConstraint('children', [table.id]),
        foreignKeyConstraint('children', table.parentId, parents.id, {
          onUpdate: 'cascade',
          onDelete: 'restrict',
        }),
        uniqueConstraint('children', table.parentId, table.label),
        indexOn('children', table.parentId),
        checkConstraint('children', 'label_present', sql`length(${table.label}) > 0`),
      ]
    );

    const config = getTableConfig(children);

    expect(config.name).toBe('children');
    expect(config.primaryKeys[0]?.getName()).toBe('pk_children');
    expect(config.foreignKeys[0]?.getName()).toBe('fk_children_parent_id');
    expect(config.foreignKeys[0]?.onUpdate).toBe('cascade');
    expect(config.foreignKeys[0]?.onDelete).toBe('restrict');
    expect(config.uniqueConstraints[0]?.getName()).toBe('uq_children_parent_id_label');
    expect(config.indexes[0]?.config.name).toBe('idx_children_parent_id');
    expect(config.checks[0]?.name).toBe('ck_children_label_present');
  });
});

describe('schema registry', () => {
  it('is assembled as a single registry object', () => {
    expect(schema).toBeTypeOf('object');
    expect(schema).not.toBeNull();
  });
});
