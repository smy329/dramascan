import 'server-only';

import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import { ConflictError, InternalError, NotFoundError, ValidationError } from '@/platform/errors';

import { z } from 'zod';
import {
  dramas,
  episodes,
  seasons,
  structureConversionSnapshots,
} from '@/modules/content/schema';
import {
  buildFlatConversionPlan,
  buildRestoreSnapshotPlan,
  buildSeasonConversionPlan,
  buildSnapshotPayload,
  computeStructureFingerprint,
  orderSeasonStructure,
  parseSnapshotPayload,
  snapshotEpisodeIds,
  snapshotSeasonIds,
  type ConversionEpisodeState,
  type ConversionPlan,
  type ConversionSeasonState,
  type ConversionStructureState,
} from '@/modules/content/conversion';
import {
  parseConversionRequest,
  type ConversionRequest,
  type ConversionStrategy,
  type ConversionStructureType,
  type SnapshotPayload,
  type SnapshotStatus,
} from '@/modules/content/validation';

/** Permission key for drama structure conversion. */
const MANAGE_PERMISSION = 'drama.manage';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = Tx | typeof db;

type SnapshotRow = typeof structureConversionSnapshots.$inferSelect;

export type ConversionContext = {
  drama: {
    id: string;
    title: string;
    structureType: ConversionStructureType;
    publicationStatus: string | null;
  };
  seasons: ConversionSeasonState[];
  episodes: ConversionEpisodeState[];
  availableSnapshot: SnapshotRow | null;
};

/**
 * The result of an applied conversion.
 *
 * The apply response is the plan shape plus the applied marker, the new
 * structure fingerprint, and the snapshot lifecycle fields, so a client can
 * read the resulting structure without a second request.
 */
export type ConversionApplyResult = ConversionPlan & {
  applied: true;
  newFingerprint: string;
  snapshotId: string | null;
  snapshotStatus: SnapshotStatus | null;
};

export type ConversionListItem = {
  id: string;
  title: string;
  structureType: ConversionStructureType;
  activeEpisodes: number;
  createdAt: string;
};

/** Sortable columns of the admin drama conversion list. */
export type ConversionListSortField = 'title' | 'createdAt';

export type ConversionListQuery = {
  page: number;
  pageSize: number;
  sortBy: ConversionListSortField;
  sortDirection: 'asc' | 'desc';
  search: string;
};

/** Build the sort token used by the admin table kit. */
export function formatConversionSortToken(
  sortBy: ConversionListSortField,
  sortDirection: 'asc' | 'desc'
): string {
  return sortDirection === 'desc' ? `-${sortBy}` : sortBy;
}

const CONVERSION_LIST_SORT_FIELDS = new Set<string>(['title', 'createdAt']);

/** Resolve a sort token to a column and direction, falling back to the default. */
export function parseConversionSortToken(token: string): {
  sortBy: ConversionListSortField;
  sortDirection: 'asc' | 'desc';
} {
  for (const segment of token.split(',')) {
    const trimmed = segment.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const descending = trimmed.startsWith('-');
    const column = descending ? trimmed.slice(1) : trimmed;

    if (CONVERSION_LIST_SORT_FIELDS.has(column)) {
      return {
        sortBy: column as ConversionListSortField,
        sortDirection: descending ? 'desc' : 'asc',
      };
    }
  }

  return { sortBy: 'title', sortDirection: 'asc' };
}

const listConversionQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).catch(1),
    pageSize: z.coerce.number().int().min(1).max(100).catch(20),
    sort: z.string().trim().max(32).catch('title'),
    q: z.string().trim().max(200).catch(''),
  })
  .transform(value => ({
    page: value.page,
    pageSize: value.pageSize,
    ...parseConversionSortToken(value.sort),
    search: value.q,
  }));

/** Parse untrusted query input into a validated conversion list query. */
export function parseConversionListQuery(input: unknown): ConversionListQuery {
  return listConversionQuerySchema.parse(input);
}

// ----- reads ----------------------------------------------------------------

