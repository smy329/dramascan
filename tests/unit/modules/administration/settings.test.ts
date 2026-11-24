import { describe, expect, it } from 'vitest';

import {
  parseSettingContentRefs,
  SYSTEM_SETTING_KEYS,
} from '@/modules/administration/settings.shared';
import {
  dramaStatus,
  escapeLikeTerm,
} from '@/modules/content/public-discovery.shared';

/**
 * Pure contracts of the settings and the discovery read models.
 *
 * The setting parser reads a value that may have been written by hand, so a
 * malformed value has to degrade to "no selection" instead of breaking the
 * page that reads it. The LIKE escaping keeps a viewer's search term a
 * literal: a `%` or `_` in the term is a wildcard otherwise.
 */

describe('SYSTEM_SETTING_KEYS', () => {
  it('names the settings the homepage reads', () => {
    expect(SYSTEM_SETTING_KEYS.featuredContent).toBe('featured_content_id');
    expect(SYSTEM_SETTING_KEYS.featuredContentType).toBe('featured_content_type');
    expect(SYSTEM_SETTING_KEYS.heroRotationEnabled).toBe('hero_rotation_enabled');
    expect(SYSTEM_SETTING_KEYS.heroRotationItems).toBe('hero_rotation_item_ids');
    expect(SYSTEM_SETTING_KEYS.trendingPinnedItems).toBe('trending_pinned_item_ids');
  });
});

describe('parseSettingContentRefs', () => {
  it('reads a well-formed list', () => {
    expect(
      parseSettingContentRefs([
        { type: 'drama', id: '01900000-0000-7000-8000-000000000001' },
        { type: 'movie', id: '01900000-0000-7000-8000-000000000002' },
      ])
    ).toEqual([
      { type: 'drama', id: '01900000-0000-7000-8000-000000000001' },
      { type: 'movie', id: '01900000-0000-7000-8000-000000000002' },
    ]);
  });

  it('returns an empty list for a value that is not a list', () => {
    expect(parseSettingContentRefs(null)).toEqual([]);
    expect(parseSettingContentRefs('drama')).toEqual([]);
    expect(parseSettingContentRefs({ type: 'drama', id: 'x' })).toEqual([]);
  });

  it('skips an entry with an unknown type', () => {
    expect(
      parseSettingContentRefs([
        { type: 'episode', id: '01900000-0000-7000-8000-000000000003' },
        { type: 'drama', id: '01900000-0000-7000-8000-000000000001' },
      ])
    ).toEqual([{ type: 'drama', id: '01900000-0000-7000-8000-000000000001' }]);
  });

  it('skips an entry with a missing or empty id', () => {
    expect(
      parseSettingContentRefs([
        { type: 'drama' },
        { type: 'drama', id: '' },
        { type: 'drama', id: 42 },
        { type: 'drama', id: '01900000-0000-7000-8000-000000000001' },
      ])
    ).toEqual([{ type: 'drama', id: '01900000-0000-7000-8000-000000000001' }]);
  });

  it('skips an entry that is not an object', () => {
    expect(parseSettingContentRefs(['drama', null, 7])).toEqual([]);
  });
});

describe('escapeLikeTerm', () => {
  it('escapes the LIKE wildcards', () => {
    expect(escapeLikeTerm('100%')).toBe('100\\%');
    expect(escapeLikeTerm('a_b')).toBe('a\\_b');
    expect(escapeLikeTerm('c\\d')).toBe('c\\\\d');
  });

  it('leaves an ordinary term untouched', () => {
    expect(escapeLikeTerm('Winter Sonata')).toBe('Winter Sonata');
  });
});

describe('dramaStatus', () => {
  it('keeps the two public lifecycle values', () => {
    expect(dramaStatus('ongoing')).toBe('ongoing');
    expect(dramaStatus('completed')).toBe('completed');
  });

  it('returns null for a value the public does not show', () => {
    expect(dramaStatus('coming_soon')).toBeNull();
    expect(dramaStatus(null)).toBeNull();
  });
});
