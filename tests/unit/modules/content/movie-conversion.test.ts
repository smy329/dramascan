import { describe, expect, it } from 'vitest';

import {
  buildMovieConversionPlan,
  computeMovieConversionFingerprint,
  episodeCountConflictMessage,
  resolveMoviePublicationStatus,
  type MovieConversionRelationshipCounts,
  type MovieConversionState,
} from '@/modules/content/movie-conversion';
import {
  parseMovieConversionRequest,
  movieConversionRequestSchema,
} from '@/modules/content/validation';
import { ValidationError } from '@/platform/errors';

const DRAMA_ID = '0198f3a2-0000-7000-8000-000000000010';
const EPISODE_ID = '0198f3a2-0000-7000-8000-000000000011';

function relationships(
  overrides: Partial<MovieConversionRelationshipCounts> = {}
): MovieConversionRelationshipCounts {
  return {
    ratings: 0,
    reviews: 0,
    bookmarks: 0,
    playbackProgress: 0,
    watchedState: 0,
    watchHistory: 0,
    categories: 0,
    platforms: 0,
    slugHistory: 0,
    seo: 0,
    assets: 0,
    notifications: 0,
    adminNotifications: 0,
    analyticsEvents: 0,
    ...overrides,
  };
}

function state(overrides: Partial<MovieConversionState> = {}): MovieConversionState {
  return {
    dramaId: DRAMA_ID,
    title: 'Seasons of Glass',
    slug: 'seasons-of-glass',
    description: 'A quiet family drama.',
    poster: 'https://media.example.com/posters/glass.jpg',
    banner: 'https://media.example.com/banners/glass.jpg',
    publicationStatus: 'published',
    episode: {
      id: EPISODE_ID,
      title: 'The Last Winter',
      episodeNumber: 1,
      position: 0,
      seasonId: '0198f3a2-0000-7000-8000-000000000012',
      videoSource: 'https://media.example.com/episodes/glass.mp4',
    },
    categories: [],
    platforms: [],
    ...overrides,
  };
}

describe('resolveMoviePublicationStatus', () => {
  it.each(['draft', 'published', 'unpublished'] as const)(
    'keeps the movie-compatible state %s',
    value => {
      expect(resolveMoviePublicationStatus(value)).toEqual({ status: value, warning: null });
    }
  );

  it('treats a null state as draft without a warning', () => {
    expect(resolveMoviePublicationStatus(null)).toEqual({ status: 'draft', warning: null });
  });

  it('falls back to draft with a warning for an unknown drama state', () => {
    const resolved = resolveMoviePublicationStatus('ongoing');

    expect(resolved.status).toBe('draft');
    expect(resolved.warning).toMatch(/ongoing/);
    expect(resolved.warning).toMatch(/draft/);
  });
});

describe('computeMovieConversionFingerprint', () => {
  it('is deterministic for the same state', () => {
    expect(computeMovieConversionFingerprint(state())).toBe(
      computeMovieConversionFingerprint(state())
    );
  });

  it('is independent of the category and platform order', () => {
    const first = state({
      categories: [
        { id: '0198f3a2-0000-7000-8000-0000000000a1', name: 'Drama' },
        { id: '0198f3a2-0000-7000-8000-0000000000a2', name: 'Romance' },
      ],
      platforms: [
        { id: '0198f3a2-0000-7000-8000-0000000000b1', name: 'Web' },
        { id: '0198f3a2-0000-7000-8000-0000000000b2', name: 'Mobile' },
      ],
    });
    const second = state({
      categories: [...first.categories].reverse(),
      platforms: [...first.platforms].reverse(),
    });

    expect(computeMovieConversionFingerprint(first)).toBe(
      computeMovieConversionFingerprint(second)
    );
  });

  it.each<[string, Partial<MovieConversionState>]>([
    ['title', { title: 'Seasons of Glass, Revisited' }],
    ['slug', { slug: 'seasons-of-glass-revisited' }],
    ['description', { description: 'Changed.' }],
    ['poster', { poster: null }],
    ['banner', { banner: null }],
    ['publication status', { publicationStatus: 'draft' }],
    ['episode id', { episode: { ...state().episode, id: '0198f3a2-0000-7000-8000-0000000000ff' } }],
    ['video source', { episode: { ...state().episode, videoSource: null } }],
  ])('changes when the %s changes', (_label, override) => {
    const changed = state(override);

    expect(computeMovieConversionFingerprint(changed)).not.toBe(
      computeMovieConversionFingerprint(state())
    );
  });

  it('does not change when only the episode title or number changes', () => {
    const changed = state({
      episode: { ...state().episode, title: 'Renamed episode', episodeNumber: 7, position: 3 },
    });

    expect(computeMovieConversionFingerprint(changed)).toBe(
      computeMovieConversionFingerprint(state())
    );
  });
});

