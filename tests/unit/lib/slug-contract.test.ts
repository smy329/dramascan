import { describe, expect, it } from 'vitest';

import { DRAMA_SLUG_MAX_LENGTH, dramaSlugFromTitle } from '@/lib/contracts/drama-form';
import { SLUG_MAX_LENGTH, slugFromText } from '@/lib/contracts/slug';

describe('slugFromText', () => {
  it.each([
    ['This Is My Home', 'this-is-my-home'],
    ['  Spaced   Out  ', 'spaced-out'],
    ['Café & Crème!', 'cafe-creme'],
    ["Don't Stop", 'dont-stop'],
    ['A--B__C', 'a-b-c'],
    ['Season 2 (Finale)', 'season-2-finale'],
    ['2026', '2026'],
  ])('derives %s as %s', (input, expected) => {
    expect(slugFromText(input)).toBe(expected);
  });

  it('returns an empty slug when no Latin characters remain', () => {
    expect(slugFromText('我的家')).toBe('');
    expect(slugFromText('!!!')).toBe('');
  });

  it('caps the slug at the maximum length without a trailing hyphen', () => {
    const slug = slugFromText(`${'a'.repeat(SLUG_MAX_LENGTH - 1)} tail`);

    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('keeps the drama helpers working through the shared rule', () => {
    expect(DRAMA_SLUG_MAX_LENGTH).toBe(SLUG_MAX_LENGTH);
    expect(dramaSlugFromTitle('Café & Crème!')).toBe(slugFromText('Café & Crème!'));
    expect(dramaSlugFromTitle('This Is My Home')).toBe('this-is-my-home');
  });
});
