/**
 * Client-safe schemas and types for the subtitle-track administration form.
 *
 * The track metadata is entered by an administrator and served to the
 * browser. The browser fetches the subtitle file directly from the external
 * host, so the URL rules are the only place a bad value can be stopped.
 *
 * The validation rules themselves live in the playback module; this file only
 * re-exports the parts a form needs and adds the episode binding, so the
 * client and the server agree on what a track is.
 */

import { z } from 'zod';

import {
  subtitleFormatSchema,
  subtitleSourceUrlSchema,
  type SubtitleFormat,
} from '@/modules/playback/validation';

/** The metadata of one subtitle track. */
export const subtitleTrackFormSchema = z.strictObject({
  /** The episode the track belongs to. */
  episodeId: z.string().uuid(),
  /** BCP 47 language tag, for example `en` or `pt-BR`. */
  language: z
    .string()
    .trim()
    .min(2, 'Language is required.')
    .max(35)
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Language must be a BCP 47 language tag.'),
  /** Human-readable label shown in the player, for example `English`. */
  label: z.string().trim().min(1, 'Label is required.').max(100),
  /** Direct HTTPS URL of the subtitle file. */
  sourceUrl: subtitleSourceUrlSchema,
  /** The subtitle file format. */
  format: subtitleFormatSchema,
  /** Whether the player selects this track by default. */
  isDefault: z.boolean(),
});

/** The payload that removes one subtitle track. */
export const deleteSubtitleTrackFormSchema = z.strictObject({
  episodeId: z.string().uuid(),
  trackId: z.string().uuid(),
});

export type SubtitleTrackFormValues = z.infer<typeof subtitleTrackFormSchema>;
export type DeleteSubtitleTrackFormValues = z.infer<typeof deleteSubtitleTrackFormSchema>;

/** A stored subtitle track as the administration UI consumes it. */
export type SubtitleTrackDto = {
  id: string;
  episodeId: string;
  language: string;
  label: string;
  sourceUrl: string;
  format: SubtitleFormat;
  isDefault: boolean;
};
