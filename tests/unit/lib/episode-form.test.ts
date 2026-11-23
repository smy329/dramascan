import { describe, expect, it } from 'vitest';

import { episodeFormSchema, replaceVideoSourceFormSchema } from '@/lib/contracts/episode-form';

/**
 * The administrator's preview confirmation.
 *
 * The browser is the only component that can prove that a source plays: the
 * server never fetches the URL, so it cannot make the same check. Storing a
 * source is therefore an explicit, administrator-confirmed browser action, and
 * the confirmation travels with the payload. The server re-validates the URL
 * itself; the confirmation is the administrator's part of the deal.
 */

const DRAMA_ID = '00000000-0000-4000-8000-000000000000';
const EPISODE_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE = 'https://media.example.com/episodes/ep1.mp4';

describe('episodeFormSchema', () => {
  it('accepts an episode without a video source', () => {
    const result = episodeFormSchema.safeParse({ dramaId: DRAMA_ID, title: 'Episode 1' });

    expect(result.success).toBe(true);
  });

  it('refuses a video source the administrator did not preview', () => {
    const result = episodeFormSchema.safeParse({
      dramaId: DRAMA_ID,
      title: 'Episode 1',
      video_source: SOURCE,
      video_source_preview_confirmed: false,
    });

    expect(result.success).toBe(false);
  });

  it('refuses a video source without a preview confirmation at all', () => {
    const result = episodeFormSchema.safeParse({
      dramaId: DRAMA_ID,
      title: 'Episode 1',
      video_source: SOURCE,
    });

    expect(result.success).toBe(false);
  });

  it('accepts a video source the administrator previewed', () => {
    const result = episodeFormSchema.safeParse({
      dramaId: DRAMA_ID,
      title: 'Episode 1',
      video_source: SOURCE,
      video_source_preview_confirmed: true,
    });

    expect(result.success).toBe(true);
  });
});

describe('replaceVideoSourceFormSchema', () => {
  it('refuses a replacement without the preview confirmation', () => {
    const result = replaceVideoSourceFormSchema.safeParse({
      episodeId: EPISODE_ID,
      videoSource: SOURCE,
    });

    expect(result.success).toBe(false);
  });

  it('refuses a replacement the administrator did not confirm', () => {
    const result = replaceVideoSourceFormSchema.safeParse({
      episodeId: EPISODE_ID,
      videoSource: SOURCE,
      previewConfirmed: false,
    });

    expect(result.success).toBe(false);
  });

  it('accepts a replacement the administrator previewed and confirmed', () => {
    const result = replaceVideoSourceFormSchema.safeParse({
      episodeId: EPISODE_ID,
      videoSource: SOURCE,
      previewConfirmed: true,
    });

    expect(result.success).toBe(true);
  });
});
