/**
 * Client-safe contract for the admin standalone-movie create/edit form.
 *
 * Mirrors the domain movie schema, with the same transport adaptations as the
 * drama form: the slug is derived from the title, and an empty artwork or video
 * input becomes `null` on the server. The domain schema remains authoritative.
 */

import { z } from 'zod';

import { imageReferenceSchema } from './media';
import { publicationReadyVideoSourceSchema } from '@/modules/content/validation';
import { SLUG_MAX_LENGTH, slugFromText } from './slug';

export const MOVIE_SLUG_MAX_LENGTH = SLUG_MAX_LENGTH;

/** Derive the canonical movie slug from its title. */
export function movieSlugFromTitle(title: string): string {
  return slugFromText(title);
}

export const movieFormSchema = z
  .strictObject({
    title: z
      .string()
      .trim()
      .min(1, 'Title is required.')
      .max(200, 'Title must be 200 characters or fewer.'),
    description: z.string().max(20_000, 'Description is too long.').optional(),
    poster: z.union([z.literal(''), imageReferenceSchema]).optional(),
    banner: z.union([z.literal(''), imageReferenceSchema]).optional(),
    video_source: z
      .union([z.literal(''), publicationReadyVideoSourceSchema])
      .optional(),
    categories: z.array(z.uuid()),
    platforms: z.array(z.uuid()),
  })
  .refine(values => movieSlugFromTitle(values.title).length > 0, {
    path: ['title'],
    message: 'Title must contain at least one Latin letter or number to generate a URL slug.',
  });

export type MovieFormValues = z.infer<typeof movieFormSchema>;

/** Initial values for a new standalone movie. */
export const MOVIE_FORM_DEFAULTS: Readonly<Record<string, unknown>> = {
  title: '',
  description: '',
  poster: '',
  banner: '',
  video_source: '',
  categories: [],
  platforms: [],
};
