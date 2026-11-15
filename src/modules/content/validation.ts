import { z } from 'zod';

import { ValidationError } from '@/platform/errors';

/** Slug pattern: lowercase alphanumeric plus hyphens, no leading/trailing hyphens. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 100;

/** Shared slug contract for content types that have a canonical URL segment. */
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_SLUG_LENGTH)
  .regex(SLUG_PATTERN, 'Slug must be lowercase alphanumeric with hyphens');

/** Drama status enum. */
export const dramaStatusSchema = z.enum(['ongoing', 'completed']);

/**
 * Canonical publication vocabulary for every content type.
 *
 * `trashed` is a view derived from `deleted_at`, never a stored value.
 */
export const publicationStatusSchema = z.enum(['draft', 'published', 'unpublished']);

/** Publication target of a manual publish/unpublish request. */
export const publicationContentTypeSchema = z.enum(['drama', 'season', 'episode', 'movie']);

/** Manual publication action. */
export const publicationActionSchema = z.enum(['publish', 'unpublish']);

/** Maximum number of items a single bulk publication request may carry. */
export const PUBLICATION_REQUEST_LIMIT = 200;

/**
 * Publication-ready direct media URL.
 *
 * The server never fetches, proxies, or probes the URL: this validates syntax,
 * scheme, credentials, and the `.mp4` path format only. A matching suffix is
 * not proof that the remote resource is a playable MP4; the admin preview
 * remains responsible for actual playback verification.
 */
export const publicationReadyVideoSourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    value => {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }

      if (url.protocol !== 'https:') return false;
      if (url.username !== '' || url.password !== '') return false;
      return url.pathname.toLowerCase().endsWith('.mp4');
    },
    'Video source must be an absolute HTTPS URL whose path ends in .mp4.'
  );

/** Bulk publish/unpublish request. Malformed ids are reported per item. */
export const publicationRequestSchema = z.strictObject({
  contentType: publicationContentTypeSchema,
  action: publicationActionSchema,
  ids: z.array(z.string().trim().min(1)).min(1).max(PUBLICATION_REQUEST_LIMIT),
});

export type PublicationContentType = z.infer<typeof publicationContentTypeSchema>;
export type PublicationAction = z.infer<typeof publicationActionSchema>;
export type PublicationRequest = z.infer<typeof publicationRequestSchema>;

/** Parse a bulk publication request, throwing a REST-safe validation error. */
export function parsePublicationRequest(input: unknown): PublicationRequest {
  return parseOrThrow(publicationRequestSchema, input);
}

/** Drama visibility modes. */
export const dramaVisibilitySchema = z.enum(['coming_soon', 'hidden']);

export type DramaVisibility = z.infer<typeof dramaVisibilitySchema>;

/** Drama create/edit schema with full metadata support. */
export const createDramaSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  slug: slugSchema,
  description: z.string().optional(),
  status: dramaStatusSchema.default('ongoing'),
  structure_type: z.enum(['flat', 'season_based']).default('season_based'),
  visibility: dramaVisibilitySchema.default('coming_soon'),
  // `null` clears an image; omitted fields are also stored as null.
  poster: z.string().url().nullable().default(null),
  banner: z.string().url().nullable().default(null),
  // Associations are replaced wholesale on update. Optional so callers that
  // only edit metadata do not have to resend them.
  categories: z.array(z.uuid()).max(100).optional(),
  platforms: z.array(z.uuid()).max(100).optional(),
});

export type CreateDramaInput = z.infer<typeof createDramaSchema>;

/** Parse create/edit drama input, throwing a REST-safe validation error on failure. */
export function parseCreateDramaInput(input: unknown): CreateDramaInput {
  return parseOrThrow(createDramaSchema, input);
}

/**
 * Drama update schema.
 *
 * `structure_type` is deliberately not defaulted here. A metadata update must
 * never move a drama between the season-based and flat structures: changing
 * the structure is the conversion workflow's job (`D-029`), because it has to
 * renumber episodes and store a restorable snapshot. An update may repeat the
 * stored value, but a different value is rejected as a conflict.
 */
export const updateDramaSchema = createDramaSchema
  .omit({ structure_type: true })
  .extend({
    structure_type: z.enum(['flat', 'season_based']).optional(),
    visibility: dramaVisibilitySchema.optional(),
  });

export type UpdateDramaInput = z.infer<typeof updateDramaSchema>;

/** Parse a drama update, throwing a REST-safe validation error on failure. */
export function parseUpdateDramaInput(input: unknown): UpdateDramaInput {
  return parseOrThrow(updateDramaSchema, input);
}

/** Shared parse-or-throw helper. */
export function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};

    for (const issue of parsed.error.issues) {
      const field = issue.path.length > 0 ? String(issue.path[0]) : 'form';
      const messages = fieldErrors[field] ?? [];
      messages.push(issue.message);
      fieldErrors[field] = messages;
    }

    throw new ValidationError('The request contains invalid fields.', fieldErrors);
  }

  return parsed.data;
}

/** Episode create schema with minimal metadata. */
export const createEpisodeSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: z.string().optional(),
  episode_number: z.coerce.number().int().min(1).optional(),
  position: z.coerce.number().int().min(0).default(0),
  season_id: z.string().uuid().optional(),
  drama_id: z.string().uuid(),
  video_source: publicationReadyVideoSourceSchema.optional(),
});

export type CreateEpisodeInput = z.infer<typeof createEpisodeSchema>;

/** Parse create episode input, throwing a REST-safe validation error on failure. */
export function parseCreateEpisodeInput(input: unknown): CreateEpisodeInput {
  return parseOrThrow(createEpisodeSchema, input);
}

