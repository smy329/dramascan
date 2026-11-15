import { describe, expect, it } from 'vitest';

import {
  createMovieSchema,
  moviePublicationStatusSchema,
  movieVideoSourceSchema,
  parseCreateMovieInput,
  parseUpdateMovieInput,
} from '@/modules/content/validation';
import { ValidationError } from '@/platform/errors';

const VALID_CATEGORY = '0198f3a2-0000-7000-8000-000000000001';
const VALID_PLATFORM = '0198f3a2-0000-7000-8000-000000000002';
const HTTPS_SOURCE = 'https://media.example.com/movies/midnight-signal.mp4';

function validMovie(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Midnight Signal',
    slug: 'midnight-signal',
    ...overrides,
  };
}

describe('movie video source', () => {
  it.each([
    'https://example.com/movie.mp4',
    'https://cdn.example.com/path/to/movie.mp4?token=abc',
    'https://cdn.example.com/path/to/movie.MP4#t=10',
    'https://example.com:8443/movie.mp4',
  ])('accepts publication-ready URL %s', url => {
    expect(movieVideoSourceSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    ['http://example.com/movie.mp4', 'plain HTTP'],
    ['//example.com/movie.mp4', 'protocol-relative'],
    ['/movies/local.mp4', 'relative path'],
    ['example.com/movie.mp4', 'missing scheme'],
    ['ftp://example.com/movie.mp4', 'non-HTTPS scheme'],
    ['javascript:alert(1)', 'script scheme'],
    ['https://user:pass@example.com/movie.mp4', 'embedded credentials'],
    ['https://example.com/movie.mov', 'unsupported extension'],
    ['https://example.com/movie', 'missing extension'],
    ['', 'empty'],
  ])('rejects %s (%s)', url => {
    expect(movieVideoSourceSchema.safeParse(url).success).toBe(false);
  });

  it('rejects an over-long URL', () => {
    const url = `https://example.com/${'a'.repeat(2048)}.mp4`;
    expect(movieVideoSourceSchema.safeParse(url).success).toBe(false);
  });
});

describe('movie publication status schema', () => {
  it('accepts the three stored states', () => {
    for (const status of ['draft', 'published', 'unpublished']) {
      expect(moviePublicationStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it('rejects trashed (a view, not a stored state)', () => {
    expect(moviePublicationStatusSchema.safeParse('trashed').success).toBe(false);
  });
});

describe('createMovieSchema', () => {
  it('applies metadata defaults for a minimal movie and never sets publication state', () => {
    const parsed = createMovieSchema.parse(validMovie());

    expect(parsed).toEqual({
      title: 'Midnight Signal',
      slug: 'midnight-signal',
      poster: null,
      banner: null,
      video_source: null,
      categories: [],
      platforms: [],
    });
    expect(parsed).not.toHaveProperty('publication_status');
  });

  it('accepts full metadata, a nullable video source, and UUID associations', () => {
    const parsed = createMovieSchema.parse(
      validMovie({
        description: 'A standalone feature film.',
        poster: 'https://img.example.com/poster.jpg',
        banner: 'https://img.example.com/banner.jpg',
        video_source: HTTPS_SOURCE,
        categories: [VALID_CATEGORY],
        platforms: [VALID_PLATFORM],
      })
    );

    expect(parsed.description).toBe('A standalone feature film.');
    expect(parsed.poster).toBe('https://img.example.com/poster.jpg');
    expect(parsed.banner).toBe('https://img.example.com/banner.jpg');
    expect(parsed.video_source).toBe(HTTPS_SOURCE);
    expect(parsed.categories).toEqual([VALID_CATEGORY]);
    expect(parsed.platforms).toEqual([VALID_PLATFORM]);
  });

  it.each(['draft', 'published', 'unpublished'] as const)(
    'rejects publication status %s on create',
    status => {
      expect(createMovieSchema.safeParse(validMovie({ publication_status: status })).success).toBe(
        false
      );
    }
  );

  it.each([
    ['Uppercase-Slug', 'uppercase slug'],
    ['-leading', 'leading hyphen'],
    ['trailing-', 'trailing hyphen'],
    ['double--hyphen', 'double hyphen'],
    ['has space', 'space'],
    ['a'.repeat(101), 'over-long slug'],
  ])('rejects invalid slug %s (%s)', slug => {
    expect(createMovieSchema.safeParse(validMovie({ slug })).success).toBe(false);
  });

  it('rejects an empty title', () => {
    expect(createMovieSchema.safeParse(validMovie({ title: '   ' })).success).toBe(false);
  });

  it('rejects a non-URL poster or banner', () => {
    expect(createMovieSchema.safeParse(validMovie({ poster: 'not-a-url' })).success).toBe(false);
    expect(createMovieSchema.safeParse(validMovie({ banner: 'not-a-url' })).success).toBe(false);
  });

  it('rejects non-UUID category and platform ids', () => {
    expect(createMovieSchema.safeParse(validMovie({ categories: ['not-a-uuid'] })).success).toBe(
      false
    );
    expect(createMovieSchema.safeParse(validMovie({ platforms: ['not-a-uuid'] })).success).toBe(
      false
    );
  });

  it('rejects a non-.mp4 video source', () => {
    expect(
      createMovieSchema.safeParse(validMovie({ video_source: 'https://example.com/movie.mov' }))
        .success
    ).toBe(false);
  });

  it('rejects an HTTP video source', () => {
    expect(
      createMovieSchema.safeParse(validMovie({ video_source: 'http://example.com/movie.mp4' }))
        .success
    ).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(createMovieSchema.safeParse(validMovie({ dramaId: VALID_CATEGORY })).success).toBe(
      false
    );
  });
});

describe('movie parse helpers', () => {
  it('returns parsed create input without publication state', () => {
    const parsed = parseCreateMovieInput(validMovie());

    expect(parsed.slug).toBe('midnight-signal');
    expect(parsed).not.toHaveProperty('publication_status');
  });

  it('rejects publication status on update input', () => {
    expect(() =>
      parseUpdateMovieInput(validMovie({ publication_status: 'unpublished', video_source: null }))
    ).toThrow(ValidationError);
  });

  it('parses update input with the same full-payload contract', () => {
    const parsed = parseUpdateMovieInput(validMovie({ video_source: HTTPS_SOURCE }));

    expect(parsed.video_source).toBe(HTTPS_SOURCE);
    expect(parsed).not.toHaveProperty('publication_status');
  });

  it('throws a field-keyed ValidationError with REST-safe details', () => {
    try {
      parseCreateMovieInput(validMovie({ slug: 'Not Valid' }));
      expect.fail('Expected parseCreateMovieInput to throw.');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validationError = error as ValidationError;
      expect(validationError.fieldErrors?.slug?.length).toBeGreaterThan(0);
    }
  });

  it('throws when the video source is not publication-ready', () => {
    expect(() =>
      parseCreateMovieInput(validMovie({ video_source: 'http://example.com/movie.mp4' }))
    ).toThrow(ValidationError);
  });
});
