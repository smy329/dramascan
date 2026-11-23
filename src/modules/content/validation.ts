import { z } from 'zod';

import { ValidationError } from '@/platform/errors';
import { imageReferenceSchema } from '@/lib/contracts/media';

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
  .refine(value => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }

    if (url.protocol !== 'https:') return false;
    if (url.username !== '' || url.password !== '') return false;
    return url.pathname.toLowerCase().endsWith('.mp4');
  }, 'Video source must be an absolute HTTPS URL whose path ends in .mp4.');

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
  // `null` clears an image; omitted fields are also stored as null. Accepted
  // references are managed `/media` paths or absolute HTTP(S) URLs.
  poster: imageReferenceSchema.nullable().default(null),
  banner: imageReferenceSchema.nullable().default(null),
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
export const updateDramaSchema = createDramaSchema.omit({ structure_type: true }).extend({
  structure_type: z.enum(['flat', 'season_based']).optional(),
  visibility: dramaVisibilitySchema.optional(),
  // The admin edit form has no slug input: the title stays the source of the
  // canonical slug. API callers may still rename a drama explicitly.
  slug: slugSchema.optional(),
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

/**
 * The administrator's preview confirmation.
 *
 * The browser is the only component that can prove that an external source
 * plays: the server never fetches the URL, so it cannot make the same check.
 * A source may therefore only be stored when the payload carries the
 * administrator's explicit confirmation that the browser preview verified it.
 *
 * The flag is a declaration, not a proof — the server has no way to check it —
 * which is exactly why it travels with the payload instead of being inferred
 * from the URL.
 */
export const VIDEO_SOURCE_PREVIEW_REQUIRED_MESSAGE =
  'Preview the video source in the browser and confirm that it plays before it is stored.';

/**
 * A preview confirmation.
 *
 * The value has to be `true`: `false` is a refusal, and a missing value is no
 * confirmation at all.
 */
export const videoSourcePreviewConfirmedSchema = z
  .boolean()
  .refine(value => value === true, VIDEO_SOURCE_PREVIEW_REQUIRED_MESSAGE);

/**
 * Require the preview confirmation whenever the payload carries a source.
 *
 * The issue is attached to the source field, so the form renders it next to the
 * input the administrator has to fix.
 */
export function requireVideoSourcePreviewConfirmation(
  value: {
    video_source?: string | undefined;
    video_source_preview_confirmed?: boolean | undefined;
  },
  ctx: z.RefinementCtx
): void {
  if (value.video_source !== undefined && value.video_source_preview_confirmed !== true) {
    ctx.addIssue({
      code: 'custom',
      path: ['video_source'],
      message: VIDEO_SOURCE_PREVIEW_REQUIRED_MESSAGE,
    });
  }
}

/**
 * Episode create schema with minimal metadata.
 *
 * The parent drama is the workflow's `dramaId` argument, never a body field:
 * a second, ignored parent source is how an episode ends up validated against
 * the wrong drama (H-05). `season_id` is the only parent a payload may name,
 * and the workflow proves it belongs to that drama.
 *
 * A source may only be stored after the administrator previewed it in the
 * browser, so a payload that carries a source has to carry the confirmation
 * as well.
 */
export const createEpisodeSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200),
    description: z.string().optional(),
    episode_number: z.coerce.number().int().min(1).optional(),
    position: z.coerce.number().int().min(0).optional(),
    season_id: z.string().uuid().optional(),
    video_source: publicationReadyVideoSourceSchema.optional(),
    video_source_preview_confirmed: z.boolean().optional(),
  })
  .superRefine(requireVideoSourcePreviewConfirmation);

export type CreateEpisodeInput = z.infer<typeof createEpisodeSchema>;

/** Parse create episode input, throwing a REST-safe validation error on failure. */
export function parseCreateEpisodeInput(input: unknown): CreateEpisodeInput {
  return parseOrThrow(createEpisodeSchema, input);
}

/**
 * Video-source replacement payload.
 *
 * The source of an existing episode is replaced only after the browser preview
 * proved that the new URL plays and the administrator confirmed it. The
 * confirmation travels with the payload; the server re-validates the URL and
 * applies the replacement in one transaction.
 */
export const replaceEpisodeVideoSourceSchema = z.strictObject({
  videoSource: publicationReadyVideoSourceSchema,
  previewConfirmed: videoSourcePreviewConfirmedSchema,
});

export type ReplaceEpisodeVideoSourceInput = z.infer<typeof replaceEpisodeVideoSourceSchema>;

/** Parse a video-source replacement payload, throwing a validation error on failure. */
export function parseReplaceEpisodeVideoSourceInput(
  input: unknown
): ReplaceEpisodeVideoSourceInput {
  return parseOrThrow(replaceEpisodeVideoSourceSchema, input);
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
  poster: imageReferenceSchema.nullable().default(null),
  banner: imageReferenceSchema.nullable().default(null),
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

// ----- taxonomy -------------------------------------------------------------

/** Category visibility modes. Stored and returned, not yet enforced per viewer. */
export const categoryVisibilitySchema = z.enum(['visible', 'hidden']);

/** Display name of a category or platform; the slug is always derived. */
const taxonomyNameSchema = z.string().trim().min(1).max(80);

/** Category create payload. `slug` is derived by the workflow, never accepted. */
export const createCategorySchema = z.strictObject({
  name: taxonomyNameSchema,
  visibility: categoryVisibilitySchema.default('visible'),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/** Category edit payload; every field is optional. */
export const updateCategorySchema = z.strictObject({
  name: taxonomyNameSchema.optional(),
  visibility: categoryVisibilitySchema.optional(),
});

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

/** Platform create payload. Platforms have no visibility. */
export const createPlatformSchema = z.strictObject({
  name: taxonomyNameSchema,
});

export type CreatePlatformInput = z.infer<typeof createPlatformSchema>;

/** Platform edit payload. */
export const updatePlatformSchema = z.strictObject({
  name: taxonomyNameSchema.optional(),
});

export type UpdatePlatformInput = z.infer<typeof updatePlatformSchema>;

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
  fingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  /**
   * Digest of the previewed plan. It binds an apply request to the exact plan
   * the administrator saw, so a distribution edited after the preview cannot be
   * applied behind their back (SUP-01).
   */
  planDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
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
