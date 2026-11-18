/**
 * Client-safe contract for the admin drama create form.
 *
 * `components/**` may import only `lib` and `lib/contracts`, so the form cannot
 * import the content module that owns the domain rules. This schema mirrors
 * `createDramaSchema` (`src/modules/content/validation.ts`): required fields,
 * Ongoing/Completed status, and both episode structures. The server re-validates
 * with the domain schema, which stays authoritative.
 *
 * The administrator never types a slug: it is derived from the title by
 * `dramaSlugFromTitle`, both in the form and, authoritatively, in the Server
 * Action. Differences from the domain shape are confined to transport:
 * - an empty poster/banner input is `''` here and becomes `null` server-side;
 * - categories/platforms are always arrays so checkbox groups are simple.
 *
 * No release-year field exists, as Prompt 053 requires.
 */

import { z } from 'zod';

import { SLUG_MAX_LENGTH, slugFromText } from './slug';

/** Maximum slug length shared with the domain schema. */
export const DRAMA_SLUG_MAX_LENGTH = SLUG_MAX_LENGTH;

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
 * Derive the canonical slug from a drama title.
 *
 * Delegates to the shared `slugFromText` rule; the drama contract keeps this
 * name because the form, the Server Action and the tests already use it.
 * A title written entirely in a non-Latin script yields `''` and is rejected
 * by the schema. The Server Action re-derives the slug from the validated
 * title, so a client cannot choose a slug for a new drama.
 */
export function dramaSlugFromTitle(title: string): string {
  return slugFromText(title);
}

/**
 * Form values.
 *
 * The schema declares every field with the same type on input and output (no
 * `.default()` / `.transform()`), so it satisfies the form shell's
 * `z.ZodType<Record<string, unknown>>` contract without an adapter. The title
 * refinement guarantees a slug can be derived before submission.
 */
export const dramaFormSchema = z
  .strictObject({
    title: z
      .string()
      .trim()
      .min(1, 'Title is required.')
      .max(200, 'Title must be 200 characters or fewer.'),
    description: z.string().max(20_000, 'Description is too long.').optional(),
    status: z.enum(['ongoing', 'completed']),
    structure_type: z.enum(['flat', 'season_based']),
    poster: z.union([z.string().trim().url('Poster must be a valid URL.'), z.literal('')]),
    banner: z.union([z.string().trim().url('Banner must be a valid URL.'), z.literal('')]),
    categories: z.array(z.uuid()),
    platforms: z.array(z.uuid()),
  })
  .refine(values => dramaSlugFromTitle(values.title).length > 0, {
    path: ['title'],
    message: 'Title must contain at least one Latin letter or number to generate a URL slug.',
  });

export type DramaFormValues = z.infer<typeof dramaFormSchema>;

/** Initial values for a new drama. */
export const DRAMA_FORM_DEFAULTS: Readonly<Record<string, unknown>> = {
  title: '',
  description: '',
  status: 'ongoing',
  structure_type: 'season_based',
  poster: '',
  banner: '',
  categories: [],
  platforms: [],
};
