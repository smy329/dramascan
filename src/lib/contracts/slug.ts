/**
 * Client-safe slug rule shared by every admin form.
 *
 * Slugs are derived, never typed: the administrator writes a title or a name
 * and the server stores the canonical slug. This module owns the single rule,
 * so a drama title and a category name cannot drift apart.
 *
 * `lib` may not import a domain module, which is why the rule lives here and
 * the workflows import it.
 */

/** Maximum slug length; the domain slug columns and patterns agree on it. */
export const SLUG_MAX_LENGTH = 100;

/**
 * Derive the canonical slug from arbitrary text.
 *
 * Lowercases, strips diacritics, drops apostrophes, turns every run of other
 * non-alphanumeric characters into a single hyphen, trims leading and trailing
 * hyphens, and truncates to `SLUG_MAX_LENGTH` without leaving a trailing
 * hyphen. The result always satisfies the domain slug pattern when non-empty;
 * text written entirely in a non-Latin script yields `''`, which callers must
 * reject rather than store.
 */
export function slugFromText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2018\u2019`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
}
