/**
 * Client-safe contracts for the category and platform admin screens.
 *
 * `components/**` may import only `lib` and `lib/contracts`, so the manager
 * cannot import the content module that owns the domain rules. These schemas
 * mirror the domain taxonomy schemas in `src/modules/content/validation.ts`:
 * the client validates before submitting, the Server Action re-validates with
 * the domain schema, and the workflow stays authoritative.
 *
 * The administrator never types a slug: it is derived from the name by
 * `taxonomySlugFromName`, both in the form and, authoritatively, in the
 * workflow. Platforms have no visibility, so their schemas are strict and
 * reject the key rather than silently dropping it.
 */

import { z } from 'zod';

import { slugFromText } from './slug';

/** Category visibility choices exposed by the form. */
export const CATEGORY_VISIBILITY_OPTIONS = [
  { value: 'visible', label: 'Visible' },
  { value: 'hidden', label: 'Hidden' },
] as const;

/**
 * Derive the canonical slug from a taxonomy name.
 *
 * Delegates to the shared `slugFromText` rule so a category, a platform and a
 * drama title cannot drift apart. A name written entirely in a non-Latin
 * script yields `''`, which callers reject rather than store.
 */
export function taxonomySlugFromName(name: string): string {
  return slugFromText(name);
}

/** Maximum taxonomy name length, shared with the domain schema. */
export const TAXONOMY_NAME_MAX_LENGTH = 80;

/** Display name of a category or platform. */
const taxonomyNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required.')
  .max(TAXONOMY_NAME_MAX_LENGTH, `Name must be ${TAXONOMY_NAME_MAX_LENGTH} characters or fewer.`);

/** Category visibility. */
const categoryVisibilitySchema = z.enum(['visible', 'hidden']);

/**
 * Create-category form values.
 *
 * Declares every field with the same type on input and output (no `.default()`
 * on visibility), so the shell's `z.ZodType<Record<string, unknown>>` contract
 * is satisfied without an adapter. The name refinement guarantees a slug can
 * be derived before submission.
 */
export const categoryFormSchema = z
  .strictObject({
    name: taxonomyNameSchema,
    visibility: categoryVisibilitySchema,
  })
  .refine(values => taxonomySlugFromName(values.name).length > 0, {
    path: ['name'],
    message: 'Name must contain at least one Latin letter or number to generate a slug.',
  });

export type CategoryFormValues = z.infer<typeof categoryFormSchema>;

/** Create-platform form values; platforms have no visibility. */
export const platformFormSchema = z
  .strictObject({
    name: taxonomyNameSchema,
  })
  .refine(values => taxonomySlugFromName(values.name).length > 0, {
    path: ['name'],
    message: 'Name must contain at least one Latin letter or number to generate a slug.',
  });

export type PlatformFormValues = z.infer<typeof platformFormSchema>;

/** Update-category payload: the full editable state of one row. */
export const updateCategoryFormSchema = z
  .strictObject({
    id: z.uuid(),
    name: taxonomyNameSchema,
    visibility: categoryVisibilitySchema,
  })
  .refine(values => taxonomySlugFromName(values.name).length > 0, {
    path: ['name'],
    message: 'Name must contain at least one Latin letter or number to generate a slug.',
  });

export type UpdateCategoryFormValues = z.infer<typeof updateCategoryFormSchema>;

/** Update-platform payload. */
export const updatePlatformFormSchema = z
  .strictObject({
    id: z.uuid(),
    name: taxonomyNameSchema,
  })
  .refine(values => taxonomySlugFromName(values.name).length > 0, {
    path: ['name'],
    message: 'Name must contain at least one Latin letter or number to generate a slug.',
  });

export type UpdatePlatformFormValues = z.infer<typeof updatePlatformFormSchema>;

/** Target of a soft delete. */
export const taxonomyIdFormSchema = z.strictObject({ id: z.uuid() });

export type TaxonomyIdFormValues = z.infer<typeof taxonomyIdFormSchema>;

/** Full display order of one taxonomy resource. */
export const reorderTaxonomyFormSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1),
});

export type ReorderTaxonomyFormValues = z.infer<typeof reorderTaxonomyFormSchema>;

/** Initial values for a new category. */
export const CATEGORY_FORM_DEFAULTS: Readonly<Record<string, unknown>> = {
  name: '',
  visibility: 'visible',
};

/** Initial values for a new platform. */
export const PLATFORM_FORM_DEFAULTS: Readonly<Record<string, unknown>> = {
  name: '',
};

/**
 * Serializable category or platform row.
 *
 * The page reads the workflow row and passes this shape to the client manager;
 * `visibility` is `null` for platforms, which have no visibility column value.
 */
export type TaxonomyDto = {
  id: string;
  name: string;
  slug: string;
  position: number | null;
  visibility: string | null;
  usageCount: number;
};
