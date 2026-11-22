import { z } from 'zod';

import { parseOrThrow } from './validation';

/**
 * Pure public-catalogue contracts.
 *
 * The database query lives in `public-dramas.ts`. Nothing here imports the
 * database, auth, or HTTP so the visibility rules and wire shape stay
 * unit-testable. The SQL predicate in the service mirrors
 * `evaluatePublicDramaDiscovery`; the integration suite proves the two agree.
 */

/** Default page size for the public drama catalogue. */
export const PUBLIC_DRAMA_PAGE_SIZE_DEFAULT = 20;

/** Maximum page size a public caller may request. */
export const PUBLIC_DRAMA_PAGE_SIZE_MAX = 100;

/** Upper bound on the page number, so a caller cannot request pathological offsets. */
const PUBLIC_DRAMA_PAGE_MAX = 1_000_000;

/**
 * Approved public listing query.
 *
 * `z.object` (not `strictObject`) deliberately strips unrecognised keys. A
 * caller may send `publication_status=draft` or `visibility=hidden`; those
 * values are discarded instead of narrowing or broadening the public result.
 */
export const publicDramaListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(PUBLIC_DRAMA_PAGE_MAX).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(PUBLIC_DRAMA_PAGE_SIZE_MAX)
    .default(PUBLIC_DRAMA_PAGE_SIZE_DEFAULT),
});

export type PublicDramaListQuery = z.infer<typeof publicDramaListQuerySchema>;

/** Parse a public listing query, throwing a REST-safe validation error. */
export function parsePublicDramaListQuery(input: unknown): PublicDramaListQuery {
  return parseOrThrow(publicDramaListQuerySchema, input);
}

/** Bounded, deterministic public listing result. */
export type PublicDramaList = {
  items: PublicDramaSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

/** Canonical public drama route: stable id plus slug (requirements §6.6). */
export function publicDramaHref(id: string, slug: string): string {
  return `/drama/${id}/${slug}`;
}

/** Explicit camelCase public DTO. Raw rows and source URLs never cross this seam. */
export type PublicDramaSummary = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  poster: string | null;
  banner: string | null;
  href: string;
  status: 'ongoing' | 'completed' | null;
  comingSoon: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Row shape the service projects into `PublicDramaSummary`. */
export type PublicDramaRow = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  poster: string | null;
  banner: string | null;
  status: string | null;
  visibility: string | null;
  publicationStatus: string | null;
  deleted: boolean;
  hasPlayableEpisode: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicDramaDiscoveryReason =
  | 'available'
  | 'coming_soon'
  | 'not_published'
  | 'trashed'
  | 'hidden_until_available';

export type PublicDramaDiscovery = {
  discoverable: boolean;
  comingSoon: boolean;
  reason: PublicDramaDiscoveryReason;
};

/**
 * Global empty-drama visibility modes.
 *
 * `coming_soon` keeps a published drama without playable episodes visible as a
 * poster-only coming-soon entry. `hidden` removes it from public discovery
 * until a playable episode exists.
 */
export const EMPTY_DRAMA_VISIBILITY_MODES = ['coming_soon', 'hidden'] as const;

export type EmptyDramaVisibilityMode = (typeof EMPTY_DRAMA_VISIBILITY_MODES)[number];

/** The global default when no mode is configured. */
export const DEFAULT_EMPTY_DRAMA_VISIBILITY: EmptyDramaVisibilityMode = 'coming_soon';

/**
 * Decide whether a drama without playable episodes is hidden.
 *
 * Two inputs combine, and the combination is deliberately asymmetric:
 *
 *   - The per-drama `visibility` column is a stricter override. `hidden` always
 *     hides the drama until a playable episode exists.
 *   - `coming_soon` (and a legacy null) defers to the global mode, so one
 *     configuration switch changes every drama that has not opted into the
 *     stricter per-drama rule.
 *
 * The global mode can therefore only ever hide more, never less, than the
 * default. A drama that has a playable episode is never hidden by either rule.
 */
export function isEmptyDramaHidden(input: {
  visibility: string | null;
  emptyDramaVisibility?: EmptyDramaVisibilityMode | null;
}): boolean {
  const globalMode = input.emptyDramaVisibility ?? DEFAULT_EMPTY_DRAMA_VISIBILITY;

  if (globalMode === 'hidden') {
    return true;
  }

  return input.visibility === 'hidden';
}

/**
 * Decide whether one drama may appear in public discovery.
 *
 * `hasPlayableEpisode` is computed from the hierarchy: a published, non-deleted
 * episode with a source, under a published, non-deleted season when the drama is
 * season-based. A drama's own publication status and Trash flag are always
 * authoritative; caller filters can never override them.
 */
export function evaluatePublicDramaDiscovery(input: {
  publicationStatus: string | null;
  deleted: boolean;
  visibility: string | null;
  hasPlayableEpisode: boolean;
  emptyDramaVisibility?: EmptyDramaVisibilityMode | null;
}): PublicDramaDiscovery {
  if (input.deleted) {
    return { discoverable: false, comingSoon: false, reason: 'trashed' };
  }

  if (input.publicationStatus !== 'published') {
    return { discoverable: false, comingSoon: false, reason: 'not_published' };
  }

  if (!input.hasPlayableEpisode && isEmptyDramaHidden(input)) {
    return { discoverable: false, comingSoon: false, reason: 'hidden_until_available' };
  }

  return input.hasPlayableEpisode
    ? { discoverable: true, comingSoon: false, reason: 'available' }
    : { discoverable: true, comingSoon: true, reason: 'coming_soon' };
}

/** Project one discoverable row into the public DTO. */
export function toPublicDramaSummary(
  row: PublicDramaRow,
  options?: { emptyDramaVisibility?: EmptyDramaVisibilityMode | null }
): PublicDramaSummary {
  const discovery = evaluatePublicDramaDiscovery({
    ...row,
    emptyDramaVisibility: options?.emptyDramaVisibility,
  });

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    poster: row.poster,
    banner: row.banner,
    href: publicDramaHref(row.id, row.slug),
    status: row.status === 'ongoing' || row.status === 'completed' ? row.status : null,
    comingSoon: discovery.comingSoon,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