async function readActiveSeasonsTx(tx: DbOrTx, dramaId: string): Promise<ConversionSeasonState[]> {
  const rows = await tx
    .select()
    .from(seasons)
    .where(and(eq(seasons.drama_id, dramaId), isNull(seasons.deleted_at)));

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    position: row.position,
    publicationStatus: row.publication_status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

async function readActiveEpisodesTx(tx: DbOrTx, dramaId: string): Promise<ConversionEpisodeState[]> {
  const rows = await tx
    .select()
    .from(episodes)
    .where(and(eq(episodes.drama_id, dramaId), isNull(episodes.deleted_at)));

  return rows.map(row => ({
    id: row.id,
    title: row.title,
    seasonId: row.season_id,
    episodeNumber: row.episode_number,
    position: row.position,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));
}

async function readAvailableSnapshotTx(
  tx: DbOrTx,
  dramaId: string
): Promise<SnapshotRow | null> {
  const [row] = await tx
    .select()
    .from(structureConversionSnapshots)
    .where(
      and(
        eq(structureConversionSnapshots.drama_id, dramaId),
        eq(structureConversionSnapshots.status, 'available')
      )
    )
    .limit(1);

  return row ?? null;
}

async function readDramaForUpdateTx(tx: Tx, dramaId: string) {
  const [row] = await tx
    .select()
    .from(dramas)
    .where(and(eq(dramas.id, dramaId), isNull(dramas.deleted_at)))
    .for('update');

  if (!row) {
    throw new NotFoundError('Drama not found.');
  }

  if (row.structure_type !== 'flat' && row.structure_type !== 'season_based') {
    throw new ConflictError('The drama has an unsupported structure type.');
  }

  return {
    id: row.id,
    title: row.title,
    structure_type: row.structure_type as ConversionStructureType,
    publication_status: row.publication_status,
  };
}

function toStructureState(
  dramaId: string,
  structureType: ConversionStructureType,
  seasonRows: readonly ConversionSeasonState[],
  episodeRows: readonly ConversionEpisodeState[]
): ConversionStructureState {
  return {
    dramaId,
    structureType,
    seasons: [...seasonRows],
    episodes: [...episodeRows],
  };
}

/** Load the drama, its active structure, and its available snapshot. */
export async function loadConversionContext(
  actor: ActorContext,
  dramaId: string
): Promise<ConversionContext> {
  requirePermission(actor, MANAGE_PERMISSION);

  // A malformed id is a missing drama, not a server error: the page turns the
  // not-found error into a 404 instead of a 500.
  const parsedId = z.uuid().safeParse(dramaId);

  if (!parsedId.success) {
    throw new NotFoundError('Drama not found.');
  }

  const parsedDramaId = parsedId.data;

  const [drama] = await db
    .select()
    .from(dramas)
    .where(and(eq(dramas.id, parsedDramaId), isNull(dramas.deleted_at)));

  if (!drama) {
    throw new NotFoundError('Drama not found.');
  }

  if (drama.structure_type !== 'flat' && drama.structure_type !== 'season_based') {
    throw new ConflictError('The drama has an unsupported structure type.');
  }

  const [seasonRows, episodeRows, availableSnapshot] = await Promise.all([
    readActiveSeasonsTx(db, parsedDramaId),
    readActiveEpisodesTx(db, parsedDramaId),
    readAvailableSnapshotTx(db, parsedDramaId),
  ]);

  return {
    drama: {
      id: drama.id,
      title: drama.title,
      structureType: drama.structure_type,
      publicationStatus: drama.publication_status,
    },
    seasons: seasonRows,
    episodes: episodeRows,
    availableSnapshot,
  };
}

/** List active dramas with their active episode count for the conversion page. */
export async function listConversionCandidates(
  actor: ActorContext,
  query: ConversionListQuery
): Promise<{
  items: ConversionListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  requirePermission(actor, MANAGE_PERMISSION);

  const conditions = [isNull(dramas.deleted_at)];

  if (query.search.length > 0) {
    conditions.push(sql`${dramas.title} ILIKE ${`%${query.search}%`}`);
  }

  const [totalRow] = await db
    .select({ total: count() })
    .from(dramas)
    .where(and(...conditions));

  const total = Number(totalRow?.total ?? 0);
  const offset = (query.page - 1) * query.pageSize;
  const sortColumn = query.sortBy === 'createdAt' ? dramas.created_at : dramas.title;
  const orderBy = query.sortDirection === 'desc' ? desc(sortColumn) : asc(sortColumn);

  const rows = await db
    .select({
      id: dramas.id,
      title: dramas.title,
      structure_type: dramas.structure_type,
      created_at: dramas.created_at,
      activeEpisodes: count(episodes.id),
    })
    .from(dramas)
    .leftJoin(
      episodes,
      and(eq(episodes.drama_id, dramas.id), isNull(episodes.deleted_at))
    )
    .where(and(...conditions))
    .groupBy(dramas.id)
    // The id is a stable tiebreaker: without it, two dramas with the same
    // title could move between pages (CONVENTIONS §6.3).
    .orderBy(orderBy, asc(dramas.id))
    .limit(query.pageSize)
    .offset(offset);

  return {
    items: rows.map(row => ({
      id: row.id,
      title: row.title,
      structureType: row.structure_type as ConversionStructureType,
      activeEpisodes: Number(row.activeEpisodes ?? 0),
      createdAt: row.created_at.toISOString(),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
  };
}

// ----- strategy and restorability ------------------------------------------

function resolveStrategy(
  request: ConversionRequest,
  context: ConversionContext
): { strategy: ConversionStrategy; snapshot: SnapshotRow | null } {
  if (request.targetStructureType === 'flat') {
    if (request.strategy === 'restore_snapshot') {
      throw new ValidationError(
        'Restoring a snapshot is only available when converting to a season-based structure.'
      );
    }
    return { strategy: 'convert', snapshot: null };
  }

  if (context.availableSnapshot) {
    if (!request.strategy) {
      throw new ValidationError(
        'An available conversion snapshot exists. Choose "convert" or "restore_snapshot".',
        { strategy: ['Choose "convert" or "restore_snapshot".'] }
      );
    }

    if (request.strategy === 'restore_snapshot') {
      if (request.distribution !== undefined) {
        throw new ValidationError('A snapshot restore cannot include a distribution.');
      }
      if (
        request.snapshotId !== undefined &&
        request.snapshotId !== context.availableSnapshot.id
      ) {
        throw new ValidationError('The requested snapshot is not available for this drama.');
      }
      return { strategy: 'restore_snapshot', snapshot: context.availableSnapshot };
    }

    return { strategy: 'convert', snapshot: context.availableSnapshot };
  }

  if (request.strategy === 'restore_snapshot') {
    throw new ValidationError('No available conversion snapshot exists for this drama.');
  }

  return { strategy: 'convert', snapshot: null };
}

/**
 * Parse a stored snapshot payload.
 *
 * A malformed payload is corrupted stored data, not a stale structure: it is
 * a server error, and it must never be reported as an ordinary conflict or
 * silently restored.
 */
function parseStoredSnapshot(snapshot: SnapshotRow): SnapshotPayload {
  try {
    return parseSnapshotPayload({
      seasons: snapshot.season_data,
      episodes: snapshot.episode_data,
    });
  } catch (error) {
    throw new InternalError(
      'The stored conversion snapshot is invalid.',
      error instanceof Error ? error : undefined
    );
  }
}

async function checkSnapshotRestorable(
  tx: DbOrTx,
  dramaId: string,
  snapshot: SnapshotRow,
  state: ConversionStructureState
): Promise<{ restorable: boolean; reason: string | null; payload: SnapshotPayload | null }> {
  const payload = parseStoredSnapshot(snapshot);

  if (snapshot.post_conversion_fingerprint !== computeStructureFingerprint(state)) {
    return {
      restorable: false,
      reason:
        'The current structure changed after the conversion. A new distribution conversion is required.',
      payload,
    };
  }

  const seasonIds = snapshotSeasonIds(payload);
  const episodeIds = snapshotEpisodeIds(payload);

  if (seasonIds.size > 0) {
    const seasonRows = await tx
      .select({ id: seasons.id })
      .from(seasons)
      .where(and(eq(seasons.drama_id, dramaId), inArray(seasons.id, [...seasonIds])));

    if (seasonRows.length !== seasonIds.size) {
      return {
        restorable: false,
        reason: 'A season from the snapshot no longer exists. The snapshot cannot be restored.',
        payload,
      };
    }
  }

  if (episodeIds.size > 0) {
    const episodeRows = await tx
      .select({ id: episodes.id, deleted_at: episodes.deleted_at })
      .from(episodes)
      .where(and(eq(episodes.drama_id, dramaId), inArray(episodes.id, [...episodeIds])));

    if (episodeRows.length !== episodeIds.size) {
      return {
        restorable: false,
        reason: 'An episode from the snapshot no longer exists. The snapshot cannot be restored.',
        payload,
      };
    }

    if (episodeRows.some(row => row.deleted_at !== null)) {
      return {
        restorable: false,
        reason: 'An episode from the snapshot is in Trash. The snapshot cannot be restored.',
        payload,
      };
    }
  }

  const activeRows = await tx
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.drama_id, dramaId), isNull(episodes.deleted_at)));

  const activeIds = new Set(activeRows.map(row => row.id));
  const sameSet =
    activeIds.size === episodeIds.size && [...episodeIds].every(id => activeIds.has(id));

  if (!sameSet) {
    return {
      restorable: false,
      reason: 'The active episode set changed. A new distribution conversion is required.',
      payload,
    };
  }

  return { restorable: true, reason: null, payload };
}

// ----- preview --------------------------------------------------------------

/** Build a conversion preview without writing anything. */
export async function previewConversion(
  actor: ActorContext,
  input: unknown
): Promise<ConversionPlan> {
  requirePermission(actor, MANAGE_PERMISSION);

  const request = parseConversionRequest(input);
  if (request.mode !== 'preview') {
    throw new ValidationError('Preview requires mode "preview".');
  }

  const context = await loadConversionContext(actor, request.dramaId);
  const state = toStructureState(
    context.drama.id,
    context.drama.structureType,
    context.seasons,
    context.episodes
  );

  if (request.targetStructureType === context.drama.structureType) {
    throw new ConflictError(`The drama is already ${request.targetStructureType}.`);
  }

  const { strategy, snapshot } = resolveStrategy(request, context);

  if (request.targetStructureType === 'flat') {
    return buildFlatConversionPlan(state);
  }

  if (strategy === 'restore_snapshot' && snapshot) {
    const restorable = await checkSnapshotRestorable(db, context.drama.id, snapshot, state);
    const payload = restorable.payload;

    if (!payload) {
      throw new ConflictError(restorable.reason ?? 'The stored snapshot cannot be restored.');
    }

    return buildRestoreSnapshotPlan(
      state,
      {
        id: snapshot.id,
        status: snapshot.status as SnapshotStatus,
        createdAt: snapshot.created_at.toISOString(),
        payload,
      },
      restorable.restorable,
      restorable.reason ?? undefined
    );
  }

  return buildSeasonConversionPlan(state, request.distribution);
}

// ----- apply ----------------------------------------------------------------

function postgresCode(error: unknown): string | null {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === 'object' && current !== null && 'code' in current) {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string') {
        return code;
      }
    }

    current =
      typeof current === 'object' && current !== null
        ? (current as { cause?: unknown }).cause
        : undefined;
  }

  return null;
}

