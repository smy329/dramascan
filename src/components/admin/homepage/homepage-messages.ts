/**
 * The confirmation messages of the homepage settings pages.
 *
 * The pages report how many items a setting now holds, so the wording has to
 * read correctly for one item as well as for many. The text lives here, away
 * from the client components, so it can be unit-tested without a browser.
 */

/** "1 item" or "3 items". */
export function itemCountLabel(count: number): string {
  return count === 1 ? '1 item' : `${count} items`;
}

/** The message shown after the hero rotation was saved. */
export function heroRotationMessage(enabled: boolean, itemCount: number): string {
  if (!enabled) {
    return 'Hero rotation is off. The selected hero stays stable.';
  }

  return `Hero rotation is on with ${itemCountLabel(itemCount)}.`;
}

/** The message shown after the Trending pins were saved. */
export function trendingPinsMessage(itemCount: number): string {
  const verb = itemCount === 1 ? 'is' : 'are';

  return `${itemCountLabel(itemCount)} ${verb} pinned into Trending.`;
}
