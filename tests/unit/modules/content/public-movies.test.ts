import { describe, expect, it } from 'vitest';

import {
  isPubliclyPlayableMovie,
  publicMovieHref,
  publicMovieWatchHref,
} from '@/modules/content/public-movies.shared';

/**
 * Public standalone-movie rules (pure).
 *
 * A movie has no parent hierarchy, so the only questions are whether the row
 * itself is published, whether it is in the Trash, and whether it has a source
 * the browser can play. The rule lives in one pure function so the details
 * page, the watch page, the progress write, and the bookmark write cannot
 * disagree about what is playable.
 */
const PLAYABLE = {
  publicationStatus: 'published',
  deleted: false,
  hasSource: true,
} as const;

describe('isPubliclyPlayableMovie', () => {
  it('accepts a published movie with a source', () => {
    expect(isPubliclyPlayableMovie(PLAYABLE)).toBe(true);
  });

  it('rejects a movie without a source', () => {
    expect(isPubliclyPlayableMovie({ ...PLAYABLE, hasSource: false })).toBe(false);
  });

  it('rejects an unpublished movie', () => {
    expect(isPubliclyPlayableMovie({ ...PLAYABLE, publicationStatus: 'unpublished' })).toBe(false);
  });

  it('rejects a draft movie', () => {
    expect(isPubliclyPlayableMovie({ ...PLAYABLE, publicationStatus: 'draft' })).toBe(false);
  });

  it('rejects a movie in the Trash', () => {
    expect(isPubliclyPlayableMovie({ ...PLAYABLE, deleted: true })).toBe(false);
  });

  it('rejects an unknown publication state', () => {
    expect(isPubliclyPlayableMovie({ ...PLAYABLE, publicationStatus: 'archived' })).toBe(false);
  });
});

describe('public movie routes', () => {
  it('uses the stable id and the slug for the canonical details URL', () => {
    expect(publicMovieHref('movie-id', 'the-film')).toBe('/movie/movie-id/the-film');
  });

  it('uses the stable id and the slug for the canonical watch URL', () => {
    expect(publicMovieWatchHref('movie-id', 'the-film')).toBe('/movie/movie-id/the-film/watch');
  });
});
