import { describe, expect, it } from 'vitest';

import {
  PUBLICATION_STATUSES,
  evaluatePublicationEligibility,
  evaluatePublicAvailability,
  isPublicationReadySource,
  normalizePublicationStatus,
  type PublicationStatus,
} from '@/modules/content/publication';

const VALID_SOURCE = 'https://media.example.com/episodes/1.mp4';

describe('normalizePublicationStatus', () => {
  it.each([null, undefined, '', 'ongoing', 'completed', 'bogus'])(
    'maps legacy or unknown value %p to draft',
    value => {
      expect(normalizePublicationStatus(value)).toBe('draft');
    }
  );

  it('passes through the canonical states', () => {
    for (const status of PUBLICATION_STATUSES) {
      expect(normalizePublicationStatus(status)).toBe(status);
    }
  });
});

describe('isPublicationReadySource', () => {
  it('accepts an absolute HTTPS .mp4 URL with a query string', () => {
    expect(isPublicationReadySource('https://media.example.com/a.MP4?token=1')).toBe(true);
  });

  it.each([
    'http://media.example.com/a.mp4',
    'https://user:pass@media.example.com/a.mp4',
    'https://media.example.com/a.mov',
    'https://media.example.com/a',
    'not a url',
  ])('rejects %s', value => {
    expect(isPublicationReadySource(value)).toBe(false);
  });

  it('rejects a null source', () => {
    expect(isPublicationReadySource(null)).toBe(false);
  });
});

describe('evaluatePublicationEligibility', () => {
  it.each(['drama', 'season'] as const)('publishes a %s from draft or unpublished', contentType => {
    for (const publicationStatus of ['draft', 'unpublished'] as const) {
      expect(
        evaluatePublicationEligibility({
          contentType,
          action: 'publish',
          publicationStatus,
          videoSource: null,
        }).eligible
      ).toBe(true);
    }
  });

  it.each(['drama', 'season', 'episode', 'movie'] as const)(
    'reports an already-published %s',
    contentType => {
      expect(
        evaluatePublicationEligibility({
          contentType,
          action: 'publish',
          publicationStatus: 'published',
          videoSource: VALID_SOURCE,
        })
      ).toEqual({ eligible: false, reason: 'already_published', message: expect.any(String) });
    }
  );

  it('requires a source for episode publication', () => {
    expect(
      evaluatePublicationEligibility({
        contentType: 'episode',
        action: 'publish',
        publicationStatus: 'draft',
        videoSource: null,
      })
    ).toEqual({ eligible: false, reason: 'missing_source', message: expect.any(String) });
  });

  it('rejects an invalid episode source', () => {
    expect(
      evaluatePublicationEligibility({
        contentType: 'episode',
        action: 'publish',
        publicationStatus: 'draft',
        videoSource: 'http://media.example.com/1.mp4',
      })
    ).toEqual({ eligible: false, reason: 'invalid_source', message: expect.any(String) });
  });

  it('accepts a valid episode source', () => {
    expect(
      evaluatePublicationEligibility({
        contentType: 'episode',
        action: 'publish',
        publicationStatus: 'draft',
        videoSource: VALID_SOURCE,
      }).eligible
    ).toBe(true);
  });

  it('requires a source for movie publication', () => {
    expect(
      evaluatePublicationEligibility({
        contentType: 'movie',
        action: 'publish',
        publicationStatus: 'draft',
        videoSource: null,
      }).reason
    ).toBe('missing_source');
  });

  it('does not require a source for drama publication', () => {
    expect(
      evaluatePublicationEligibility({
        contentType: 'drama',
        action: 'publish',
        publicationStatus: 'draft',
        videoSource: null,
      }).eligible
    ).toBe(true);
  });

  it.each(['drama', 'season', 'episode', 'movie'] as const)(
    'unpublishes a %s without checking its source',
    contentType => {
      const result = evaluatePublicationEligibility({
        contentType,
        action: 'unpublish',
        publicationStatus: 'published',
        videoSource: null,
      });

      expect(result.eligible).toBe(true);
    }
  );

  it('reports an already-unpublished item', () => {
    expect(
      evaluatePublicationEligibility({
        contentType: 'drama',
        action: 'unpublish',
        publicationStatus: 'unpublished',
        videoSource: null,
      }).reason
    ).toBe('already_unpublished');
  });
});

