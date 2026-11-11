export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

const HEADING_TAGS: Record<number, HeadingTag> = {
  1: 'h1',
  2: 'h2',
  3: 'h3',
  4: 'h4',
  5: 'h5',
  6: 'h6',
};

/**
 * Resolves a caller-supplied heading level to a semantic tag. An absent or
 * out-of-range level falls back to `h2` rather than rendering a broken tag.
 */
export function resolveHeadingTag(level?: HeadingLevel): HeadingTag {
  return HEADING_TAGS[level ?? 2] ?? 'h2';
}
