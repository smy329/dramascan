/**
 * Client-safe schemas and types for episode administration forms.
 */

import { z } from 'zod';

import {
  publicationReadyVideoSourceSchema,
  requireVideoSourcePreviewConfirmation,
  videoSourcePreviewConfirmedSchema,
} from '@/modules/content/validation';

/**
 * Treat a blank string as "not provided".
 *
 * The episode form leaves optional fields (season, episode number) empty when
 * the administrator does not want to set them. React Hook Form submits those
 * as `''`, which would otherwise fail `z.uuid()` or be coerced to `0` and then
 * fail `min(1)`. Mapping `''` to `undefined` in the schema keeps the client
 * (zodResolver) and the server (parseOrThrow) in agreement: blank means unset.
 */
const blankToUndefined = <T>(schema: z.ZodType<T>): z.ZodType<T | undefined> =>
  z.preprocess(
    (value) => (value === '' || value === undefined || value === null ? undefined : value),
    schema.optional()
  );

/**
 * Episode create payload.
 *
 * The source is stored only after the browser preview proved that it plays, so
 * a payload that carries a source has to carry the administrator's
 * confirmation. The rule itself lives in the content module — the server
 * applies it again — and is composed here so the client and the server never
 * disagree about it.
 */
export const episodeFormSchema = z
  .strictObject({
    dramaId: z.string().uuid(),
    title: z
      .string()
      .trim()
      .min(1, 'Title is required.')
      .max(200, 'Title must be 200 characters or fewer.'),
    description: z.string().trim().max(2000).optional(),
    season_id: blankToUndefined(z.string().uuid()),
    episode_number: blankToUndefined(z.coerce.number().int().min(1)),
    video_source: blankToUndefined(publicationReadyVideoSourceSchema),
    video_source_preview_confirmed: z.boolean().optional(),
  })
  .superRefine(requireVideoSourcePreviewConfirmation);

export const updateEpisodeFormSchema = z.strictObject({
  id: z.string().uuid(),
  drama_id: z.string().uuid(),
  title: z
    .string()
    .trim()
    .min(1, 'Title is required.')
    .max(200, 'Title must be 200 characters or fewer.')
    .optional(),
  description: z.string().trim().max(2000).optional(),
  season_id: blankToUndefined(z.string().uuid()),
  episode_number: blankToUndefined(z.coerce.number().int().min(1)),
  video_source: publicationReadyVideoSourceSchema.optional(),
});

export const deleteEpisodeFormSchema = z.strictObject({
  id: z.string().uuid(),
});

/**
 * Video-source replacement payload.
 *
 * The source is replaced only after the administrator has watched the new URL
 * play in the browser preview and confirmed the replacement. The contract
 * carries the episode, the new URL, and that confirmation; the server
 * re-checks the URL.
 */
export const replaceVideoSourceFormSchema = z.strictObject({
  episodeId: z.string().uuid(),
  videoSource: publicationReadyVideoSourceSchema,
  previewConfirmed: videoSourcePreviewConfirmedSchema,
});

export const reorderEpisodesFormSchema = z.strictObject({
  drama_id: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(1, 'At least one episode ID is required.'),
});

export const renumberEpisodesFormSchema = z.strictObject({
  drama_id: z.string().uuid(),
});

export type EpisodeFormValues = z.infer<typeof episodeFormSchema>;
export type UpdateEpisodeFormValues = z.infer<typeof updateEpisodeFormSchema>;
export type DeleteEpisodeFormValues = z.infer<typeof deleteEpisodeFormSchema>;
export type ReplaceVideoSourceFormValues = z.infer<typeof replaceVideoSourceFormSchema>;
export type ReorderEpisodesFormValues = z.infer<typeof reorderEpisodesFormSchema>;
export type RenumberEpisodesFormValues = z.infer<typeof renumberEpisodesFormSchema>;

export type EpisodeDto = {
  id: string;
  dramaId: string;
  seasonId: string | null;
  title: string;
  description: string | null;
  episodeNumber: number | null;
  position: number | null;
  publicationStatus: string | null;
  videoSource: string | null;
  createdAt: string;
  updatedAt: string;
};
