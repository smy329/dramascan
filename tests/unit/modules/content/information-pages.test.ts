import { describe, expect, it } from 'vitest';

import {
  INFORMATION_PAGE_DEFINITIONS,
  buildFooterInformationLinks,
  informationPageHref,
  isValidInformationPageSlug,
  parseInformationPageId,
  parseListInformationPagesQuery,
  reorderInformationPagesSchema,
  updateInformationPageSchema,
} from '@/modules/content/information-pages.shared';
import { ValidationError } from '@/platform/errors';

const VALID_UUID = '0198f3a2-0000-7000-8000-000000000001';
const OTHER_UUID = '0198f3a2-0000-7000-8000-000000000002';

describe('information page slugs', () => {
  it('defines exactly the six canonical pages with stable positions', () => {
    expect(INFORMATION_PAGE_DEFINITIONS).toHaveLength(6);
    expect(INFORMATION_PAGE_DEFINITIONS.map(page => page.slug)).toEqual([
      'terms',
      'privacy',
      'community-guidelines',
      'copyright-dmca',
      'about',
      'contact',
    ]);
    expect(INFORMATION_PAGE_DEFINITIONS.map(page => page.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(INFORMATION_PAGE_DEFINITIONS.map(page => page.slug)).size).toBe(6);
  });

  it.each(['terms', 'community-guidelines', 'copyright-dmca', 'a1', 'a-b-c'])(
    'accepts URL-safe slug %s',
    slug => {
      expect(isValidInformationPageSlug(slug)).toBe(true);
    }
  );

  it.each([
    ['', 'empty'],
    ['Terms', 'uppercase'],
    ['community guidelines', 'space'],
    ['community/guidelines', 'slash'],
    ['-terms', 'leading hyphen'],
    ['terms-', 'trailing hyphen'],
    ['terms--privacy', 'double hyphen'],
    ['terms?draft=true', 'query string'],
    ['ä-terms', 'non-ascii'],
    ['a'.repeat(101), 'too long'],
  ])('rejects %s (%s)', slug => {
    expect(isValidInformationPageSlug(slug)).toBe(false);
  });

  it('builds the canonical public route from the slug', () => {
    expect(informationPageHref('terms')).toBe('/information/terms');
    expect(informationPageHref('community-guidelines')).toBe('/information/community-guidelines');
  });
});

describe('buildFooterInformationLinks', () => {
  const baseRow = {
    id: 'page-1',
    title: 'Terms of Service',
    slug: 'terms',
    publication_status: 'published',
    footer_visible: true,
  };

  it('maps visible, published rows to ordered footer links', () => {
    const links = buildFooterInformationLinks([
      baseRow,
      { ...baseRow, id: 'page-2', title: 'Privacy Policy', slug: 'privacy' },
    ]);

    expect(links).toEqual([
      {
        id: 'page-1',
        slug: 'terms',
        label: 'Terms of Service',
        href: '/information/terms',
      },
      {
        id: 'page-2',
        slug: 'privacy',
        label: 'Privacy Policy',
        href: '/information/privacy',
      },
    ]);
  });

  it('drops unpublished, hidden, and malformed rows', () => {
    const links = buildFooterInformationLinks([
      baseRow,
      { ...baseRow, id: 'draft', slug: 'draft-page', publication_status: 'draft' },
      { ...baseRow, id: 'null-status', slug: 'null-status', publication_status: null },
      { ...baseRow, id: 'hidden', slug: 'hidden-page', footer_visible: false },
      { ...baseRow, id: 'null-visible', slug: 'null-visible', footer_visible: null },
      { ...baseRow, id: 'bad-slug', slug: 'Bad Slug' },
      { ...baseRow, id: 'query-slug', slug: 'terms?preview=1' },
    ]);

    expect(links.map(link => link.id)).toEqual(['page-1']);
  });

  it('returns an empty list when configuration is missing', () => {
    expect(buildFooterInformationLinks([])).toEqual([]);
  });
});

describe('updateInformationPageSchema', () => {
  it('accepts a single editable field and trims the title', () => {
    const parsed = updateInformationPageSchema.parse({ title: '  About us  ' });
    expect(parsed).toEqual({ title: 'About us' });
  });

  it('accepts every editable field', () => {
    const parsed = updateInformationPageSchema.parse({
      title: 'Privacy Policy',
      content: 'This page is being prepared.',
      publicationStatus: 'published',
      footerVisible: true,
      position: 2,
    });

    expect(parsed).toEqual({
      title: 'Privacy Policy',
      content: 'This page is being prepared.',
      publicationStatus: 'published',
      footerVisible: true,
      position: 2,
    });
  });

  it('rejects an empty update', () => {
    expect(updateInformationPageSchema.safeParse({}).success).toBe(false);
  });

  it('rejects unknown fields so arbitrary columns cannot be written', () => {
    expect(updateInformationPageSchema.safeParse({ slug: 'new-slug' }).success).toBe(false);
    expect(updateInformationPageSchema.safeParse({ deletedAt: new Date() }).success).toBe(false);
  });

  it('rejects invalid publication states and positions', () => {
    expect(updateInformationPageSchema.safeParse({ publicationStatus: 'live' }).success).toBe(false);
    expect(updateInformationPageSchema.safeParse({ position: -1 }).success).toBe(false);
    expect(updateInformationPageSchema.safeParse({ position: 1.5 }).success).toBe(false);
  });

  it('rejects blank titles and empty content', () => {
    expect(updateInformationPageSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(updateInformationPageSchema.safeParse({ content: '' }).success).toBe(false);
  });
});

describe('reorderInformationPagesSchema', () => {
  it('accepts a unique ordered id list', () => {
    const parsed = reorderInformationPagesSchema.parse({ ids: [VALID_UUID, OTHER_UUID] });
    expect(parsed.ids).toEqual([VALID_UUID, OTHER_UUID]);
  });

  it('rejects empty, duplicate, and malformed id lists', () => {
    expect(reorderInformationPagesSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(reorderInformationPagesSchema.safeParse({ ids: [VALID_UUID, VALID_UUID] }).success).toBe(
      false
    );
    expect(reorderInformationPagesSchema.safeParse({ ids: ['not-a-uuid'] }).success).toBe(false);
  });
});

describe('parseListInformationPagesQuery', () => {
  it('defaults to the first page and twenty rows', () => {
    expect(parseListInformationPagesQuery({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('accepts numeric query strings', () => {
    expect(parseListInformationPagesQuery({ page: '2', pageSize: '50' })).toEqual({
      page: 2,
      pageSize: 50,
    });
  });

  it('rejects out-of-range paging with a validation error', () => {
    expect(() => parseListInformationPagesQuery({ page: '0' })).toThrow(ValidationError);
    expect(() => parseListInformationPagesQuery({ pageSize: '101' })).toThrow(ValidationError);
    expect(() => parseListInformationPagesQuery({ pageSize: 'many' })).toThrow(ValidationError);
  });

  it('rejects unknown query parameters', () => {
    expect(() => parseListInformationPagesQuery({ sort: 'title' })).toThrow(ValidationError);
  });
});

describe('parseInformationPageId', () => {
  it('accepts a UUID and rejects arbitrary route text', () => {
    expect(parseInformationPageId(VALID_UUID)).toBe(VALID_UUID);
    expect(() => parseInformationPageId('reorder')).toThrow(ValidationError);
  });
});
