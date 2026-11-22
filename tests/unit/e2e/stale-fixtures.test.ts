import { describe, expect, it } from 'vitest';

import {
  STALE_FIXTURE_PREFIX,
  STALE_FIXTURE_STATEMENTS,
} from '../../e2e/support/stale-fixtures.mjs';

/**
 * End-to-end fixture sweep.
 *
 * The sweep removes rows from the shared test database, so its SQL is pinned
 * here: a statement that deletes too much, or that runs in the wrong order,
 * would either destroy unrelated rows or fail on a foreign key.
 */

function statementFor(key: string): string {
  const statement = STALE_FIXTURE_STATEMENTS.find(entry => entry.key === key);

  if (!statement) {
    throw new Error(`No statement named "${key}".`);
  }

  return statement.sql;
}

function positionOf(key: string): number {
  const index = STALE_FIXTURE_STATEMENTS.findIndex(entry => entry.key === key);

  if (index < 0) {
    throw new Error(`No statement named "${key}".`);
  }

  return index;
}

describe('STALE_FIXTURE_STATEMENTS', () => {
  it('only targets rows carrying the end-to-end fixture prefix', () => {
    for (const statement of STALE_FIXTURE_STATEMENTS) {
      expect(statement.sql).toContain(`'${STALE_FIXTURE_PREFIX}%'`);
    }
  });

  it('deletes the review children before the reviews themselves', () => {
    expect(positionOf('reviewReports')).toBeLessThan(positionOf('reviews'));
    expect(positionOf('reviewReactions')).toBeLessThan(positionOf('reviews'));
  });

  it('deletes the ratings and reviews before the content they point at', () => {
    expect(positionOf('ratings')).toBeLessThan(positionOf('dramas'));
    expect(positionOf('ratings')).toBeLessThan(positionOf('movies'));
    expect(positionOf('reviews')).toBeLessThan(positionOf('dramas'));
    expect(positionOf('reviews')).toBeLessThan(positionOf('movies'));
  });

  it('deletes the personal records before the content they point at', () => {
    for (const key of ['bookmarks', 'playbackProgress', 'watchedState', 'watchHistory']) {
      expect(positionOf(key)).toBeLessThan(positionOf('dramas'));
      expect(positionOf(key)).toBeLessThan(positionOf('movies'));
      expect(positionOf(key)).toBeLessThan(positionOf('episodes'));
    }
  });

  it('deletes the hierarchy from the leaves up', () => {
    expect(positionOf('episodes')).toBeLessThan(positionOf('seasons'));
    expect(positionOf('seasons')).toBeLessThan(positionOf('dramas'));
  });

  it('deletes a converted movie before the drama it was converted from', () => {
    expect(positionOf('movies')).toBeLessThan(positionOf('dramas'));
    expect(statementFor('movies')).toContain('converted_from_drama_id');
  });

  it('deletes the taxonomy rows after their join rows', () => {
    expect(positionOf('dramaCategories')).toBeLessThan(positionOf('categories'));
    expect(positionOf('movieCategories')).toBeLessThan(positionOf('categories'));
    expect(positionOf('dramaPlatforms')).toBeLessThan(positionOf('platforms'));
    expect(positionOf('moviePlatforms')).toBeLessThan(positionOf('platforms'));
  });

  it('deletes the fixture users last, so their reports can be removed first', () => {
    expect(positionOf('users')).toBeGreaterThan(positionOf('reviewReports'));
    expect(statementFor('users')).toContain('email');
  });
});
