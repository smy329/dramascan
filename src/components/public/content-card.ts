/**
 * Shared content-card presentation helpers.
 *
 * These functions only normalize display data supplied by a caller. They never
 * fetch, calculate, or infer ratings, status, or URLs from the content domain.
 */

export const CONTENT_KIND_LABELS = {
  drama: 'Drama',
  movie: 'Movie',
} as const;

export const CONTENT_STATUS_LABELS = {
  ongoing: 'Ongoing',
  completed: 'Completed',
  'coming-soon': 'Coming Soon',
} as const;

export type ContentKind = keyof typeof CONTENT_KIND_LABELS;
export type ContentLifecycleStatus = keyof typeof CONTENT_STATUS_LABELS;
export type ContentRating = {
  average: number;
  count: number;
};

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Accepts a same-origin absolute path or an http(s) URL. Rejects empty values,
 * protocol-relative URLs, and executable/data schemes.
 */
export function normalizeSafeUrl(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('/')) {
    return trimmed.startsWith('//') ? null : trimmed;
  }

  try {
    const url = new URL(trimmed);

    return HTTP_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Returns a displayable rating only when the caller supplied a finite average
 * on the 1–5 scale and a positive finite count.
 */
export function normalizeRating(rating?: ContentRating | null): ContentRating | null {
  if (!rating) {
    return null;
  }

  const { average, count } = rating;

  if (!Number.isFinite(average) || average <= 0 || average > 5) {
    return null;
  }

  if (!Number.isFinite(count) || count <= 0) {
    return null;
  }

  return { average, count: Math.floor(count) };
}

/** Formats a rating average with exactly one decimal place. */
export function formatRatingAverage(average: number): string {
  return average.toFixed(1);
}

function trimTrailingZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

/** Abbreviates a rating count without rounding up. */
export function formatRatingCount(count: number): string {
  if (count < 1000) {
    return String(count);
  }

  if (count < 1_000_000) {
    return `${trimTrailingZero(Math.floor(count / 100) / 10)}K`;
  }

  return `${trimTrailingZero(Math.floor(count / 100_000) / 10)}M`;
}