// ----- standalone movies ----------------------------------------------------

/**
 * A standalone movie is an independent content type. It never has a drama,
 * season, or episode parent; its metadata and single direct video source live
 * on the `movies` row.
 */

/** Stored movie publication states. `trashed` is a view, not a stored state. */
export const moviePublicationStatusSchema = publicationStatusSchema;

/**
 * Administrator-supplied direct media URL. The URL is stored and handed to the
 * viewer's browser; the server never fetches, proxies, or validates the file
 * itself, so only syntax, scheme, credentials, and the `.mp4` path format are
 * enforced here.
 */
export const movieVideoSourceSchema = publicationReadyVideoSourceSchema;

/** Movie create/edit schema. Update replaces the full payload. */
export const createMovieSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  slug: slugSchema,
  description: z.string().max(20_000).optional(),
  poster: z.string().url().nullable().default(null),
  banner: z.string().url().nullable().default(null),
  video_source: movieVideoSourceSchema.nullable().default(null),
  categories: z.array(z.uuid()).max(100).default([]),
  platforms: z.array(z.uuid()).max(100).default([]),
});

export type CreateMovieInput = z.infer<typeof createMovieSchema>;

/** Movie updates use the same full-payload contract as creation. */
export const updateMovieSchema = createMovieSchema;

/** Parse create movie input, throwing a REST-safe validation error on failure. */
export function parseCreateMovieInput(input: unknown): CreateMovieInput {
  return parseOrThrow(createMovieSchema, input);
}

/** Parse update movie input, throwing a REST-safe validation error on failure. */
export function parseUpdateMovieInput(input: unknown): CreateMovieInput {
  return parseOrThrow(updateMovieSchema, input);
}

// ----- structure conversion -------------------------------------------------

/** Stored drama structure types. */
export const conversionStructureTypeSchema = z.enum(['flat', 'season_based']);

/** How a flat drama becomes season-based. */
export const conversionStrategySchema = z.enum(['convert', 'restore_snapshot']);

/** Snapshot lifecycle states. */
export const snapshotStatusSchema = z.enum(['available', 'restored', 'superseded']);

/** Administrator-supplied season definition. `key` is an opaque assignment target. */
export const conversionSeasonInputSchema = z.strictObject({
  key: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(100),
  position: z.number().int().min(0).optional(),
});

/** Assignment of one active episode to one supplied season key. */
export const conversionAssignmentInputSchema = z.strictObject({
  episodeId: z.uuid(),
  seasonKey: z.string().trim().min(1).max(64),
});

/** Full flat → season distribution payload. */
export const conversionDistributionSchema = z.strictObject({
  seasons: z.array(conversionSeasonInputSchema).min(1).max(100),
  assignments: z.array(conversionAssignmentInputSchema).max(10_000),
});

/** Conversion preview/apply request. */
export const conversionRequestSchema = z.strictObject({
  dramaId: z.uuid(),
  mode: z.enum(['preview', 'apply']),
  targetStructureType: conversionStructureTypeSchema,
  strategy: conversionStrategySchema.optional(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  snapshotId: z.uuid().optional(),
  distribution: conversionDistributionSchema.optional(),
});

export type ConversionStructureType = z.infer<typeof conversionStructureTypeSchema>;
export type ConversionStrategy = z.infer<typeof conversionStrategySchema>;
export type SnapshotStatus = z.infer<typeof snapshotStatusSchema>;
export type ConversionSeasonInput = z.infer<typeof conversionSeasonInputSchema>;
export type ConversionAssignmentInput = z.infer<typeof conversionAssignmentInputSchema>;
export type ConversionDistributionInput = z.infer<typeof conversionDistributionSchema>;
export type ConversionRequest = z.infer<typeof conversionRequestSchema>;

/** Parse a conversion request, throwing a REST-safe validation error on failure. */
export function parseConversionRequest(input: unknown): ConversionRequest {
  return parseOrThrow(conversionRequestSchema, input);
}

// ----- drama → movie conversion ---------------------------------------------

/** Preview/apply request for converting a single-episode drama into a movie. */
export const movieConversionRequestSchema = z.strictObject({
  dramaId: z.uuid(),
  mode: z.enum(['preview', 'apply']),
  fingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});

export type MovieConversionRequest = z.infer<typeof movieConversionRequestSchema>;

/** Parse a drama → movie conversion request. */
export function parseMovieConversionRequest(input: unknown): MovieConversionRequest {
  return parseOrThrow(movieConversionRequestSchema, input);
}

/** Parsed season row inside a stored conversion snapshot. */
export const snapshotSeasonPayloadSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().trim().min(1).max(100),
  position: z.number().int().nullable(),
  publication_status: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** Parsed episode row inside a stored conversion snapshot. */
export const snapshotEpisodePayloadSchema = z.strictObject({
  id: z.uuid(),
  season_id: z.uuid().nullable(),
  episode_number: z.number().int().nullable(),
  position: z.number().int().nullable(),
  title: z.string(),
});

/** Exact structure payload stored before a season-based → flat conversion. */
export const snapshotPayloadSchema = z.strictObject({
  seasons: z.array(snapshotSeasonPayloadSchema),
  episodes: z.array(snapshotEpisodePayloadSchema),
});

export type SnapshotSeasonPayload = z.infer<typeof snapshotSeasonPayloadSchema>;
export type SnapshotEpisodePayload = z.infer<typeof snapshotEpisodePayloadSchema>;
export type SnapshotPayload = z.infer<typeof snapshotPayloadSchema>;