describe('buildMovieConversionPlan', () => {
  it('maps the drama and its single episode into the movie preview', () => {
    const plan = buildMovieConversionPlan(
      state({
        categories: [{ id: '0198f3a2-0000-7000-8000-0000000000a1', name: 'Drama' }],
        platforms: [{ id: '0198f3a2-0000-7000-8000-0000000000b1', name: 'Web' }],
      }),
      relationships({ ratings: 4, reviews: 2, watchHistory: 9 })
    );

    expect(plan.dramaId).toBe(DRAMA_ID);
    expect(plan.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(plan.source).toEqual({
      dramaId: DRAMA_ID,
      episodeId: EPISODE_ID,
      episodeTitle: 'The Last Winter',
      episodeNumber: 1,
      seasonId: '0198f3a2-0000-7000-8000-000000000012',
    });
    expect(plan.movie).toMatchObject({
      title: 'Seasons of Glass',
      slug: 'seasons-of-glass',
      description: 'A quiet family drama.',
      poster: 'https://media.example.com/posters/glass.jpg',
      banner: 'https://media.example.com/banners/glass.jpg',
      publicationStatus: 'published',
      videoSource: 'https://media.example.com/episodes/glass.mp4',
      convertedFromDramaId: DRAMA_ID,
    });
    expect(plan.movie.categories).toEqual([
      { id: '0198f3a2-0000-7000-8000-0000000000a1', name: 'Drama' },
    ]);
    expect(plan.movie.platforms).toEqual([
      { id: '0198f3a2-0000-7000-8000-0000000000b1', name: 'Web' },
    ]);
    expect(plan.relationships).toMatchObject({ ratings: 4, reviews: 2, watchHistory: 9 });
    expect(plan.warnings).toEqual([]);
  });

  it('carries the publication warning into the plan', () => {
    const plan = buildMovieConversionPlan(
      state({ publicationStatus: 'ongoing' }),
      relationships()
    );

    expect(plan.movie.publicationStatus).toBe('draft');
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/ongoing/);
  });
});

describe('episodeCountConflictMessage', () => {
  it('explains an empty drama', () => {
    expect(episodeCountConflictMessage(0)).toMatch(/no active episode/i);
  });

  it('explains a multi-episode drama', () => {
    const message = episodeCountConflictMessage(3);

    expect(message).toContain('3 active episodes');
    expect(message).toMatch(/exactly one episode/i);
  });
});

describe('movieConversionRequestSchema', () => {
  it('accepts a preview request', () => {
    expect(
      movieConversionRequestSchema.safeParse({ dramaId: DRAMA_ID, mode: 'preview' }).success
    ).toBe(true);
  });

  it('accepts an apply request with a 64-character lowercase fingerprint', () => {
    expect(
      movieConversionRequestSchema.safeParse({
        dramaId: DRAMA_ID,
        mode: 'apply',
        fingerprint: 'a'.repeat(64),
      }).success
    ).toBe(true);
  });

  it.each([
    [{ mode: 'preview' }, 'missing dramaId'],
    [{ dramaId: 'not-a-uuid', mode: 'preview' }, 'malformed dramaId'],
    [{ dramaId: DRAMA_ID, mode: 'convert' }, 'unknown mode'],
    [{ dramaId: DRAMA_ID, mode: 'apply', fingerprint: 'short' }, 'malformed fingerprint'],
    [{ dramaId: DRAMA_ID, mode: 'apply', fingerprint: 'A'.repeat(64) }, 'uppercase fingerprint'],
    [{ dramaId: DRAMA_ID, mode: 'preview', extra: true }, 'unknown property'],
  ])('rejects %s (%s)', (input, _label) => {
    expect(movieConversionRequestSchema.safeParse(input).success).toBe(false);
  });

  it('throws a ValidationError from the parser', () => {
    expect(() => parseMovieConversionRequest({ mode: 'preview' })).toThrow(ValidationError);
  });
});
