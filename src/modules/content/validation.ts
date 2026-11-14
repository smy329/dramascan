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

/** Drama create/edit schema with full metadata support. */
export const createDramaSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  slug: slugSchema,
  description: z.string().optional(),
  status: dramaStatusSchema.default('ongoing'),
  structure_type: z.enum(['flat', 'season_based']).default('season_based'),
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

/** Episode status enum. */
export const episodeStatusSchema = z.enum(['ongoing', 'completed']);

/** Episode create schema with minimal metadata. */
export const createEpisodeSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: z.string().optional(),
  episode_number: z.coerce.number().int().min(1).optional(),
  position: z.coerce.number().int().min(0).default(0),
  publication_status: episodeStatusSchema.default('ongoing'),
  season_id: z.string().uuid().optional(),
  drama_id: z.string().uuid(),
  video_source: z.string().url().optional(),
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
export const moviePublicationStatusSchema = z.enum(['draft', 'published', 'unpublished']);

/**
 * Administrator-supplied direct media URL. The URL is stored and handed to the
 * viewer's browser; the server never fetches, proxies, or validates the file
 * itself, so only syntax and the HTTPS scheme are enforced here.
 */
export const movieVideoSourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(value => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Video source must be an absolute HTTPS URL.');

/** Movie create/edit schema. Update replaces the full payload. */
export const createMovieSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  slug: slugSchema,
  description: z.string().max(20_000).optional(),
  poster: z.string().url().nullable().default(null),
  banner: z.string().url().nullable().default(null),
  publication_status: moviePublicationStatusSchema.default('draft'),
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
