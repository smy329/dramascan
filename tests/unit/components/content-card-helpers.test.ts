import { describe, expect, it } from 'vitest';

import {
  formatRatingAverage,
  formatRatingCount,
  normalizeRating,
  normalizeSafeUrl,
} from '@/components/public/content-card';

describe('normalizeSafeUrl', () => {
  it('accepts same-origin paths and http(s) URLs', () => {
    expect(normalizeSafeUrl('/posters/a.jpg')).toBe('/posters/a.jpg');
    expect(normalizeSafeUrl('https://cdn.example.com/a.jpg')).toBe('https://cdn.example.com/a.jpg');
    expect(normalizeSafeUrl('http://cdn.example.com/a.jpg')).toBe('http://cdn.example.com/a.jpg');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeSafeUrl('  /posters/a.jpg  ')).toBe('/posters/a.jpg');
  });

  it('rejects empty, missing, and non-URL values', () => {
    expect(normalizeSafeUrl()).toBeNull();
    expect(normalizeSafeUrl(null)).toBeNull();
    expect(normalizeSafeUrl('')).toBeNull();
    expect(normalizeSafeUrl('   ')).toBeNull();
    expect(normalizeSafeUrl('not a url')).toBeNull();
  });

  it('rejects unsafe schemes and protocol-relative URLs', () => {
    expect(normalizeSafeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeSafeUrl('data:image/png;base64,abc')).toBeNull();
    expect(normalizeSafeUrl('//evil.example/a.jpg')).toBeNull();
  });
});

describe('normalizeRating', () => {
  it('keeps a valid rating', () => {
    expect(normalizeRating({ average: 4.5, count: 1200 })).toEqual({ average: 4.5, count: 1200 });
  });

  it('floors a fractional count', () => {
    expect(normalizeRating({ average: 4.5, count: 1200.9 })).toEqual({
      average: 4.5,
      count: 1200,
    });
  });

  it('rejects an average outside the rating scale', () => {
    expect(normalizeRating({ average: 0, count: 10 })).toBeNull();
    expect(normalizeRating({ average: -1, count: 10 })).toBeNull();
    expect(normalizeRating({ average: 5.1, count: 10 })).toBeNull();
  });

  it('rejects a non-positive or non-finite count', () => {
    expect(normalizeRating({ average: 4.5, count: 0 })).toBeNull();
    expect(normalizeRating({ average: 4.5, count: -3 })).toBeNull();
    expect(normalizeRating({ average: 4.5, count: Number.NaN })).toBeNull();
    expect(normalizeRating({ average: 4.5, count: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('rejects non-finite averages and absent ratings', () => {
    expect(normalizeRating({ average: Number.NaN, count: 10 })).toBeNull();
    expect(normalizeRating({ average: Number.POSITIVE_INFINITY, count: 10 })).toBeNull();
    expect(normalizeRating(null)).toBeNull();
    expect(normalizeRating()).toBeNull();
  });
});

describe('formatRatingAverage', () => {
  it('always uses one decimal place', () => {
    expect(formatRatingAverage(4)).toBe('4.0');
    expect(formatRatingAverage(4.5)).toBe('4.5');
    expect(formatRatingAverage(4.56)).toBe('4.6');
  });
});

describe('formatRatingCount', () => {
  it('keeps counts below one thousand unchanged', () => {
    expect(formatRatingCount(1)).toBe('1');
    expect(formatRatingCount(999)).toBe('999');
  });

  it('abbreviates thousands without rounding up', () => {
    expect(formatRatingCount(1000)).toBe('1K');
    expect(formatRatingCount(1200)).toBe('1.2K');
    expect(formatRatingCount(15000)).toBe('15K');
    expect(formatRatingCount(999999)).toBe('999.9K');
  });

  it('abbreviates millions without rounding up', () => {
    expect(formatRatingCount(1000000)).toBe('1M');
    expect(formatRatingCount(1250000)).toBe('1.2M');
  });
});