describe('evaluatePublicAvailability', () => {
  const published: PublicationStatus = 'published';

  it('makes a published drama available', () => {
    const result = evaluatePublicAvailability({
      contentType: 'drama',
      publicationStatus: published,
      deleted: false,
    });

    expect(result).toEqual({ publiclyAvailable: true, blockers: [] });
  });

  it('hides a draft or unpublished drama', () => {
    for (const publicationStatus of ['draft', 'unpublished'] as const) {
      const result = evaluatePublicAvailability({
        contentType: 'drama',
        publicationStatus,
        deleted: false,
      });

      expect(result.publiclyAvailable).toBe(false);
      expect(result.blockers).toContain('not_published');
    }
  });

  it('hides a trashed published drama', () => {
    const result = evaluatePublicAvailability({
      contentType: 'drama',
      publicationStatus: published,
      deleted: true,
    });

    expect(result.publiclyAvailable).toBe(false);
    expect(result.blockers).toContain('trashed');
  });

  it('requires the season and its drama to be published', () => {
    expect(
      evaluatePublicAvailability({
        contentType: 'season',
        publicationStatus: published,
        deleted: false,
        parentDrama: { publicationStatus: published, deleted: false },
      }).publiclyAvailable
    ).toBe(true);

    expect(
      evaluatePublicAvailability({
        contentType: 'season',
        publicationStatus: published,
        deleted: false,
        parentDrama: { publicationStatus: 'draft', deleted: false },
      }).blockers
    ).toContain('parent_not_published');
  });

  it('requires the episode, its drama, and its season to be published', () => {
    expect(
      evaluatePublicAvailability({
        contentType: 'episode',
        publicationStatus: published,
        deleted: false,
        parentDrama: { publicationStatus: published, deleted: false },
        parentSeason: { publicationStatus: published, deleted: false },
      }).publiclyAvailable
    ).toBe(true);

    expect(
      evaluatePublicAvailability({
        contentType: 'episode',
        publicationStatus: published,
        deleted: false,
        parentDrama: { publicationStatus: published, deleted: false },
        parentSeason: { publicationStatus: 'unpublished', deleted: false },
      }).blockers
    ).toContain('season_not_published');
  });

  it('gates a seasonless episode on the drama alone', () => {
    expect(
      evaluatePublicAvailability({
        contentType: 'episode',
        publicationStatus: published,
        deleted: false,
        parentDrama: { publicationStatus: published, deleted: false },
        parentSeason: null,
      }).publiclyAvailable
    ).toBe(true);

    expect(
      evaluatePublicAvailability({
        contentType: 'episode',
        publicationStatus: published,
        deleted: false,
        parentDrama: { publicationStatus: 'draft', deleted: false },
        parentSeason: null,
      }).blockers
    ).toContain('parent_not_published');
  });

  it('blocks when any ancestor is trashed', () => {
    expect(
      evaluatePublicAvailability({
        contentType: 'episode',
        publicationStatus: published,
        deleted: false,
        parentDrama: { publicationStatus: published, deleted: true },
        parentSeason: { publicationStatus: published, deleted: false },
      }).blockers
    ).toContain('trashed');
  });

  it('makes a published movie available', () => {
    expect(
      evaluatePublicAvailability({
        contentType: 'movie',
        publicationStatus: published,
        deleted: false,
      }).publiclyAvailable
    ).toBe(true);
  });

  it('hides an unpublished movie', () => {
    expect(
      evaluatePublicAvailability({
        contentType: 'movie',
        publicationStatus: 'draft',
        deleted: false,
      }).publiclyAvailable
    ).toBe(false);
  });
});
