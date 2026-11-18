import { describe, expect, it } from 'vitest';

import {
  createCategorySchema,
  createPlatformSchema,
  updateCategorySchema,
  updatePlatformSchema,
} from '@/modules/content/validation';

describe('createCategorySchema', () => {
  it('trims the name and defaults visibility to visible', () => {
    const parsed = createCategorySchema.parse({ name: '  Romance  ' });

    expect(parsed).toEqual({ name: 'Romance', visibility: 'visible' });
  });

  it('keeps an explicit visibility', () => {
    expect(createCategorySchema.parse({ name: 'Romance', visibility: 'hidden' }).visibility).toBe(
      'hidden'
    );
  });

  it.each([
    ['empty name', { name: '' }],
    ['81-character name', { name: 'a'.repeat(81) }],
    ['unknown visibility', { name: 'Romance', visibility: 'secret' }],
    ['client-supplied slug', { name: 'Romance', slug: 'chosen' }],
  ])('rejects %s', (_label, input) => {
    expect(createCategorySchema.safeParse(input).success).toBe(false);
  });
});

describe('updateCategorySchema', () => {
  it('accepts a partial update', () => {
    expect(updateCategorySchema.safeParse({}).success).toBe(true);
    expect(updateCategorySchema.safeParse({ visibility: 'hidden' }).success).toBe(true);
  });

  it('still rejects an unknown visibility', () => {
    expect(updateCategorySchema.safeParse({ visibility: 'visible ' }).success).toBe(false);
  });
});

describe('createPlatformSchema', () => {
  it('accepts a name and rejects the keys platforms do not have', () => {
    expect(createPlatformSchema.parse({ name: ' Netflix ' })).toEqual({ name: 'Netflix' });
    expect(createPlatformSchema.safeParse({ name: 'Netflix', visibility: 'visible' }).success).toBe(
      false
    );
    expect(createPlatformSchema.safeParse({ name: 'Netflix', slug: 'netflix' }).success).toBe(false);
  });
});

describe('updatePlatformSchema', () => {
  it('accepts a partial update and rejects an empty name', () => {
    expect(updatePlatformSchema.safeParse({}).success).toBe(true);
    expect(updatePlatformSchema.safeParse({ name: '' }).success).toBe(false);
  });
});
