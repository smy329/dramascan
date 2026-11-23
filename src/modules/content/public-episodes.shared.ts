import { evaluatePublicAvailability, normalizePublicationStatus } from './publication';

/**
 * Public episode playback rules (pure).
 *
 * This file holds the decision, not the query: it has no database access and
 * no `server-only` marker, so the rule can be unit tested and reused by the
 * watch page, the catalogue, and the API without any of them disagreeing
 * about what is playable.
 */

/** The episode data the watch page needs, and nothing more. */
export type PublicEpisodePlayback = {
  id: string;
  dramaId: string;
  dramaSlug: string;
  dramaTitle: string;
  seasonId: string | null;
  title: string;
  description: string | null;
  episodeNumber: number | null;
  videoSource: string;
  /**
   * The version of the stored source.
   *
   * The player reports it with every playback position, so the server can
   * recognise a report that belongs to a source that has been replaced.
   */
  sourceVersion: number;
};

/**
 * The episode data a listing needs.
 *
 * A listing is not a playback view: the source URL is deliberately not part of
 * this projection. Only the watch query hands out a media URL.
 */
export type PublicEpisodeSummary = {
  id: string;
  dramaId: string;
  dramaSlug: string;
  dramaTitle: string;
  seasonId: string | null;
  title: string;
  description: string | null;
  episodeNumber: number | null;
};

/** The row shape the availability rule is evaluated against. */
export type PublicEpisodeAvailabilityInput = {
  episodePublicationStatus: string | null;
  episodeDeleted: boolean;
  hasSource: boolean;
  dramaPublicationStatus: string | null;
  dramaDeleted: boolean;
  dramaStructureType: string | null;
  hasSeason: boolean;
  seasonPublicationStatus: string | null;
  seasonDeleted: boolean;
};

/**
 * Decide whether one episode may be watched by the public.
 *
 * The rule mirrors `evaluatePublicAvailability` for the item's own state and
 * its ancestors, and adds two content-specific conditions: the episode has to
 * carry a source, and a season-based drama only exposes episodes that sit
 * under a published, non-deleted season.
 */
export function isPubliclyPlayableEpisode(input: PublicEpisodeAvailabilityInput): boolean {
  if (!input.hasSource) {
    return false;
  }

  const availability = evaluatePublicAvailability({
    contentType: 'episode',
    publicationStatus: normalizePublicationStatus(input.episodePublicationStatus),
    deleted: input.episodeDeleted,
    parentDrama: {
      publicationStatus: normalizePublicationStatus(input.dramaPublicationStatus),
      deleted: input.dramaDeleted,
    },
    parentSeason: input.hasSeason
      ? {
          publicationStatus: normalizePublicationStatus(input.seasonPublicationStatus),
          deleted: input.seasonDeleted,
        }
      : null,
  });

  if (!availability.publiclyAvailable) {
    return false;
  }

  if (input.dramaStructureType === 'season_based' && !input.hasSeason) {
    return false;
  }

  return true;
}
