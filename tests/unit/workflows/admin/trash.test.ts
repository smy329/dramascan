import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// The Trash read model imports the database client for its listing queries.
// This suite pins the pure query contract, so no connection is opened.
vi.mock('@/db/client', () => ({ db: {} }));

import type { ActorContext } from '@/modules/authorization/actors';
import {
  TRASH_CONTENT_TYPES,
  TRASH_MANAGE_PERMISSIONS,
  parseTrashListQuery,
  permittedTrashTypes,
} from '@/workflows/admin/trash';

/**
 * Trash read-model contract.
 *
 * The Trash surface accepts query values from the URL, so the parser is the
 * boundary that keeps a hand-edited or stale link from widening the result.
 */

function actor(permissions: readonly string[] = [], isSuperAdmin = false): ActorContext {
  return {
    userId: 'user-1',
    roles: [],
    isSuperAdmin,
    permissions: permissions as ActorContext['permissions'],
  };
}

describe('parseTrashListQuery', () => {
  it('defaults to every content type on the first page', () => {
    expect(parseTrashListQuery({})).toEqual({
      type: 'all',
      page: 1,
      pageSize: 20,
      search: '',
    });
  });

  it('accepts each supported content type', () => {
    for (const type of TRASH_CONTENT_TYPES) {
      expect(parseTrashListQuery({ type }).type).toBe(type);
    }
  });

  it('falls back to "all" for an unknown content type', () => {
    expect(parseTrashListQuery({ type: 'season-episode' }).type).toBe('all');
  });

  it('falls back to the first page for an invalid page number', () => {
    expect(parseTrashListQuery({ page: 0 }).page).toBe(1);
    expect(parseTrashListQuery({ page: -3 }).page).toBe(1);
    expect(parseTrashListQuery({ page: 'not-a-number' }).page).toBe(1);
  });

  it('bounds the page size to the allowed window', () => {
    expect(parseTrashListQuery({ pageSize: 50 }).pageSize).toBe(50);
    expect(parseTrashListQuery({ pageSize: 101 }).pageSize).toBe(20);
    expect(parseTrashListQuery({ pageSize: 0 }).pageSize).toBe(20);
  });

  it('trims the search term and discards an over-long one', () => {
    expect(parseTrashListQuery({ search: '  Glass  ' }).search).toBe('Glass');
    expect(parseTrashListQuery({ search: 'x'.repeat(201) }).search).toBe('');
  });
});

describe('permittedTrashTypes', () => {
  it('returns only the content types the actor may manage', () => {
    expect(permittedTrashTypes(actor(['drama.manage', 'movie.manage']))).toEqual(['drama', 'movie']);
  });

  it('returns every type for a Super Admin', () => {
    expect(permittedTrashTypes(actor([], true))).toEqual([...TRASH_CONTENT_TYPES]);
  });

  it('returns nothing for an actor without a manage permission', () => {
    expect(permittedTrashTypes(actor(['drama.read']))).toEqual([]);
  });
});

describe('TRASH_MANAGE_PERMISSIONS', () => {
  it('maps every content type to its canonical manage permission', () => {
    expect(TRASH_MANAGE_PERMISSIONS).toEqual({
      drama: 'drama.manage',
      season: 'season.manage',
      episode: 'episode.manage',
      movie: 'movie.manage',
    });
  });
});
