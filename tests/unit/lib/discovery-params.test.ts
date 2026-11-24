import { describe, expect, it } from 'vitest';

import {
  readContentTypeParam,
  readPageParam,
  readSortParam,
  readStatusParam,
  readStringParam,
  type PublicSearchParams,
} from '@/lib/discovery-params';

/**
 * Query-parameter readers of the public discovery pages.
 *
 * A query parameter arrives from the URL and may be anything. These readers
 * return the approved value or the documented default, so a page never has to
 * think about an unexpected parameter — and a hostile parameter cannot widen
 * a filter.
 */

describe('readStringParam', () => {
  it('returns a trimmed value', () => {
    expect(readStringParam({ q: '  winter  ' }, 'q')).toBe('winter');
  });

  it('returns the fallback for a missing parameter', () => {
    expect(readStringParam({}, 'q')).toBe('');
    expect(readStringParam({}, 'q', 'all')).toBe('all');
  });

  it('returns the fallback for an empty or blank value', () => {
    expect(readStringParam({ q: '' }, 'q', 'fallback')).toBe('fallback');
    expect(readStringParam({ q: '   ' }, 'q', 'fallback')).toBe('fallback');
  });

  it('uses the first value of a repeated parameter', () => {
    expect(readStringParam({ q: ['first', 'second'] }, 'q')).toBe('first');
  });

  it('ignores a value that is not a string', () => {
    const params = { q: 42 } as unknown as PublicSearchParams;

    expect(readStringParam(params, 'q', 'fallback')).toBe('fallback');
  });
});

describe('readPageParam', () => {
  it('reads a positive page number', () => {
    expect(readPageParam({ page: '3' })).toBe(3);
  });

  it('falls back to the first page for an invalid number', () => {
    for (const value of ['0', '-4', 'abc', '', '1.5.2']) {
      expect(readPageParam({ page: value })).toBe(1);
    }
  });

  it('falls back to the first page when the parameter is missing', () => {
    expect(readPageParam({})).toBe(1);
  });
});

describe('readContentTypeParam', () => {
  it('accepts a drama or a movie filter', () => {
    expect(readContentTypeParam({ type: 'drama' })).toBe('drama');
    expect(readContentTypeParam({ type: 'movie' })).toBe('movie');
  });

  it('falls back to all for an unknown filter', () => {
    expect(readContentTypeParam({ type: 'episode' })).toBe('all');
    expect(readContentTypeParam({})).toBe('all');
  });
});

describe('readStatusParam', () => {
  it('accepts the lifecycle statuses', () => {
    expect(readStatusParam({ status: 'ongoing' })).toBe('ongoing');
    expect(readStatusParam({ status: 'completed' })).toBe('completed');
  });

  it('falls back to all for an unknown status', () => {
    expect(readStatusParam({ status: 'coming-soon' })).toBe('all');
    expect(readStatusParam({})).toBe('all');
  });
});

describe('readSortParam', () => {
  it('accepts every approved sort order', () => {
    expect(readSortParam({ sort: 'newest' })).toBe('newest');
    expect(readSortParam({ sort: 'relevance' })).toBe('relevance');
    expect(readSortParam({ sort: 'trending' })).toBe('trending');
    expect(readSortParam({ sort: 'popular' })).toBe('popular');
    expect(readSortParam({ sort: 'highest-rated' })).toBe('highest-rated');
    expect(readSortParam({ sort: 'most-viewed' })).toBe('most-viewed');
  });

  it('falls back to newest for an unknown order', () => {
    expect(readSortParam({ sort: 'random' })).toBe('newest');
    expect(readSortParam({})).toBe('newest');
  });

  it('uses the fallback the page asks for', () => {
    expect(readSortParam({}, 'relevance')).toBe('relevance');
    expect(readSortParam({ sort: 'random' }, 'relevance')).toBe('relevance');
    expect(readSortParam({ sort: 'trending' }, 'relevance')).toBe('trending');
  });
});
