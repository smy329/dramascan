/**
 * Publication rules for content.
 *
 * Pure functions: no database, no HTTP, no clock. `workflows/admin/publication.ts`
 * owns persistence and authorization; every public query, playback check, search
 * path, discovery page, and sitemap generator must derive availability from
 * `evaluatePublicAvailability` instead of comparing a single column.
 *
 * Two concepts are deliberately kept separate:
 * - `publication_status` is the item's own explicit state.
 * - Effective public availability also requires every ancestor to be published
 *   and nothing in the hierarchy to be in Trash.
 */
import {
  publicationReadyVideoSourceSchema,
  publicationStatusSchema,
  type PublicationAction,
  type PublicationContentType,
} from './validation';

export { publicationStatusSchema };
export type { PublicationContentType, PublicationAction };

/** Canonical stored publication states. `trashed` is a view, never a state. */
export const PUBLICATION_STATUSES = publicationStatusSchema.options;

export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

/** Map any legacy, unknown, or absent value to the canonical vocabulary. */
export function normalizePublicationStatus(value: string | null | undefined): PublicationStatus {
  return PUBLICATION_STATUSES.includes(value as PublicationStatus)
    ? (value as PublicationStatus)
    : 'draft';
}

/** A source is publication-ready when it satisfies the shared video contract. */
export function isPublicationReadySource(value: string | null): boolean {
  if (value === null) return false;
  return publicationReadyVideoSourceSchema.safeParse(value).success;
}

export type PublicationEligibilityReason =
  | 'eligible'
  | 'already_published'
  | 'already_unpublished'
  | 'missing_source'
  | 'invalid_source';

export type PublicationEligibility = {
  eligible: boolean;
  reason: PublicationEligibilityReason;
  message: string;
};

/** Content types whose publication depends on a valid playback source. */
const SOURCE_BEARING_TYPES: ReadonlySet<PublicationContentType> = new Set([
  'episode',
  'movie',
]);

/**
 * Decide whether one item may be published or unpublished.
 *
 * Eligibility is about the item's own readiness, never its ancestors: a
 * published episode under a draft parent stays published and simply is not
 * publicly available until the parent is published.
 */
export function evaluatePublicationEligibility(input: {
  contentType: PublicationContentType;
  action: PublicationAction;
  publicationStatus: PublicationStatus;
  videoSource: string | null;
}): PublicationEligibility {
  const { contentType, action, publicationStatus, videoSource } = input;

  if (action === 'publish') {
    if (publicationStatus === 'published') {
      return {
        eligible: false,
        reason: 'already_published',
        message: 'The item is already published.',
      };
    }

    if (SOURCE_BEARING_TYPES.has(contentType)) {
      if (videoSource === null || videoSource.trim() === '') {
        return {
          eligible: false,
          reason: 'missing_source',
          message: 'The item has no video source. Add a source before publishing.',
        };
      }

      if (!isPublicationReadySource(videoSource)) {
        return {
          eligible: false,
          reason: 'invalid_source',
          message:
            'The video source must be an absolute HTTPS URL whose path ends in .mp4, with no embedded credentials.',
        };
      }
    }

    return { eligible: true, reason: 'eligible', message: 'The item is ready to publish.' };
  }

  if (publicationStatus === 'unpublished') {
    return {
      eligible: false,
      reason: 'already_unpublished',
      message: 'The item is already unpublished.',
    };
  }

  return { eligible: true, reason: 'eligible', message: 'The item is ready to unpublish.' };
}

export type AvailabilityBlocker =
  | 'not_published'
  | 'parent_not_published'
  | 'season_not_published'
  | 'trashed';

export type AvailabilityParent = {
  publicationStatus: PublicationStatus;
  deleted: boolean;
};

export type PublicAvailability = {
  publiclyAvailable: boolean;
  blockers: AvailabilityBlocker[];
};

/**
 * Derive effective public availability from the complete hierarchy.
 *
 * `deleted` means the row is in Trash. `parentDrama`/`parentSeason` are omitted
 * for content types without that ancestor.
 */
export function evaluatePublicAvailability(input: {
  contentType: PublicationContentType;
  publicationStatus: PublicationStatus;
  deleted: boolean;
  parentDrama?: AvailabilityParent | null;
  parentSeason?: AvailabilityParent | null;
}): PublicAvailability {
  const { contentType, publicationStatus, deleted } = input;
  const blockers: AvailabilityBlocker[] = [];

  if (publicationStatus !== 'published') {
    blockers.push('not_published');
  }

  if (deleted) {
    blockers.push('trashed');
  }

  if (contentType === 'season' || contentType === 'episode') {
    const parentDrama = input.parentDrama ?? null;
    if (parentDrama === null || parentDrama.publicationStatus !== 'published') {
      blockers.push('parent_not_published');
    }
    if (parentDrama !== null && parentDrama.deleted) {
      blockers.push('trashed');
    }
  }

  if (contentType === 'episode' && input.parentSeason !== null && input.parentSeason !== undefined) {
    const season = input.parentSeason;
    if (season.publicationStatus !== 'published') {
      blockers.push('season_not_published');
    }
    if (season.deleted) {
      blockers.push('trashed');
    }
  }

  return { publiclyAvailable: blockers.length === 0, blockers };
}
