import { describe, expect, it } from 'vitest';

import {
  DRAMA_FORM_DEFAULTS,
  DRAMA_SLUG_MAX_LENGTH,
  DRAMA_STATUS_OPTIONS,
  DRAMA_STRUCTURE_OPTIONS,
  dramaFormSchema,
  dramaSlugFromTitle,
} from '@/lib/contracts/drama-form';

/** A valid create payload built from the form defaults. */
function values(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...DRAMA_FORM_DEFAULTS, title: 'Seasons of Glass', ...overrides };
}

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
const PLATFORM_ID = '22222222-2222-4222-8222-222222222222';

describe('dramaSlugFromTitle', () => {
  it.each([
    ['This Is My Home', 'this-is-my-home'],
    ['  Spaced   Out  ', 'spaced-out'],
    ['Café & Crème!', 'cafe-creme'],
    ["Don't Stop", 'dont-stop'],
    ['A--B__C', 'a-b-c'],
    ['Season 2 (Finale)', 'season-2-finale'],
    ['2026', '2026'],
  ])('derives %s as %s', (title, expected) => {
    expect(dramaSlugFromTitle(title)).toBe(expected);
  });

  it('returns an empty slug for a title with no Latin characters', () => {
    expect(dramaSlugFromTitle('我的家')).toBe('');
    expect(dramaSlugFromTitle('!!!')).toBe('');
  });

  it('caps the slug at the domain maximum without a trailing hyphen', () => {
    const long = 'a'.repeat(DRAMA_SLUG_MAX_LENGTH) + ' overflow';
    const slug = dramaSlugFromTitle(long);

    expect(slug).toHaveLength(DRAMA_SLUG_MAX_LENGTH);
    expect(slug.endsWith('-')).toBe(false);

    const boundary = `${'a'.repeat(DRAMA_SLUG_MAX_LENGTH - 1)} tail`;
    expect(dramaSlugFromTitle(boundary).endsWith('-')).toBe(false);
  });
});

describe('dramaFormSchema', () => {
  it('accepts a season-based drama with the required fields', () => {
    const parsed = dramaFormSchema.safeParse(values());

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe('ongoing');
      expect(parsed.data.structure_type).toBe('season_based');
      expect(parsed.data.poster).toBe('');
      expect('slug' in parsed.data).toBe(false);
    }
  });

  it.each(DRAMA_STATUS_OPTIONS.map(option => option.value))('accepts status %s', status => {
    expect(dramaFormSchema.safeParse(values({ status })).success).toBe(true);
  });

  it.each(DRAMA_STRUCTURE_OPTIONS.map(option => option.value))(
    'accepts structure %s',
    structure_type => {
      expect(dramaFormSchema.safeParse(values({ structure_type })).success).toBe(true);
    }
  );

  it('accepts associations and absolute media URLs', () => {
    const parsed = dramaFormSchema.safeParse(
      values({
        poster: 'https://cdn.example.com/poster.jpg',
        banner: 'https://cdn.example.com/banner.jpg',
        categories: [CATEGORY_ID],
        platforms: [PLATFORM_ID],
      })
    );

    expect(parsed.success).toBe(true);
  });

  it.each([
    ['missing title', { title: '' }],
    ['unknown status', { status: 'cancelled' }],
    ['unknown structure', { structure_type: 'episodic' }],
    ['invalid poster URL', { poster: 'not-a-url' }],
    ['non-uuid category', { categories: ['nope'] }],
    ['non-uuid platform', { platforms: ['nope'] }],
  ])('rejects %s', (_label, overrides) => {
    expect(dramaFormSchema.safeParse(values(overrides)).success).toBe(false);
  });

  it('rejects a client-supplied slug because the slug is derived', () => {
    expect(dramaFormSchema.safeParse(values({ slug: 'chosen-by-client' })).success).toBe(false);
  });

  it('rejects a title that cannot produce a slug and reports it on the title', () => {
    const parsed = dramaFormSchema.safeParse(values({ title: '我的家' }));

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(['title']);
    }
  });

  it('rejects a release-year field because the form has no such metadata', () => {
    expect(dramaFormSchema.safeParse(values({ release_year: 2024 })).success).toBe(false);
  });
});
