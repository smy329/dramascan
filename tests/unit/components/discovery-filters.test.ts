import { describe, expect, it } from 'vitest';

import { buildDiscoveryHref } from '@/components/public/discovery-filters';

/**
 * The discovery URL builder.
 *
 * Every filter combination is a real URL, so the builder has to preserve the
 * filters that are already applied and reset the pager whenever a filter
 * changes — a filter that kept the old page number would land the viewer on
 * an empty page.
 */

describe('buildDiscoveryHref', () => {
  it('keeps the filters that are already applied', () => {
    const href = buildDiscoveryHref(
      '/categories',
      { type: 'drama', category: 'romance' },
      { type: 'movie' }
    );

    const url = new URL(href, 'https://dramascan.test');

    expect(url.pathname).toBe('/categories');
    expect(url.searchParams.get('type')).toBe('movie');
    expect(url.searchParams.get('category')).toBe('romance');
  });

  it('resets the pager when a filter changes', () => {
    const href = buildDiscoveryHref(
      '/trending',
      { page: '4', type: 'drama' },
      { type: 'movie' }
    );

    const url = new URL(href, 'https://dramascan.test');

    expect(url.searchParams.get('page')).toBeNull();
    expect(url.searchParams.get('type')).toBe('movie');
  });

  it('keeps the page when the pager sets it explicitly', () => {
    const href = buildDiscoveryHref(
      '/trending',
      { page: '4', type: 'drama' },
      { page: '5' }
    );

    const url = new URL(href, 'https://dramascan.test');

    expect(url.searchParams.get('page')).toBe('5');
    expect(url.searchParams.get('type')).toBe('drama');
  });

  it('removes a parameter when the change value is empty', () => {
    const href = buildDiscoveryHref(
      '/categories',
      { category: 'romance' },
      { category: undefined }
    );

    expect(href).toBe('/categories');
  });

  it('uses the first value of a repeated parameter', () => {
    const href = buildDiscoveryHref('/search', { q: ['first', 'second'] }, {});

    expect(href).toBe('/search?q=first');
  });

  it('returns the bare path when nothing is left', () => {
    expect(buildDiscoveryHref('/trending', {}, {})).toBe('/trending');
  });
});
