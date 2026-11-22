/**
 * Pure similar-drama relevance rules.
 *
 * The automatic suggestions are a recommendation aid, not an automatic write:
 * a Content Manager reviews the scored candidates and decides which ones to
 * add. Every rule therefore lives here, free of database and HTTP concerns, so
 * the scoring can be unit-tested and reused without dragging the admin module
 * into the public site.
 *
 * Relevance is derived from the metadata the platform already owns:
 *
 *   - shared categories: the strongest signal. Two dramas in the same genres
 *     are usually presented together.
 *   - shared platforms: where the drama is distributed.
 *   - the same production status: ongoing and completed titles are not
 *     interchangeable recommendations for a viewer.
 *   - the same structure type: a flat one-episode drama is not a natural
 *     recommendation for a multi-season series.
 */

import type { SimilarDramaSuggestion } from '@/lib/contracts/similar-dramas';

export type { SimilarDramaSuggestion };

/** Relevance weights. Categories dominate, metadata only breaks ties. */
export const SIMILAR_DRAMA_SCORE_WEIGHTS = Object.freeze({
  category: 3,
  platform: 2,
  status: 1,
  structureType: 1,
});

/** One candidate drama, reduced to the fields the score uses. */
export type SimilarDramaCandidate = {
  id: string;
  title: string;
  poster: string | null;
  description: string | null;
  status: string | null;
  structureType: string;
  categoryIds: readonly string[];
  platformIds: readonly string[];
};

/** The drama recommendations are generated for. */
export type SimilarDramaSource = {
  id: string;
  status: string | null;
  structureType: string;
  categoryIds: readonly string[];
  platformIds: readonly string[];
};

/** Maximum number of suggestions returned to the administrator surface. */
export const SIMILAR_DRAMA_SUGGESTION_LIMIT = 20;

function countShared(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right);

  return left.reduce((total, id) => (rightSet.has(id) ? total + 1 : total), 0);
}

/**
 * Score one candidate against the source drama.
 *
 * Returns `null` when the candidate shares nothing at all: a recommendation
 * with no shared metadata is noise, and the administrator is better served by an
 * empty suggestion list than by an arbitrary one.
 */
export function scoreSimilarDramaCandidate(
  source: SimilarDramaSource,
  candidate: SimilarDramaCandidate
): SimilarDramaSuggestion | null {
  if (source.id === candidate.id) {
    return null;
  }

  const sharedCategories = countShared(source.categoryIds, candidate.categoryIds);
  const sharedPlatforms = countShared(source.platformIds, candidate.platformIds);
  const sameStatus =
    source.status !== null && source.status === candidate.status ? 1 : 0;
  const sameStructureType = source.structureType === candidate.structureType ? 1 : 0;

  const score =
    sharedCategories * SIMILAR_DRAMA_SCORE_WEIGHTS.category +
    sharedPlatforms * SIMILAR_DRAMA_SCORE_WEIGHTS.platform +
    sameStatus * SIMILAR_DRAMA_SCORE_WEIGHTS.status +
    sameStructureType * SIMILAR_DRAMA_SCORE_WEIGHTS.structureType;

  if (score === 0) {
    return null;
  }

  return {
    id: candidate.id,
    title: candidate.title,
    poster: candidate.poster,
    description: candidate.description,
    score,
    sharedCategories,
    sharedPlatforms,
  };
}

/**
 * Score and rank a candidate set.
 *
 * The order is deterministic: the highest score first, then the title, then
 * the id. A tie therefore never depends on database row order, and two runs
 * over the same data always produce the same list.
 */
export function rankSimilarDramaSuggestions(
  source: SimilarDramaSource,
  candidates: readonly SimilarDramaCandidate[],
  options?: { limit?: number }
): SimilarDramaSuggestion[] {
  const scored: SimilarDramaSuggestion[] = [];

  for (const candidate of candidates) {
    const suggestion = scoreSimilarDramaCandidate(source, candidate);

    if (suggestion) {
      scored.push(suggestion);
    }
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    const byTitle = left.title.localeCompare(right.title);

    if (byTitle !== 0) {
      return byTitle;
    }

    return left.id.localeCompare(right.id);
  });

  const limit = options?.limit ?? SIMILAR_DRAMA_SUGGESTION_LIMIT;

  return scored.slice(0, Math.max(0, limit));
}