function isSerializationFailure(error: unknown): boolean {
  return postgresCode(error) === '40001';
}

function isUniqueViolation(error: unknown): boolean {
  return postgresCode(error) === '23505';
}

function conflictAfterConcurrentChange(): ConflictError {
  return new ConflictError(
    'The drama changed while the conversion was being applied. Request a new preview.'
  );
}

async function supersedeAvailableSnapshot(tx: Tx, dramaId: string, now: Date): Promise<void> {
  await tx
    .update(structureConversionSnapshots)
    .set({
      status: 'superseded',
      superseded_at: now,
      updated_at: now,
    })
    .where(
      and(
        eq(structureConversionSnapshots.drama_id, dramaId),
        eq(structureConversionSnapshots.status, 'available')
      )
    );
}

/**
 * Apply a confirmed conversion. The fingerprint is verified after locking the
 * drama row and before any write; the whole operation is serializable.
 */
export async function applyConversion(
  actor: ActorContext,
  input: unknown
): Promise<ConversionApplyResult> {
  requirePermission(actor, MANAGE_PERMISSION);

  const request = parseConversionRequest(input);
  if (request.mode !== 'apply') {
    throw new ValidationError('Apply requires mode "apply".');
  }
  if (request.fingerprint === undefined) {
    throw new ValidationError('A preview fingerprint is required to apply a conversion.', {
      fingerprint: ['A preview fingerprint is required to apply a conversion.'],
    });
  }

  try {
    return await db.transaction(
      async tx => {
        const drama = await readDramaForUpdateTx(tx, request.dramaId);
        const seasonRows = await readActiveSeasonsTx(tx, drama.id);
        const episodeRows = await readActiveEpisodesTx(tx, drama.id);
        const state = toStructureState(
          drama.id,
          drama.structure_type,
          seasonRows,
          episodeRows
        );
        const availableSnapshot = await readAvailableSnapshotTx(tx, drama.id);
        const context: ConversionContext = {
          drama: {
            id: drama.id,
            title: drama.title,
            structureType: drama.structure_type,
            publicationStatus: drama.publication_status,
          },
          seasons: seasonRows,
          episodes: episodeRows,
          availableSnapshot,
        };

        if (request.fingerprint !== computeStructureFingerprint(state)) {
          throw new ConflictError(
            'The drama structure changed after the preview. Request a new preview.'
          );
        }

        if (request.targetStructureType === drama.structure_type) {
          throw new ConflictError(`The drama is already ${request.targetStructureType}.`);
        }

        const { strategy, snapshot } = resolveStrategy(request, context);
        const now = new Date();

        if (request.targetStructureType === 'flat') {
          return applyFlat(tx, drama.id, state, seasonRows, episodeRows, now);
        }

        if (strategy === 'restore_snapshot' && snapshot) {
          return applyRestore(tx, drama.id, snapshot, state, now);
        }

        return applySeasonConvert(
          tx,
          drama.id,
          request,
          state,
          snapshot?.id ?? null,
          now
        );
      },
      { isolationLevel: 'serializable' }
    );
  } catch (error) {
    if (isSerializationFailure(error) || isUniqueViolation(error)) {
      throw conflictAfterConcurrentChange();
    }
    throw error;
  }
}

