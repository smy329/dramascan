import { describe, expect, it } from 'vitest';

import {
  nextPublicEpisode,
  previousPublicEpisode,
  publicEpisodeHref,
  type PublicEpisodeSummary,
} from '@/modules/content/public-episodes.shared';

/**
 * The published content order.
 *
 * "Next episode" has to follow the real content order — season by season,
 * episode by episode — and it may only ever name an episode the public may
 * play. The list these helpers receive is already filtered and ordered by the
 * public episode service, so the helpers only have to find the neighbours.
 */
function episode(
  id: string,
  episodeNumber: number,
  seasonTitle: string | null = 'Season 1'
): PublicEpisodeSummary {
  return {
    id,
    dramaId: 'drama-id',
    dramaSlug: 'the-drama',
    dramaTitle: 'The Drama',
    seasonId: seasonTitle === null ? null : `season-${seasonTitle}`,
    seasonTitle,
    seasonPosition: seasonTitle === null ? null : 1,
    title: `Episode ${episodeNumber}`,
    description: null,
    episodeNumber,
    position: episodeNumber - 1,
    href: publicEpisodeHref('drama-id', 'the-drama', id),
  };
}

const EPISODES = [episode('e1', 1), episode('e2', 2), episode('e3', 3)];

describe('nextPublicEpisode', () => {
  it('returns the episode that follows in the content order', () => {
    expect(nextPublicEpisode(EPISODES, 'e1')?.id).toBe('e2');
  });

  it('returns null for the last episode', () => {
    expect(nextPublicEpisode(EPISODES, 'e3')).toBeNull();
  });

  it('returns null for an episode that is not in the list', () => {
    expect(nextPublicEpisode(EPISODES, 'missing')).toBeNull();
  });

  it('does not skip to another season', () => {
    const crossSeason = [
      episode('s1e1', 1, 'Season 1'),
      episode('s2e1', 1, 'Season 2'),
    ];

    // The public list only contains playable episodes, so the next episode is
    // simply the next entry — even when the season changes.
    expect(nextPublicEpisode(crossSeason, 's1e1')?.id).toBe('s2e1');
  });
});

describe('previousPublicEpisode', () => {
  it('returns the episode that precedes in the content order', () => {
    expect(previousPublicEpisode(EPISODES, 'e2')?.id).toBe('e1');
  });

  it('returns null for the first episode', () => {
    expect(previousPublicEpisode(EPISODES, 'e1')).toBeNull();
  });

  it('returns null for an episode that is not in the list', () => {
    expect(previousPublicEpisode(EPISODES, 'missing')).toBeNull();
  });
});

describe('publicEpisodeHref', () => {
  it('builds the canonical episode route', () => {
    expect(publicEpisodeHref('drama-id', 'the-drama', 'episode-id')).toBe(
      '/drama/drama-id/the-drama/episode/episode-id'
    );
  });
});
