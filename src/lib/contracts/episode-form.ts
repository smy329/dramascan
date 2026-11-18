/**
 * Client-safe schemas and types for episode administration forms.
 */

import { z } from 'zod';
import { publicationReadyVideoSourceSchema } from '@/modules/content/validation';

export const episodeFormSchema = z.strictObject({
  dramaId: z.string().uuid(),
  title: z
    .string()
    .trim()
    .min(1, 'Title is required.')
    .max(200, 'Title must be 200 characters or fewer.'),
  description: z.string().trim().max(2000).optional(),
  season_id: z.string().uuid().optional(),
  episode_number: z.coerce.number().int().min(1).optional(),
  video_source: publicationReadyVideoSourceSchema.optional(),
});

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
  season_id: z.string().uuid().optional(),
  episode_number: z.coerce.number().int().min(1).optional(),
  video_source: publicationReadyVideoSourceSchema.optional(),
});

export const deleteEpisodeFormSchema = z.strictObject({
  id: z.string().uuid(),
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
