import { describe, expect, it } from 'vitest';

import { ValidationError } from '@/platform/errors';
import {
  PUBLIC_DRAMA_PAGE_SIZE_DEFAULT,
  PUBLIC_DRAMA_PAGE_SIZE_MAX,
  evaluatePublicDramaDiscovery,
  parsePublicDramaListQuery,
  publicDramaHref,
  toPublicDramaSummary,
  type PublicDramaRow,
} from '@/modules/content/public-dramas.shared';

/**
 * Pure public-catalogue contracts.
 *
 * The hierarchy-aware SQL is exercised by the PostgreSQL integration suite;
 * these cases pin the rules, the wire DTO, and the accepted query surface so an
 * SQL drift cannot silently change the public contract.
 */

const DRAMA_ID = '01900000-0000-7000-8000-000000000001';

function row(overrides: Partial<PublicDramaRow> = {}): PublicDramaRow {
  return {
    id: DRAMA_ID,
    title: 'Seasons of Glass',
    slug: 'seasons-of-glass',
    description: 'A family saga.',
    poster: 'https://media.example.com/posters/glass.jpg',
    banner: null,
    status: 'ongoing',
    visibility: 'coming_soon',
    publicationStatus: 'published',
    deleted: false,
    hasPlayableEpisode: false,
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    updatedAt: new Date('2026-01-03T04:05:06.000Z'),
    ...overrides,
  };
}

describe('publicDramaHref', () => {
  it('uses the canonical stable-id and slug route', () => {
    expect(publicDramaHref(DRAMA_ID, 'seasons-of-glass')).toBe(
      `/drama/${DRAMA_ID}/seasons-of-glass`
    );
  });
});

describe('parsePublicDramaListQuery', () => {
  it('defaults to the first page with the default page size', () => {
    expect(parsePublicDramaListQuery({})).toEqual({
      page: 1,
      pageSize: PUBLIC_DRAMA_PAGE_SIZE_DEFAULT,
    });
  });

  it('coerces numeric query strings', () => {
    expect(parsePublicDramaListQuery({ page: '3', pageSize: '50' })).toEqual({
      page: 3,
      pageSize: 50,
    });
  });

  it('accepts the maximum page size', () => {
    expect(parsePublicDramaListQuery({ pageSize: String(PUBLIC_DRAMA_PAGE_SIZE_MAX) })).toEqual({
      page: 1,
      pageSize: PUBLIC_DRAMA_PAGE_SIZE_MAX,
    });
  });

  it.each(['0', '101', '1.5', 'abc', '-1', ''])('rejects an invalid page size: %p', value => {
    expect(() => parsePublicDramaListQuery({ pageSize: value })).toThrow(ValidationError);
  });

  it.each(['0', '-2', '1.5', 'abc', ''])('rejects an invalid page: %p', value => {
    expect(() => parsePublicDramaListQuery({ page: value })).toThrow(ValidationError);
  });

  it('ignores caller-supplied visibility and publication filters', () => {
    expect(
      parsePublicDramaListQuery({
        page: '1',
        pageSize: '20',
        visibility: 'hidden',
        publication_status: 'draft',
      })
    ).toEqual({ page: 1, pageSize: 20 });
  });
});

describe('evaluatePublicDramaDiscovery', () => {
  const base = {
    publicationStatus: 'published',
    deleted: false,
    visibility: 'coming_soon',
    hasPlayableEpisode: false,
  } as const;

  it.each(['draft', 'unpublished', null, 'legacy'] as const)(
    'excludes content whose own status is %p',
    publicationStatus => {
      const result = evaluatePublicDramaDiscovery({ ...base, publicationStatus });
      expect(result).toMatchObject({ discoverable: false, comingSoon: false });
    }
  );

  it('excludes trashed content even when it is published', () => {
    expect(evaluatePublicDramaDiscovery({ ...base, deleted: true })).toMatchObject({
      discoverable: false,
      comingSoon: false,
    });
  });

  it('shows a coming-soon drama without a playable episode', () => {
    expect(evaluatePublicDramaDiscovery(base)).toEqual({
      discoverable: true,
      comingSoon: true,
      reason: 'coming_soon',
    });
  });

  it('treats a null visibility as the Show Coming Soon default', () => {
    expect(evaluatePublicDramaDiscovery({ ...base, visibility: null })).toEqual({
      discoverable: true,
      comingSoon: true,
      reason: 'coming_soon',
    });
  });

  it('marks a drama with a playable episode as available', () => {
    expect(evaluatePublicDramaDiscovery({ ...base, hasPlayableEpisode: true })).toEqual({
      discoverable: true,
      comingSoon: false,
      reason: 'available',
    });
  });

  it('hides a hidden drama until a playable episode exists', () => {
    expect(evaluatePublicDramaDiscovery({ ...base, visibility: 'hidden' })).toEqual({
      discoverable: false,
      comingSoon: false,
      reason: 'hidden_until_available',
    });
  });

  it('reveals a hidden drama once a playable episode exists', () => {
    expect(
      evaluatePublicDramaDiscovery({
        ...base,
        visibility: 'hidden',
        hasPlayableEpisode: true,
      })
    ).toEqual({ discoverable: true, comingSoon: false, reason: 'available' });
  });
});

describe('toPublicDramaSummary', () => {
  it('emits the explicit camelCase public DTO', () => {
    const summary = toPublicDramaSummary(row());

    expect(summary).toEqual({
      id: DRAMA_ID,
      title: 'Seasons of Glass',
      slug: 'seasons-of-glass',
      description: 'A family saga.',
      poster: 'https://media.example.com/posters/glass.jpg',
      banner: null,
      href: `/drama/${DRAMA_ID}/seasons-of-glass`,
      status: 'ongoing',
      comingSoon: true,
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-01-03T04:05:06.000Z',
    });
  });

  it('never leaks raw snake_case columns or publication/source state', () => {
    const keys = Object.keys(toPublicDramaSummary(row())).sort();

    expect(keys).toEqual([
      'banner',
      'comingSoon',
      'createdAt',
      'description',
      'href',
      'id',
      'poster',
      'slug',
      'status',
      'title',
      'updatedAt',
    ]);
  });

  it('reports an available drama when a playable episode exists', () => {
    expect(toPublicDramaSummary(row({ hasPlayableEpisode: true })).comingSoon).toBe(false);
  });

  it('maps unknown legacy statuses to null instead of inventing one', () => {
    expect(toPublicDramaSummary(row({ status: 'archived' })).status).toBeNull();
    expect(toPublicDramaSummary(row({ status: null })).status).toBeNull();
  });
});
