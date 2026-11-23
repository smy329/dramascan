import { describe, expect, it } from 'vitest';

import { isPubliclyPlayableEpisode } from '@/modules/content/public-episodes.shared';

/**
 * The watch page may only receive a source URL for an episode that is
 * publicly playable. The rule is deliberately one function so the page, the
 * catalogue, and the API cannot disagree about what is playable.
 */
const PLAYABLE = {
  episodePublicationStatus: 'published',
  episodeDeleted: false,
  hasSource: true,
  dramaPublicationStatus: 'published',
  dramaDeleted: false,
  dramaStructureType: 'season_based',
  hasSeason: true,
  seasonPublicationStatus: 'published',
  seasonDeleted: false,
} as const;

describe('isPubliclyPlayableEpisode', () => {
  it('accepts a published episode under a published drama and season', () => {
    expect(isPubliclyPlayableEpisode(PLAYABLE)).toBe(true);
  });

  it('rejects an episode without a source', () => {
    expect(isPubliclyPlayableEpisode({ ...PLAYABLE, hasSource: false })).toBe(false);
  });

  it('rejects an unpublished episode', () => {
    expect(isPubliclyPlayableEpisode({ ...PLAYABLE, episodePublicationStatus: 'draft' })).toBe(false);
    expect(
      isPubliclyPlayableEpisode({ ...PLAYABLE, episodePublicationStatus: 'unpublished' })
    ).toBe(false);
  });

  it('rejects a trashed episode', () => {
    expect(isPubliclyPlayableEpisode({ ...PLAYABLE, episodeDeleted: true })).toBe(false);
  });

  it('rejects an episode under an unpublished drama', () => {
    expect(
      isPubliclyPlayableEpisode({ ...PLAYABLE, dramaPublicationStatus: 'draft' })
    ).toBe(false);
  });

  it('rejects an episode under a trashed drama', () => {
    expect(isPubliclyPlayableEpisode({ ...PLAYABLE, dramaDeleted: true })).toBe(false);
  });

  it('rejects an episode under an unpublished season', () => {
    expect(
      isPubliclyPlayableEpisode({ ...PLAYABLE, seasonPublicationStatus: 'draft' })
    ).toBe(false);
  });

  it('rejects an episode under a trashed season', () => {
    expect(isPubliclyPlayableEpisode({ ...PLAYABLE, seasonDeleted: true })).toBe(false);
  });

  it('rejects a season-based episode that has no season at all', () => {
    expect(
      isPubliclyPlayableEpisode({
        ...PLAYABLE,
        hasSeason: false,
        seasonPublicationStatus: null,
        seasonDeleted: false,
      })
    ).toBe(false);
  });

  it('accepts a flat episode that has no season', () => {
    expect(
      isPubliclyPlayableEpisode({
        ...PLAYABLE,
        dramaStructureType: 'flat',
        hasSeason: false,
        seasonPublicationStatus: null,
        seasonDeleted: false,
      })
    ).toBe(true);
  });
});
