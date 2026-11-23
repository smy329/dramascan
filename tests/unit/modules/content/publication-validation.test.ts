import { describe, expect, it } from 'vitest';

import {
  createEpisodeSchema,
  parsePublicationRequest,
  publicationReadyVideoSourceSchema,
  publicationRequestSchema,
} from '@/modules/content/validation';
import { ValidationError } from '@/platform/errors';

const VALID_EPISODE_ID = '0198f3a2-0000-7000-8000-000000000011';

function validEpisode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Episode 1',
    ...overrides,
  };
}

describe('publicationReadyVideoSourceSchema', () => {
  it('accepts an absolute HTTPS .mp4 URL with a query string and fragment', () => {
    expect(
      publicationReadyVideoSourceSchema.safeParse('https://media.example.com/a/b.MP4?token=1#t=1')
        .success
    ).toBe(true);
  });

  it.each([
    'https://example.com/movie.mp4',
    'https://cdn.example.com/path/to/movie.mp4?token=abc',
    'https://example.com:8443/movie.MP4',
  ])('accepts publication-ready URL %s', url => {
    expect(publicationReadyVideoSourceSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    ['http://example.com/movie.mp4', 'plain HTTP'],
    ['//example.com/movie.mp4', 'protocol-relative'],
    ['/movies/local.mp4', 'relative path'],
    ['example.com/movie.mp4', 'missing scheme'],
    ['https://user:pass@example.com/movie.mp4', 'embedded credentials'],
    ['https://example.com/movie.mov', 'unsupported extension'],
    ['https://example.com/movie', 'missing extension'],
    ['not a url', 'malformed URL'],
    ['', 'empty'],
  ])('rejects %s (%s)', url => {
    expect(publicationReadyVideoSourceSchema.safeParse(url).success).toBe(false);
  });

  it('rejects an over-long URL', () => {
    const url = `https://example.com/${'a'.repeat(2048)}.mp4`;
    expect(publicationReadyVideoSourceSchema.safeParse(url).success).toBe(false);
  });
});

describe('createEpisodeSchema', () => {
  it('accepts a publication-ready video source and never sets publication state', () => {
    const parsed = createEpisodeSchema.parse(
      validEpisode({
        video_source: 'https://media.example.com/episodes/1.mp4',
        video_source_preview_confirmed: true,
      })
    );

    expect(parsed.video_source).toBe('https://media.example.com/episodes/1.mp4');
    expect(parsed).not.toHaveProperty('publication_status');
  });

  it('refuses a video source the administrator did not preview', () => {
    // The browser is the only component that can prove that a source plays, so
    // a source without the preview confirmation is refused.
    const result = createEpisodeSchema.safeParse(
      validEpisode({ video_source: 'https://media.example.com/episodes/1.mp4' })
    );

    expect(result.success).toBe(false);
  });

  it('refuses a video source whose preview confirmation is false', () => {
    const result = createEpisodeSchema.safeParse(
      validEpisode({
        video_source: 'https://media.example.com/episodes/1.mp4',
        video_source_preview_confirmed: false,
      })
    );

    expect(result.success).toBe(false);
  });

  it('allows a draft episode without a source', () => {
    const parsed = createEpisodeSchema.parse(validEpisode());

    expect(parsed.video_source).toBeUndefined();
    expect(parsed).not.toHaveProperty('publication_status');
  });

  it('rejects a drama_id in the payload, because the parent drama comes from the route', () => {
    // A second, ignored parent source is how an episode ends up validated
    // against the wrong drama (H-05), so the field is not part of the contract.
    expect(
      createEpisodeSchema.safeParse(
        validEpisode({ drama_id: '0198f3a2-0000-7000-8000-000000000010' })
      ).success
    ).toBe(false);
  });

  it('leaves position unset so the workflow can append inside the target scope', () => {
    const parsed = createEpisodeSchema.parse(validEpisode());

    expect(parsed.position).toBeUndefined();
  });

  it('rejects an HTTP video source', () => {
    expect(
      createEpisodeSchema.safeParse(
        validEpisode({
          video_source: 'http://media.example.com/episodes/1.mp4',
          video_source_preview_confirmed: true,
        })
      ).success
    ).toBe(false);
  });

  it('rejects a non-.mp4 HTTPS video source', () => {
    expect(
      createEpisodeSchema.safeParse(
        validEpisode({
          video_source: 'https://media.example.com/episodes/1.mov',
          video_source_preview_confirmed: true,
        })
      ).success
    ).toBe(false);
  });

  it.each(['ongoing', 'completed', 'draft', 'published', 'unpublished'] as const)(
    'rejects publication status %s on create',
    status => {
      expect(
        createEpisodeSchema.safeParse(validEpisode({ publication_status: status })).success
      ).toBe(false);
    }
  );
});

describe('publicationRequestSchema', () => {
  it('accepts a supported content type, action, and id list', () => {
    const parsed = publicationRequestSchema.parse({
      contentType: 'episode',
      action: 'publish',
      ids: [VALID_EPISODE_ID],
    });

    expect(parsed.contentType).toBe('episode');
    expect(parsed.action).toBe('publish');
    expect(parsed.ids).toEqual([VALID_EPISODE_ID]);
  });

  it.each(['drama', 'season', 'episode', 'movie'] as const)(
    'accepts content type %s',
    contentType => {
      expect(
        publicationRequestSchema.safeParse({
          contentType,
          action: 'unpublish',
          ids: [VALID_EPISODE_ID],
        }).success
      ).toBe(true);
    }
  );

  it('rejects an unsupported content type', () => {
    expect(
      publicationRequestSchema.safeParse({ contentType: 'category', action: 'publish', ids: ['x'] })
        .success
    ).toBe(false);
  });

  it('rejects an unsupported action', () => {
    expect(
      publicationRequestSchema.safeParse({
        contentType: 'episode',
        action: 'delete',
        ids: [VALID_EPISODE_ID],
      }).success
    ).toBe(false);
  });

  it('rejects an empty id list', () => {
    expect(
      publicationRequestSchema.safeParse({ contentType: 'episode', action: 'publish', ids: [] })
        .success
    ).toBe(false);
  });

  it('rejects more than 200 ids', () => {
    const ids = Array.from({ length: 201 }, () => VALID_EPISODE_ID);

    expect(
      publicationRequestSchema.safeParse({ contentType: 'episode', action: 'publish', ids }).success
    ).toBe(false);
  });

  it('rejects a non-array id list', () => {
    expect(
      publicationRequestSchema.safeParse({
        contentType: 'episode',
        action: 'publish',
        ids: VALID_EPISODE_ID,
      }).success
    ).toBe(false);
  });

  it('accepts ids that are not UUIDs so they can be reported per item', () => {
    expect(
      publicationRequestSchema.safeParse({
        contentType: 'episode',
        action: 'publish',
        ids: ['not-a-uuid'],
      }).success
    ).toBe(true);
  });
});

describe('parsePublicationRequest', () => {
  it('returns parsed input for a valid request', () => {
    const parsed = parsePublicationRequest({
      contentType: 'movie',
      action: 'unpublish',
      ids: [VALID_EPISODE_ID],
    });

    expect(parsed.contentType).toBe('movie');
  });

  it('throws a ValidationError for an invalid request', () => {
    expect(() =>
      parsePublicationRequest({ contentType: 'movie', action: 'publish', ids: [] })
    ).toThrow(ValidationError);
  });
});
