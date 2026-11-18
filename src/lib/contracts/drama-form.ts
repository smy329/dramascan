/**
 * Client-safe contract for the admin drama create form.
 *
 * `components/**` may import only `lib` and `lib/contracts`, so the form cannot
 * import the content module that owns the domain rules. This schema mirrors
 * `createDramaSchema` (`src/modules/content/validation.ts`): required fields,
 * slug format, Ongoing/Completed status, and both episode structures. The
 * server re-validates with the domain schema, which stays authoritative.
 *
 * Differences are deliberate and confined to the transport shape:
 * - an empty poster/banner input is `''` here and becomes `null` server-side;
 * - categories/platforms are always arrays so checkbox groups are simple.
 *
 * No release-year field exists, as Prompt 053 requires.
 */

import { z } from 'zod';

/** Slug pattern shared with the domain schema. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Drama status choices exposed by the form. */
export const DRAMA_STATUS_OPTIONS = [
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
] as const;

/** Episode structure choices exposed by the form. */
export const DRAMA_STRUCTURE_OPTIONS = [
  { value: 'season_based', label: 'Season-based' },
  { value: 'flat', label: 'Flat (no seasons)' },
] as const;

/**
 * One selectable category or platform.
 *
 * The page reads the live taxonomy rows and passes this serializable shape to
 * the client component; the client never imports the content module.
 */
export type DramaTaxonomyOption = Readonly<{ id: string; name: string }>;

/**
 * Form values.
 *
 * The schema declares every field with the same type on input and output (no
 * `.default()` / `.transform()`), so it satisfies the form shell's
 * `z.ZodType<Record<string, unknown>>` contract without an adapter, while the
 * workflow still normalizes the empty-string media fields.
 */
export const dramaFormSchema = z.strictObject({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required.')
    .max(200, 'Title must be 200 characters or fewer.'),
  slug: z
    .string()
    .trim()
    .min(1, 'Slug is required.')
    .max(100, 'Slug must be 100 characters or fewer.')
    .regex(SLUG_PATTERN, 'Slug must be lowercase alphanumeric with hyphens.'),
  description: z.string().max(20_000, 'Description is too long.').optional(),
  status: z.enum(['ongoing', 'completed']),
  structure_type: z.enum(['flat', 'season_based']),
  poster: z.union([z.string().trim().url('Poster must be a valid URL.'), z.literal('')]),
  banner: z.union([z.string().trim().url('Banner must be a valid URL.'), z.literal('')]),
  categories: z.array(z.uuid()),
  platforms: z.array(z.uuid()),
});

export type DramaFormValues = z.infer<typeof dramaFormSchema>;

/** Initial values for a new drama. */
export const DRAMA_FORM_DEFAULTS: Readonly<Record<string, unknown>> = {
  title: '',
  slug: '',
  description: '',
  status: 'ongoing',
  structure_type: 'season_based',
  poster: '',
  banner: '',
  categories: [],
  platforms: [],
};
