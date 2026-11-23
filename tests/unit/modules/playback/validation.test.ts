import { describe, expect, it } from 'vitest';

import { ValidationError } from '@/platform/errors';

import {
  SUBTITLE_FORMATS,
  parsePlaybackFailureReport,
  parseSubtitleTrackInput,
  subtitleSourceUrlSchema,
} from '@/modules/playback/validation';

/**
 * Subtitle-track validation.
 *
 * A subtitle track is an administrator-supplied URL that the browser fetches
 * directly from an external host. The server validates the syntax, the scheme,
 * the absence of credentials, and the file format — it never downloads the
 * file, so these rules are the only server-side boundary a bad value can be
 * stopped at.
 */
describe('subtitleSourceUrlSchema', () => {
  it('accepts an absolute HTTPS subtitle URL', () => {
    expect(subtitleSourceUrlSchema.safeParse('https://cdn.example.com/subs/ep1.vtt').success).toBe(
      true
    );
  });

  it('rejects a plain HTTP URL', () => {
    expect(subtitleSourceUrlSchema.safeParse('http://cdn.example.com/subs/ep1.vtt').success).toBe(
      false
    );
  });

  it('rejects a non-HTTP scheme', () => {
    expect(subtitleSourceUrlSchema.safeParse('ftp://cdn.example.com/subs/ep1.vtt').success).toBe(
      false
    );
    expect(subtitleSourceUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(subtitleSourceUrlSchema.safeParse('data:text/plain,hello').success).toBe(false);
  });

  it('rejects a malformed URL', () => {
    expect(subtitleSourceUrlSchema.safeParse('not a url').success).toBe(false);
    expect(subtitleSourceUrlSchema.safeParse('/subs/ep1.vtt').success).toBe(false);
  });

  it('rejects embedded credentials', () => {
    expect(
      subtitleSourceUrlSchema.safeParse('https://user:secret@cdn.example.com/subs/ep1.vtt').success
    ).toBe(false);
    expect(
      subtitleSourceUrlSchema.safeParse('https://user@cdn.example.com/subs/ep1.vtt').success
    ).toBe(false);
  });

  it('rejects a URL whose path does not end in a supported subtitle extension', () => {
    expect(subtitleSourceUrlSchema.safeParse('https://cdn.example.com/subs/ep1.mp4').success).toBe(
      false
    );
    expect(subtitleSourceUrlSchema.safeParse('https://cdn.example.com/subs/ep1').success).toBe(
      false
    );
  });

  it('accepts every supported subtitle extension', () => {
    for (const format of SUBTITLE_FORMATS) {
      expect(
        subtitleSourceUrlSchema.safeParse(`https://cdn.example.com/subs/ep1.${format}`).success
      ).toBe(true);
    }
  });
});

describe('parseSubtitleTrackInput', () => {
  const valid = {
    episodeId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    language: 'en',
    label: 'English',
    sourceUrl: 'https://cdn.example.com/subs/ep1.vtt',
    format: 'vtt',
    isDefault: false,
  };

  it('accepts a well-formed track', () => {
    const result = parseSubtitleTrackInput(valid);

    expect(result).toMatchObject({
      language: 'en',
      label: 'English',
      format: 'vtt',
      isDefault: false,
    });
  });

  it('requires a language tag', () => {
    expect(() => parseSubtitleTrackInput({ ...valid, language: '' })).toThrow();
  });

  it('requires a human-readable label', () => {
    expect(() => parseSubtitleTrackInput({ ...valid, label: '   ' })).toThrow();
  });

  it('rejects an unsupported subtitle format', () => {
    expect(() => parseSubtitleTrackInput({ ...valid, format: 'docx' })).toThrow();
  });

  it('rejects a source URL that is not HTTPS', () => {
    // The client form applies the same rule, but the server is the authority:
    // an administrator could call the action directly with any URL.
    expect(() =>
      parseSubtitleTrackInput({ ...valid, sourceUrl: 'http://cdn.example.com/subs/ep1.vtt' })
    ).toThrow();
  });

  it('rejects a source URL with embedded credentials', () => {
    expect(() =>
      parseSubtitleTrackInput({
        ...valid,
        sourceUrl: 'https://user:secret@cdn.example.com/subs/ep1.vtt',
      })
    ).toThrow();
  });

  it('rejects a source URL that is not an absolute URL', () => {
    expect(() =>
      parseSubtitleTrackInput({ ...valid, sourceUrl: '/subs/ep1.vtt' })
    ).toThrow();
  });

  it('rejects a source URL with an unsupported scheme', () => {
    expect(() =>
      parseSubtitleTrackInput({ ...valid, sourceUrl: 'javascript:alert(1)' })
    ).toThrow();
  });

  it('rejects a source URL whose extension contradicts the format', () => {
    expect(() =>
      parseSubtitleTrackInput({ ...valid, format: 'srt', sourceUrl: 'https://cdn.example.com/subs/e.vtt' })
    ).toThrow();
  });

  it('reports a URL whose extension contradicts the format on the URL field', () => {
    // The rule is about two fields at once, so the schema reports it at the
    // root of the payload. The administrator still has to fix the URL, so the
    // message belongs on the URL field: that is where the form renders it.
    try {
      parseSubtitleTrackInput({
        ...valid,
        format: 'srt',
        sourceUrl: 'https://cdn.example.com/subs/e.vtt',
      });

      expect.unreachable('The contradictory payload must be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).fieldErrors?.sourceUrl).toContain(
        'Subtitle source extension must match the declared format.'
      );
    }
  });

  it('rejects an episode id that is not a UUID', () => {
    expect(() => parseSubtitleTrackInput({ ...valid, episodeId: 'not-a-uuid' })).toThrow();
  });

  it('rejects unknown fields', () => {
    expect(() => parseSubtitleTrackInput({ ...valid, transcoded: true })).toThrow();
  });
});

describe('parsePlaybackFailureReport', () => {
  const valid = {
    episodeId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    reason: 'network',
    detail: 'The media request failed.',
  };

  it('accepts a report with a known reason', () => {
    expect(parsePlaybackFailureReport(valid)).toMatchObject({ reason: 'network' });
  });

  it('accepts an unknown reason', () => {
    expect(parsePlaybackFailureReport({ ...valid, reason: 'unknown' }).reason).toBe('unknown');
  });

  it('rejects an unknown reason value', () => {
    expect(() => parsePlaybackFailureReport({ ...valid, reason: 'server-error' })).toThrow();
  });

  it('rejects a report that carries a source URL', () => {
    expect(() =>
      parsePlaybackFailureReport({
        ...valid,
        sourceUrl: 'https://cdn.example.com/ep1.mp4',
      })
    ).toThrow();
  });

  it('rejects an over-long detail', () => {
    expect(() => parsePlaybackFailureReport({ ...valid, detail: 'x'.repeat(2001) })).toThrow();
  });
});
