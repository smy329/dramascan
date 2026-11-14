/**
 * Drama structure conversion domain rules (owned by `content`).
 *
 * This module is pure: it orders state, validates a distribution, builds a
 * preview plan, computes the deterministic fingerprint, and parses stored
 * snapshots. The workflow owns authorization, transactions, locking, and all
 * writes.
 */
import { createHash } from 'node:crypto';

import { ValidationError } from '@/platform/errors';

import {
  parseOrThrow,
  snapshotPayloadSchema,
  type ConversionAssignmentInput,
  type ConversionDistributionInput,
  type ConversionSeasonInput,
  type ConversionStrategy,
  type ConversionStructureType,
  type SnapshotEpisodePayload,
  type SnapshotPayload,
  type SnapshotSeasonPayload,
  type SnapshotStatus,
} from './validation';

/** A season row reduced to the fields conversion can change or restore. */
export type ConversionSeasonState = {
  id: string;
  title: string;
  position: number | null;
  publicationStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

/** An episode row reduced to the fields conversion can change or restore. */
export type ConversionEpisodeState = {
  id: string;
  title: string;
  seasonId: string | null;
  episodeNumber: number | null;
  position: number | null;
  createdAt: string;
  updatedAt: string;
};

/** Active structure state used for previews and apply verification. */
export type ConversionStructureState = {
  dramaId: string;
  structureType: ConversionStructureType;
  seasons: ConversionSeasonState[];
  episodes: ConversionEpisodeState[];
};

export type ConversionPlanSeason = {
  key: string;
  id: string | null;
  title: string;
  position: number;
  episodeCount: number;
};

export type ConversionPlanEpisode = {
  id: string;
  title: string;
  fromSeasonId: string | null;
  toSeasonKey: string | null;
  fromEpisodeNumber: number | null;
  toEpisodeNumber: number | null;
  fromPosition: number | null;
  toPosition: number | null;
};

export type ConversionPlanSnapshot = {
  id: string;
  status: SnapshotStatus;
  createdAt: string;
  restorable: boolean;
};

export type ConversionPlan = {
  dramaId: string;
  currentStructureType: ConversionStructureType;
  targetStructureType: ConversionStructureType;
  strategy: ConversionStrategy;
  fingerprint: string;
  seasons: ConversionPlanSeason[];
  episodes: ConversionPlanEpisode[];
  counts: {
    activeEpisodes: number;
    seasonsAffected: number;
    seasonsCreated: number;
  };
  snapshot: ConversionPlanSnapshot | null;
  warnings: string[];
};

export type NormalizedSeason = {
  key: string;
  title: string;
  position: number;
};

export type NormalizedDistribution = {
  seasons: NormalizedSeason[];
  /** episode id → season key */
  assignments: Map<string, string>;
};

// ----- ordering -------------------------------------------------------------

function compareNullableNumber(left: number | null, right: number | null): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left - right;
}

function orderSeasons(seasons: readonly ConversionSeasonState[]): ConversionSeasonState[] {
  return [...seasons].sort(
    (left, right) =>
      compareNullableNumber(left.position, right.position) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
  );
}

function orderEpisodes(
  episodes: readonly ConversionEpisodeState[]
): ConversionEpisodeState[] {
  return [...episodes].sort(
    (left, right) =>
      compareNullableNumber(left.position, right.position) ||
      compareNullableNumber(left.episodeNumber, right.episodeNumber) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
  );
}

/**
 * Order a season-based structure: seasons by position, episodes within each
 * season by position/number, and seasonless episodes after every season.
 */
export function orderSeasonStructure(
  seasons: readonly ConversionSeasonState[],
  episodes: readonly ConversionEpisodeState[]
): { seasons: ConversionSeasonState[]; episodes: ConversionEpisodeState[] } {
  const orderedSeasons = orderSeasons(seasons);
  const bySeason = new Map<string, ConversionEpisodeState[]>();

  for (const episode of episodes) {
    if (episode.seasonId === null) {
      continue;
    }
    const group = bySeason.get(episode.seasonId) ?? [];
    group.push(episode);
    bySeason.set(episode.seasonId, group);
  }

  const seasonOrdered = orderedSeasons.flatMap(season =>
    orderEpisodes(bySeason.get(season.id) ?? [])
  );
  const seasonless = orderEpisodes(episodes.filter(episode => episode.seasonId === null));

  return {
    seasons: orderedSeasons,
    episodes: [...seasonOrdered, ...seasonless],
  };
}

