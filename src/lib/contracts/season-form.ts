/**
 * Client-safe schemas and types for season administration forms.
 */

import { z } from 'zod';

export const seasonFormSchema = z.strictObject({
  dramaId: z.string().uuid(),
  title: z
    .string()
    .trim()
    .min(1, 'Title is required.')
    .max(100, 'Title must be 100 characters or fewer.'),
  position: z.coerce.number().int().min(0).optional(),
});

export const updateSeasonFormSchema = z.strictObject({
  id: z.string().uuid(),
  title: z
    .string()
    .trim()
    .min(1, 'Title is required.')
    .max(100, 'Title must be 100 characters or fewer.')
    .optional(),
  position: z.coerce.number().int().min(0).optional(),
});

export const deleteSeasonFormSchema = z.strictObject({
  id: z.string().uuid(),
});

export const reorderSeasonsFormSchema = z.strictObject({
  drama_id: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(1, 'At least one season ID is required.'),
});

export type SeasonFormValues = z.infer<typeof seasonFormSchema>;
export type UpdateSeasonFormValues = z.infer<typeof updateSeasonFormSchema>;
export type DeleteSeasonFormValues = z.infer<typeof deleteSeasonFormSchema>;
export type ReorderSeasonsFormValues = z.infer<typeof reorderSeasonsFormSchema>;

export type SeasonDto = {
  id: string;
  dramaId: string;
  title: string;
  position: number;
  episodeCount: number;
  createdAt: string;
};
