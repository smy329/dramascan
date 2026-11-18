import { describe, expect, it } from 'vitest';

import {
  DRAMA_FORM_DEFAULTS,
  DRAMA_STATUS_OPTIONS,
  DRAMA_STRUCTURE_OPTIONS,
  dramaFormSchema,
} from '@/lib/contracts/drama-form';

/** A valid create payload built from the form defaults. */
function values(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...DRAMA_FORM_DEFAULTS, title: 'Seasons of Glass', slug: 'seasons-of-glass', ...overrides };
}

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
const PLATFORM_ID = '22222222-2222-4222-8222-222222222222';

describe('dramaFormSchema', () => {
  it('accepts a season-based drama with the required fields', () => {
    const parsed = dramaFormSchema.safeParse(values());

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe('ongoing');
      expect(parsed.data.structure_type).toBe('season_based');
      expect(parsed.data.poster).toBe('');
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
    ['missing slug', { slug: '' }],
    ['unknown status', { status: 'cancelled' }],
    ['unknown structure', { structure_type: 'episodic' }],
    ['invalid poster URL', { poster: 'not-a-url' }],
    ['non-uuid category', { categories: ['nope'] }],
    ['non-uuid platform', { platforms: ['nope'] }],
  ])('rejects %s', (_label, overrides) => {
    expect(dramaFormSchema.safeParse(values(overrides)).success).toBe(false);
  });

  it.each(['Upper-Case', 'trailing-', '-leading', 'with space', 'under_score'])(
    'rejects invalid slug %s',
    slug => {
      expect(dramaFormSchema.safeParse(values({ slug })).success).toBe(false);
    }
  );

  it('rejects a release-year field because the form has no such metadata', () => {
    expect(dramaFormSchema.safeParse(values({ release_year: 2024 })).success).toBe(false);
  });
});
