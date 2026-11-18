import { describe, expect, it } from 'vitest';

import {
  CATEGORY_FORM_DEFAULTS,
  CATEGORY_VISIBILITY_OPTIONS,
  PLATFORM_FORM_DEFAULTS,
  categoryFormSchema,
  platformFormSchema,
  reorderTaxonomyFormSchema,
  taxonomyIdFormSchema,
  taxonomySlugFromName,
  updateCategoryFormSchema,
  updatePlatformFormSchema,
} from '@/lib/contracts/taxonomy-form';

const ID = '11111111-1111-4111-8111-111111111111';

describe('taxonomySlugFromName', () => {
  it.each([
    ['Romance', 'romance'],
    ['Café & Crème', 'cafe-creme'],
    ['Sci-Fi', 'sci-fi'],
    ['  Period  Drama ', 'period-drama'],
  ])('derives %s as %s', (name, expected) => {
    expect(taxonomySlugFromName(name)).toBe(expected);
  });

  it('returns an empty slug for a name with no Latin characters', () => {
    expect(taxonomySlugFromName('我的家')).toBe('');
  });
});

describe('categoryFormSchema', () => {
  it('accepts a name and a visibility', () => {
    const parsed = categoryFormSchema.safeParse({ name: 'Romance', visibility: 'visible' });

    expect(parsed.success).toBe(true);
  });

  it.each([
    ['empty name', { name: '', visibility: 'visible' }],
    ['81-character name', { name: 'a'.repeat(81), visibility: 'visible' }],
    ['unknown visibility', { name: 'Romance', visibility: 'secret' }],
    ['client-supplied slug', { name: 'Romance', visibility: 'visible', slug: 'chosen' }],
  ])('rejects %s', (_label, input) => {
    expect(categoryFormSchema.safeParse(input).success).toBe(false);
  });

  it('offers visible and hidden only', () => {
    expect(CATEGORY_VISIBILITY_OPTIONS.map(option => option.value)).toEqual(['visible', 'hidden']);
    expect(CATEGORY_FORM_DEFAULTS).toEqual({ name: '', visibility: 'visible' });
  });
});

describe('platformFormSchema', () => {
  it('accepts a name and rejects a visibility, because platforms have none', () => {
    expect(platformFormSchema.safeParse({ name: 'Netflix' }).success).toBe(true);
    expect(platformFormSchema.safeParse({ name: 'Netflix', visibility: 'visible' }).success).toBe(
      false
    );
    expect(PLATFORM_FORM_DEFAULTS).toEqual({ name: '' });
  });
});

describe('taxonomy action schemas', () => {
  it('requires a uuid for update and delete payloads', () => {
    expect(
      updateCategoryFormSchema.safeParse({ id: ID, name: 'Drama', visibility: 'hidden' }).success
    ).toBe(true);
    expect(updateCategoryFormSchema.safeParse({ id: 'nope', name: 'Drama' }).success).toBe(false);
    expect(updatePlatformFormSchema.safeParse({ id: ID, name: 'Netflix' }).success).toBe(true);
    expect(taxonomyIdFormSchema.safeParse({ id: ID }).success).toBe(true);
    expect(taxonomyIdFormSchema.safeParse({ id: 'nope' }).success).toBe(false);
  });

  it('requires at least one id to reorder', () => {
    expect(reorderTaxonomyFormSchema.safeParse({ ids: [ID] }).success).toBe(true);
    expect(reorderTaxonomyFormSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(reorderTaxonomyFormSchema.safeParse({ ids: ['nope'] }).success).toBe(false);
  });
});
