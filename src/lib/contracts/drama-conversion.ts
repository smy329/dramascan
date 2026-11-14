/**
 * Client-safe contract for the drama structure conversion panel.
 *
 * `components/**` may import only `lib` and `lib/contracts`, so the panel
 * cannot import the content module (which owns the domain rules and the
 * server-only fingerprint helper). This file declares the serializable shape
 * the admin page passes to the panel and the shape the Server Action returns.
 *
 * The domain module keeps its own equivalent types in
 * `src/modules/content/conversion.ts`; the workflow assigns its plan to
 * `ConversionPlanDto`, so the compiler rejects any drift between the two.
 */

import { z } from 'zod';

/** Stored drama structure types. */
export type ConversionStructureTypeDto = 'flat' | 'season_based';

/** How a flat drama becomes season-based. */
export type ConversionStrategyDto = 'convert' | 'restore_snapshot';

/** Snapshot lifecycle states. */
export type SnapshotStatusDto = 'available' | 'restored' | 'superseded';

/** One season in a conversion plan. */
export type ConversionPlanSeasonDto = {
  key: string;
  id: string | null;
  title: string;
  position: number;
  episodeCount: number;
};

/** One episode in a conversion plan. */
export type ConversionPlanEpisodeDto = {
  id: string;
  title: string;
  fromSeasonId: string | null;
  toSeasonKey: string | null;
  fromEpisodeNumber: number | null;
  toEpisodeNumber: number | null;
  fromPosition: number | null;
  toPosition: number | null;
};

/** Snapshot summary attached to a conversion plan. */
export type ConversionPlanSnapshotDto = {
  id: string;
  status: SnapshotStatusDto;
  createdAt: string;
  restorable: boolean;
};

/** The preview result of a conversion. */
export type ConversionPlanDto = {
  dramaId: string;
  currentStructureType: ConversionStructureTypeDto;
  targetStructureType: ConversionStructureTypeDto;
  strategy: ConversionStrategyDto;
  fingerprint: string;
  seasons: ConversionPlanSeasonDto[];
  episodes: ConversionPlanEpisodeDto[];
  counts: {
    activeEpisodes: number;
    seasonsAffected: number;
    seasonsCreated: number;
  };
  snapshot: ConversionPlanSnapshotDto | null;
  warnings: string[];
};

/**
 * Result of an applied conversion.
 *
 * The apply response is the plan shape plus the applied marker, the new
 * structure fingerprint, and the snapshot lifecycle fields.
 */
export type ConversionApplyResultDto = ConversionPlanDto & {
  applied: true;
  newFingerprint: string;
  snapshotId: string | null;
  snapshotStatus: SnapshotStatusDto | null;
};

/** One season in the administrator-supplied distribution map. */
export type ConversionSeasonInputDto = {
  key: string;
  title: string;
  position?: number;
};

/** Assignment of one episode to one supplied season key. */
export type ConversionAssignmentInputDto = {
  episodeId: string;
  seasonKey: string;
};

/** Full flat → season distribution payload. */
export type ConversionDistributionDto = {
  seasons: ConversionSeasonInputDto[];
  assignments: ConversionAssignmentInputDto[];
};

/** Request payload accepted by the preview and apply Server Actions. */
export type ConversionRequestDto = {
  mode: 'preview' | 'apply';
  targetStructureType: ConversionStructureTypeDto;
  strategy?: ConversionStrategyDto;
  fingerprint?: string;
  snapshotId?: string;
  distribution?: ConversionDistributionDto;
};

/** The same payload plus the drama it applies to. */
export type ConversionActionPayloadDto = ConversionRequestDto & {
  dramaId: string;
};

/**
 * Client-side shape of the flat → season distribution editor.
 *
 * The server validates the authoritative payload; this schema only keeps the
 * editor honest before a preview request is sent.
 */
export const conversionDistributionSchema = z.strictObject({
  seasons: z
    .array(
      z.strictObject({
        key: z.string().trim().min(1).max(64),
        title: z.string().trim().min(1).max(100),
        position: z.number().int().min(0),
      })
    )
    .min(1)
    .max(100),
  assignments: z
    .array(
      z.strictObject({
        episodeId: z.uuid(),
        seasonKey: z.string().trim().min(1).max(64),
      })
    )
    .max(10_000),
});

export type ConversionDistributionFormValues = z.infer<
  typeof conversionDistributionSchema
>;
