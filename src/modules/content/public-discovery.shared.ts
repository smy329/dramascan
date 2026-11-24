/**
 * Pure contracts of the public discovery read models.
 *
 * The helpers and types in this file have no database dependency, so they can
 * be unit-tested without a database and reused by the presentation layer.
 */

/** The content kinds the public site shows. */
export type DiscoveryContentType = 'drama' | 'movie';

/**
 * Escape the LIKE wildcards so a search term is matched literally.
 *
 * A `%` or `_` in a viewer's search term is a wildcard in a `LIKE` pattern.
 * The term is user input, so the wildcards are escaped and the pattern is
 * always used with `ESCAPE '\'`.
 */
export function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

/** The drama's lifecycle status, normalized to the two public values. */
export function dramaStatus(value: string | null): 'ongoing' | 'completed' | null {
  return value === 'ongoing' || value === 'completed' ? value : null;
}
