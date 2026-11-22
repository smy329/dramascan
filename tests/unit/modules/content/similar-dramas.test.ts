import { describe, expect, it } from 'vitest';

import {
  SIMILAR_DRAMA_SCORE_WEIGHTS,
  rankSimilarDramaSuggestions,
  scoreSimilarDramaCandidate,
  type SimilarDramaCandidate,
  type SimilarDramaSource,
} from '@/modules/content/similar-dramas.shared';

/**
 * Automatic similar-drama relevance.
 *
 * The score is an aid, not a decision: the rules are pinned here so a change
 * in weights or exclusions is always a deliberate, reviewed change.
 */

const source: SimilarDramaSource = {
  id: '01900000-0000-7000-8000-000000000001',
  status: 'ongoing',
  structureType: 'seasoned',
  categoryIds: ['cat-romance', 'cat-drama'],
  platformIds: ['plat-netflix'],
};

function candidate(overrides: Partial<SimilarDramaCandidate> = {}): SimilarDramaCandidate {
  return {
    id: '01900000-0000-7000-8000-000000000002',
    title: 'Seasons of Glass',
    poster: null,
    description: null,
    status: 'ongoing',
    structureType: 'seasoned',
    categoryIds: ['cat-romance'],
    platformIds: ['plat-netflix'],
    ...overrides,
  };
}

describe('scoreSimilarDramaCandidate', () => {
  it('scores shared categories, platforms, status, and structure', () => {
    const suggestion = scoreSimilarDramaCandidate(source, candidate());

    expect(suggestion).toEqual({
      id: '01900000-0000-7000-8000-000000000002',
      title: 'Seasons of Glass',
      poster: null,
      description: null,
      sharedCategories: 1,
      sharedPlatforms: 1,
      score:
        SIMILAR_DRAMA_SCORE_WEIGHTS.category +
        SIMILAR_DRAMA_SCORE_WEIGHTS.platform +
        SIMILAR_DRAMA_SCORE_WEIGHTS.status +
        SIMILAR_DRAMA_SCORE_WEIGHTS.structureType,
    });
  });

  it('never recommends a drama to itself', () => {
    expect(scoreSimilarDramaCandidate(source, candidate({ id: source.id }))).toBeNull();
  });

  it('ignores a candidate that shares nothing', () => {
    const suggestion = scoreSimilarDramaCandidate(
      source,
      candidate({
        status: 'completed',
        structureType: 'flat',
        categoryIds: ['cat-horror'],
        platformIds: ['plat-other'],
      })
    );

    expect(suggestion).toBeNull();
  });

  it('weights categories above platforms and metadata', () => {
    const categoryOnly = scoreSimilarDramaCandidate(
      source,
      candidate({
        status: 'completed',
        structureType: 'flat',
        categoryIds: ['cat-romance'],
        platformIds: [],
      })
    );
    const platformOnly = scoreSimilarDramaCandidate(
      source,
      candidate({
        status: 'completed',
        structureType: 'flat',
        categoryIds: [],
        platformIds: ['plat-netflix'],
      })
    );

    expect(categoryOnly?.score).toBeGreaterThan(platformOnly?.score ?? 0);
  });

  it('does not award a status match when either status is unknown', () => {
    const suggestion = scoreSimilarDramaCandidate(
      { ...source, status: null },
      candidate({
        status: 'ongoing',
        structureType: 'seasoned',
        categoryIds: [],
        platformIds: [],
      })
    );

    expect(suggestion?.score).toBe(SIMILAR_DRAMA_SCORE_WEIGHTS.structureType);
  });
});

describe('rankSimilarDramaSuggestions', () => {
  it('orders by score, then title, then id', () => {
    const ranked = rankSimilarDramaSuggestions(source, [
      candidate({
        id: '01900000-0000-7000-8000-000000000003',
        title: 'Beta',
        categoryIds: [],
        platformIds: ['plat-netflix'],
        status: 'completed',
        structureType: 'flat',
      }),
      candidate({
        id: '01900000-0000-7000-8000-000000000004',
        title: 'Alpha',
        categoryIds: [],
        platformIds: ['plat-netflix'],
        status: 'completed',
        structureType: 'flat',
      }),
      candidate({
        id: '01900000-0000-7000-8000-000000000005',
        title: 'Gamma',
        categoryIds: ['cat-drama', 'cat-romance'],
        platformIds: ['plat-netflix'],
      }),
    ]);

    expect(ranked.map(item => item.title)).toEqual(['Gamma', 'Alpha', 'Beta']);
  });

  it('excludes self-recommendations and unrelated dramas', () => {
    const ranked = rankSimilarDramaSuggestions(source, [
      candidate({ id: source.id }),
      candidate({
        id: '01900000-0000-7000-8000-000000000006',
        title: 'Unrelated',
        categoryIds: ['cat-horror'],
        platformIds: ['plat-other'],
        status: 'completed',
        structureType: 'flat',
      }),
    ]);

    expect(ranked).toEqual([]);
  });

  it('respects the requested limit', () => {
    const ranked = rankSimilarDramaSuggestions(
      source,
      [
        candidate({ id: '01900000-0000-7000-8000-000000000007', title: 'One' }),
        candidate({ id: '01900000-0000-7000-8000-000000000008', title: 'Two' }),
      ],
      { limit: 1 }
    );

    expect(ranked).toHaveLength(1);
  });
});