async function applyFlat(
  tx: Tx,
  dramaId: string,
  state: ConversionStructureState,
  seasonRows: readonly ConversionSeasonState[],
  episodeRows: readonly ConversionEpisodeState[],
  now: Date
): Promise<ConversionApplyResult> {
  const plan = buildFlatConversionPlan(state);
  const payload = buildSnapshotPayload(seasonRows, episodeRows);
  const ordered = orderSeasonStructure(seasonRows, episodeRows);

  const flatState: ConversionStructureState = {
    dramaId,
    structureType: 'flat',
    seasons: [],
    episodes: ordered.episodes.map((episode, index) => ({
      ...episode,
      seasonId: null,
      episodeNumber: index + 1,
      position: index,
    })),
  };
  const postFingerprint = computeStructureFingerprint(flatState);

  await supersedeAvailableSnapshot(tx, dramaId, now);

  const [snapshot] = await tx
    .insert(structureConversionSnapshots)
    .values({
      drama_id: dramaId,
      source_structure_type: 'season_based',
      target_structure_type: 'flat',
      season_data: payload.seasons,
      episode_data: payload.episodes,
      post_conversion_fingerprint: postFingerprint,
      status: 'available',
      created_at: now,
      updated_at: now,
    })
    .returning();

  if (!snapshot) {
    throw new Error('Conversion snapshot insert returned no row.');
  }

  for (const planned of plan.episodes) {
    await tx
      .update(episodes)
      .set({
        season_id: null,
        episode_number: planned.toEpisodeNumber,
        position: planned.toPosition,
        updated_at: now,
      })
      .where(eq(episodes.id, planned.id));
  }

  await tx
    .update(seasons)
    .set({ deleted_at: now, updated_at: now })
    .where(and(eq(seasons.drama_id, dramaId), isNull(seasons.deleted_at)));

  await tx
    .update(dramas)
    .set({ structure_type: 'flat', updated_at: now })
    .where(eq(dramas.id, dramaId));

  return {
    ...plan,
    applied: true,
    newFingerprint: postFingerprint,
    snapshotId: snapshot.id,
    snapshotStatus: 'available',
  };
}