// ----- fingerprint ----------------------------------------------------------

/**
 * Deterministic fingerprint of every conversion-relevant active field.
 *
 * Episode titles, descriptions, publication state, and video sources are
 * intentionally excluded: conversion never changes them. Season title,
 * position, and publication state are included because snapshot restore
 * restores them.
 */
export function computeStructureFingerprint(state: ConversionStructureState): string {
  const payload = {
    dramaId: state.dramaId,
    structureType: state.structureType,
    seasons: [...state.seasons]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(season => ({
        id: season.id,
        title: season.title,
        position: season.position,
        publicationStatus: season.publicationStatus,
      })),
    episodes: [...state.episodes]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(episode => ({
        id: episode.id,
        seasonId: episode.seasonId,
        episodeNumber: episode.episodeNumber,
        position: episode.position,
      })),
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

// ----- distribution ---------------------------------------------------------

/** Default flat → season distribution: one Season 1 containing every episode. */
export function defaultDistribution(
  episodes: readonly ConversionEpisodeState[]
): ConversionDistributionInput {
  return {
    seasons: [{ key: 'season-1', title: 'Season 1', position: 0 }],
    assignments: episodes.map(episode => ({
      episodeId: episode.id,
      seasonKey: 'season-1',
    })),
  };
}

function invalidDistribution(message: string, fieldErrors: Record<string, string[]>): never {
  throw new ValidationError(message, fieldErrors);
}

/**
 * Validate a distribution against the active episode set. Every active
 * episode must be assigned exactly once to a supplied season key.
 */
export function normalizeDistribution(
  distribution: ConversionDistributionInput | undefined,
  episodes: readonly ConversionEpisodeState[]
): NormalizedDistribution {
  const input = distribution ?? defaultDistribution(episodes);

  if (input.seasons.length === 0) {
    invalidDistribution('At least one season is required.', {
      seasons: ['At least one season is required.'],
    });
  }

  const keys = new Set<string>();
  const positions = new Set<number>();

  const seasons: NormalizedSeason[] = input.seasons.map((season, index) => {
    const key = season.key.trim();

    if (keys.has(key)) {
      invalidDistribution(`Duplicate season key "${key}".`, {
        seasons: [`Duplicate season key "${key}".`],
      });
    }
    keys.add(key);

    const position = season.position ?? index;
    if (positions.has(position)) {
      invalidDistribution(`Duplicate season position ${position}.`, {
        seasons: [`Duplicate season position ${position}.`],
      });
    }
    positions.add(position);

    return { key, title: season.title.trim(), position };
  });

  const activeEpisodeIds = new Set(episodes.map(episode => episode.id));
  const assignments = new Map<string, string>();

  for (const assignment of input.assignments) {
    if (!activeEpisodeIds.has(assignment.episodeId)) {
      invalidDistribution('An assignment references an episode that is not active.', {
        assignments: ['An assignment references an episode that is not active.'],
      });
    }

    if (assignments.has(assignment.episodeId)) {
      invalidDistribution('An episode is assigned more than once.', {
        assignments: ['An episode is assigned more than once.'],
      });
    }

    if (!keys.has(assignment.seasonKey)) {
      invalidDistribution(
        `Assignment references unknown season key "${assignment.seasonKey}".`,
        { assignments: [`Assignment references unknown season key "${assignment.seasonKey}".`] }
      );
    }

    assignments.set(assignment.episodeId, assignment.seasonKey);
  }

  const missing = [...activeEpisodeIds].filter(id => !assignments.has(id));
  if (missing.length > 0) {
    invalidDistribution(
      `${missing.length} active episode(s) are not assigned to a season.`,
      { assignments: ['Every active episode must be assigned to exactly one season.'] }
    );
  }

  return { seasons, assignments };
}

// ----- plan builders --------------------------------------------------------

function planEpisode(
  episode: ConversionEpisodeState,
  overrides: Partial<ConversionPlanEpisode>
): ConversionPlanEpisode {
  return {
    id: episode.id,
    title: episode.title,
    fromSeasonId: episode.seasonId,
    toSeasonKey: null,
    fromEpisodeNumber: episode.episodeNumber,
    toEpisodeNumber: episode.episodeNumber,
    fromPosition: episode.position,
    toPosition: episode.position,
    ...overrides,
  };
}

/** Preview for season-based → flat. */
export function buildFlatConversionPlan(state: ConversionStructureState): ConversionPlan {
  const ordered = orderSeasonStructure(state.seasons, state.episodes);
  const seasonless = ordered.episodes.filter(episode => episode.seasonId === null);
  const warnings: string[] = [];

  if (seasonless.length > 0) {
    warnings.push(
      `${seasonless.length} seasonless episode(s) will be appended after the season-based episodes.`
    );
  }
  if (ordered.seasons.some(season => season.position === null)) {
    warnings.push('Some seasons have no position; creation order and id are used as a tie-breaker.');
  }

  return {
    dramaId: state.dramaId,
    currentStructureType: state.structureType,
    targetStructureType: 'flat',
    strategy: 'convert',
    fingerprint: computeStructureFingerprint(state),
    seasons: [],
    episodes: ordered.episodes.map((episode, index) =>
      planEpisode(episode, {
        toSeasonKey: null,
        toEpisodeNumber: index + 1,
        toPosition: index,
      })
    ),
    counts: {
      activeEpisodes: ordered.episodes.length,
      seasonsAffected: ordered.seasons.length,
      seasonsCreated: 0,
    },
    snapshot: null,
    warnings,
  };
}

/** Preview for flat → season-based using a distribution map. */
export function buildSeasonConversionPlan(
  state: ConversionStructureState,
  distribution: ConversionDistributionInput | undefined
): ConversionPlan {
  const normalized = normalizeDistribution(distribution, state.episodes);
  const ordered = orderEpisodes(state.episodes);
  const episodeCountBySeason = new Map<string, number>();

  for (const episode of ordered) {
    const key = normalized.assignments.get(episode.id);
    if (key === undefined) {
      continue;
    }
    episodeCountBySeason.set(key, (episodeCountBySeason.get(key) ?? 0) + 1);
  }

  return {
    dramaId: state.dramaId,
    currentStructureType: state.structureType,
    targetStructureType: 'season_based',
    strategy: 'convert',
    fingerprint: computeStructureFingerprint(state),
    seasons: normalized.seasons.map(season => ({
      key: season.key,
      id: null,
      title: season.title,
      position: season.position,
      episodeCount: episodeCountBySeason.get(season.key) ?? 0,
    })),
    episodes: ordered.map(episode =>
      planEpisode(episode, {
        toSeasonKey: normalized.assignments.get(episode.id) ?? null,
      })
    ),
    counts: {
      activeEpisodes: ordered.length,
      seasonsAffected: 0,
      seasonsCreated: normalized.seasons.length,
    },
    snapshot: null,
    warnings: [],
  };
}

/** Preview for flat → season-based by restoring a stored snapshot. */
export function buildRestoreSnapshotPlan(
  state: ConversionStructureState,
  snapshot: {
    id: string;
    status: SnapshotStatus;
    createdAt: string;
    payload: SnapshotPayload;
  },
  restorable: boolean,
  staleReason?: string
): ConversionPlan {
  const orderedSeasons = [...snapshot.payload.seasons].sort(
    (left, right) =>
      compareNullableNumber(left.position, right.position) ||
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id)
  );

  const episodesBySeason = new Map<string, SnapshotEpisodePayload[]>();
  const seasonless: SnapshotEpisodePayload[] = [];

  for (const episode of snapshot.payload.episodes) {
    if (episode.season_id === null) {
      seasonless.push(episode);
      continue;
    }
    const group = episodesBySeason.get(episode.season_id) ?? [];
    group.push(episode);
    episodesBySeason.set(episode.season_id, group);
  }

  const orderedEpisodes = [
    ...orderedSeasons.flatMap(season => {
      const group = episodesBySeason.get(season.id) ?? [];
      return [...group].sort(
        (left, right) =>
          compareNullableNumber(left.position, right.position) ||
          compareNullableNumber(left.episode_number, right.episode_number) ||
          left.id.localeCompare(right.id)
      );
    }),
    ...seasonless.sort(
      (left, right) =>
        compareNullableNumber(left.position, right.position) ||
        compareNullableNumber(left.episode_number, right.episode_number) ||
        left.id.localeCompare(right.id)
    ),
  ];

  const currentById = new Map(state.episodes.map(episode => [episode.id, episode]));
  const warnings: string[] = [];

  if (!restorable && staleReason) {
    warnings.push(staleReason);
  }

  return {
    dramaId: state.dramaId,
    currentStructureType: state.structureType,
    targetStructureType: 'season_based',
    strategy: 'restore_snapshot',
    fingerprint: computeStructureFingerprint(state),
    seasons: orderedSeasons.map(season => ({
      key: season.id,
      id: season.id,
      title: season.title,
      position: season.position ?? 0,
      episodeCount: (episodesBySeason.get(season.id) ?? []).length,
    })),
    episodes: orderedEpisodes.map(snapshotEpisode => {
      const current = currentById.get(snapshotEpisode.id);
      return planEpisode(
        current ?? {
          id: snapshotEpisode.id,
          title: snapshotEpisode.title,
          seasonId: null,
          episodeNumber: snapshotEpisode.episode_number,
          position: snapshotEpisode.position,
          createdAt: '',
          updatedAt: '',
        },
        {
          toSeasonKey: snapshotEpisode.season_id,
          toEpisodeNumber: snapshotEpisode.episode_number,
          toPosition: snapshotEpisode.position,
        }
      );
    }),
    counts: {
      activeEpisodes: state.episodes.length,
      seasonsAffected: 0,
      seasonsCreated: orderedSeasons.length,
    },
    snapshot: {
      id: snapshot.id,
      status: snapshot.status,
      createdAt: snapshot.createdAt,
      restorable,
    },
    warnings,
  };
}

// ----- snapshot payload -----------------------------------------------------

/** Build the exact structure payload stored before a season-based → flat conversion. */
export function buildSnapshotPayload(
  seasons: readonly ConversionSeasonState[],
  episodes: readonly ConversionEpisodeState[]
): SnapshotPayload {
  const ordered = orderSeasonStructure(seasons, episodes);

  return {
    seasons: ordered.seasons.map(
      (season): SnapshotSeasonPayload => ({
        id: season.id,
        title: season.title,
        position: season.position,
        publication_status: season.publicationStatus,
        created_at: season.createdAt,
        updated_at: season.updatedAt,
      })
    ),
    episodes: ordered.episodes.map(
      (episode): SnapshotEpisodePayload => ({
        id: episode.id,
        season_id: episode.seasonId,
        episode_number: episode.episodeNumber,
        position: episode.position,
        title: episode.title,
      })
    ),
  };
}

/** Parse and validate a stored snapshot payload. */
export function parseSnapshotPayload(value: unknown): SnapshotPayload {
  const payload = parseOrThrow(snapshotPayloadSchema, value);
  const seasonIds = new Set(payload.seasons.map(season => season.id));
  const episodeIds = new Set<string>();

  if (seasonIds.size !== payload.seasons.length) {
    throw new ValidationError('The snapshot contains duplicate season ids.', {
      season_data: ['The snapshot contains duplicate season ids.'],
    });
  }

  for (const episode of payload.episodes) {
    if (episodeIds.has(episode.id)) {
      throw new ValidationError('The snapshot contains duplicate episode ids.', {
        episode_data: ['The snapshot contains duplicate episode ids.'],
      });
    }
    episodeIds.add(episode.id);

    if (episode.season_id !== null && !seasonIds.has(episode.season_id)) {
      throw new ValidationError('The snapshot references an unknown season.', {
        episode_data: ['The snapshot references an unknown season.'],
      });
    }
  }

  return payload;
}

export function snapshotSeasonIds(payload: SnapshotPayload): Set<string> {
  return new Set(payload.seasons.map(season => season.id));
}

export function snapshotEpisodeIds(payload: SnapshotPayload): Set<string> {
  return new Set(payload.episodes.map(episode => episode.id));
}

/** Re-exported so callers can build assignments without importing validation. */
export type { ConversionAssignmentInput, ConversionSeasonInput };
