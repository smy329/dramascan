import { describe, expect, it } from 'vitest';

import {
  heroRotationMessage,
  itemCountLabel,
  trendingPinsMessage,
} from '@/components/admin/homepage/homepage-messages';

/**
 * The confirmation messages of the homepage settings pages.
 *
 * The pages report how many items a setting now holds. The wording has to read
 * correctly for one item as well as for many: "1 items are pinned into
 * Trending." is the kind of small wrongness a viewer notices immediately.
 */

describe('itemCountLabel', () => {
  it('uses the singular for exactly one item', () => {
    expect(itemCountLabel(1)).toBe('1 item');
  });

  it('uses the plural for no items', () => {
    expect(itemCountLabel(0)).toBe('0 items');
  });

  it('uses the plural for more than one item', () => {
    expect(itemCountLabel(3)).toBe('3 items');
  });
});

describe('heroRotationMessage', () => {
  it('reports that the rotation is on with one item', () => {
    expect(heroRotationMessage(true, 1)).toBe('Hero rotation is on with 1 item.');
  });

  it('reports that the rotation is on with several items', () => {
    expect(heroRotationMessage(true, 4)).toBe('Hero rotation is on with 4 items.');
  });

  it('reports that the rotation is off', () => {
    expect(heroRotationMessage(false, 0)).toBe(
      'Hero rotation is off. The selected hero stays stable.'
    );
  });
});

describe('trendingPinsMessage', () => {
  it('reports one pinned item', () => {
    expect(trendingPinsMessage(1)).toBe('1 item is pinned into Trending.');
  });

  it('reports several pinned items', () => {
    expect(trendingPinsMessage(2)).toBe('2 items are pinned into Trending.');
  });

  it('reports that nothing is pinned', () => {
    expect(trendingPinsMessage(0)).toBe('0 items are pinned into Trending.');
  });
});