async function applySeasonConvert(
  tx: Tx,
  dramaId: string,
  request: ConversionRequest,
  state: ConversionStructureState,
  supersededSnapshotId: string | null,
  now: Date
): Promise<ConversionApplyResult> {
  const plan = buildSeasonConversionPlan(state, request.distribution);

  await supersedeAvailableSnapshot(tx, dramaId, now);

  const keyToId = new Map<string, string>();

  for (const plannedSeason of plan.seasons) {
    const [row] = await tx
      .insert(seasons)
      .values({
        drama_id: dramaId,
        title: plannedSeason.title,
        position: plannedSeason.position,
        created_at: now,
        updated_at: now,
      })
      .returning();

    if (!row) {
      throw new Error('Season insert returned no row.');
    }

    keyToId.set(plannedSeason.key, row.id);
  }

  for (const plannedEpisode of plan.episodes) {
    const seasonId =
      plannedEpisode.toSeasonKey === null
        ? null
        : keyToId.get(plannedEpisode.toSeasonKey) ?? null;

    await tx
      .update(episodes)
      .set({ season_id: seasonId, updated_at: now })
      .where(eq(episodes.id, plannedEpisode.id));
  }

  await tx
    .update(dramas)
    .set({ structure_type: 'season_based', updated_at: now })
    .where(eq(dramas.id, dramaId));

  const seasonState: ConversionSeasonState[] = plan.seasons.map(plannedSeason => ({
    id: keyToId.get(plannedSeason.key) ?? '',
    title: plannedSeason.title,
    position: plannedSeason.position,
    publicationStatus: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }));
  const episodeState: ConversionEpisodeState[] = plan.episodes.map(plannedEpisode => {
    const current = state.episodes.find(episode => episode.id === plannedEpisode.id);
    return {
      id: plannedEpisode.id,
      title: plannedEpisode.title,
      seasonId:
        plannedEpisode.toSeasonKey === null
          ? null
          : keyToId.get(plannedEpisode.toSeasonKey) ?? null,
      episodeNumber: plannedEpisode.toEpisodeNumber,
      position: plannedEpisode.toPosition,
      createdAt: current?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
  });

  return {
    ...plan,
    applied: true,
    newFingerprint: computeStructureFingerprint({
      dramaId,
      structureType: 'season_based',
      seasons: seasonState,
      episodes: episodeState,
    }),
    snapshotId: supersededSnapshotId,
    snapshotStatus: supersededSnapshotId === null ? null : 'superseded',
  };
}

async function applyRestore(
  tx: Tx,
  dramaId: string,
  snapshot: SnapshotRow,
  state: ConversionStructureState,
  now: Date
): Promise<ConversionApplyResult> {
  const restorable = await checkSnapshotRestorable(tx, dramaId, snapshot, state);

  if (!restorable.restorable || !restorable.payload) {
    throw new ConflictError(
      restorable.reason ?? 'The snapshot is stale. A new distribution conversion is required.'
    );
  }
  const payload = restorable.payload;
  const plan = buildRestoreSnapshotPlan(
    state,
    {
      id: snapshot.id,
      status: snapshot.status as SnapshotStatus,
      createdAt: snapshot.created_at.toISOString(),
      payload,
    },
    true
  );

  for (const season of payload.seasons) {
    await tx
      .update(seasons)
      .set({
        deleted_at: null,
        title: season.title,
        position: season.position,
        publication_status: season.publication_status,
        updated_at: now,
      })
      .where(and(eq(seasons.id, season.id), eq(seasons.drama_id, dramaId)));
  }

  for (const episode of payload.episodes) {
    await tx
      .update(episodes)
      .set({
        season_id: episode.season_id,
        episode_number: episode.episode_number,
        position: episode.position,
        updated_at: now,
      })
      .where(and(eq(episodes.id, episode.id), eq(episodes.drama_id, dramaId)));
  }

  await tx
    .update(dramas)
    .set({ structure_type: 'season_based', updated_at: now })
    .where(eq(dramas.id, dramaId));

  await tx
    .update(structureConversionSnapshots)
    .set({
      status: 'restored',
      restored_at: now,
      updated_at: now,
    })
    .where(eq(structureConversionSnapshots.id, snapshot.id));

  const seasonState: ConversionSeasonState[] = payload.seasons.map(season => ({
    id: season.id,
    title: season.title,
    position: season.position,
    publicationStatus: season.publication_status,
    createdAt: season.created_at,
    updatedAt: now.toISOString(),
  }));
  const currentById = new Map(state.episodes.map(episode => [episode.id, episode]));
  const episodeState: ConversionEpisodeState[] = payload.episodes.map(episode => {
    const current = currentById.get(episode.id);
    return {
      id: episode.id,
      title: current?.title ?? episode.title,
      seasonId: episode.season_id,
      episodeNumber: episode.episode_number,
      position: episode.position,
      createdAt: current?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
  });

  return {
    ...plan,
    applied: true,
    newFingerprint: computeStructureFingerprint({
      dramaId,
      structureType: 'season_based',
      seasons: seasonState,
      episodes: episodeState,
    }),
    snapshotId: snapshot.id,
    snapshotStatus: 'restored',
  };
}
