import { z } from 'zod';

import { ValidationError } from '@/platform/errors';

/**
 * Playback input contracts.
 *
 * Two kinds of input reach the playback domain:
 *
 *  - Subtitle-track metadata, entered by an administrator and served to the
 *    browser. The browser fetches the subtitle file directly from the
 *    administrator-supplied HTTPS URL; the server never downloads it, so the
 *    URL rules below are the only place a bad value can be rejected.
 *  - Playback-failure reports, submitted by a viewer when an external source
 *    does not play. A report describes the failure and never carries the
 *    source URL: the report is a complaint about a source, not a copy of it.
 */

/** Subtitle file formats the player supports. */
export const SUBTITLE_FORMATS = ['vtt', 'srt', 'ssa', 'ass', 'json'] as const;

/** One supported subtitle file format. */
export const subtitleFormatSchema = z.enum(SUBTITLE_FORMATS);

export type SubtitleFormat = z.infer<typeof subtitleFormatSchema>;

/**
 * Direct HTTPS subtitle URL.
 *
 * The extension has to match one of the supported formats, but a matching
 * extension is not proof that the remote file parses: the browser is what
 * discovers that, and a failed track simply does not appear in the player.
 */
export const subtitleSourceUrlSchema = z
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

    const path = url.pathname.toLowerCase();
    const extension = path.slice(path.lastIndexOf('.') + 1);

    return SUBTITLE_FORMATS.includes(extension as SubtitleFormat);
  }, 'Subtitle source must be an absolute HTTPS URL ending in a supported subtitle format.');

/**
 * Subtitle-track metadata.
 *
 * `language` is a BCP 47 tag (`en`, `pt-BR`); `label` is what the player
 * shows (`English`). Both are required: a track without a language cannot be
 * selected by a viewer.
 */
export const subtitleTrackInputSchema = z
  .strictObject({
    episodeId: z.uuid(),
    language: z
      .string()
      .trim()
      .min(2)
      .max(35)
      .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Language must be a BCP 47 language tag.'),
    label: z.string().trim().min(1).max(100),
    // The URL rules are enforced here, on the server, and not only in the
    // client form: the server is the authority, and the browser fetches the
    // subtitle file directly from this URL.
    sourceUrl: subtitleSourceUrlSchema,
    format: subtitleFormatSchema,
    isDefault: z.boolean().default(false),
  })
  .refine(
    input => input.sourceUrl.toLowerCase().endsWith(`.${input.format}`),
    'Subtitle source extension must match the declared format.'
  );

export type SubtitleTrackInput = z.infer<typeof subtitleTrackInputSchema>;

/** Why a source failed to play. */
export const PLAYBACK_FAILURE_REASONS = [
  'network',
  'media',
  'cors',
  'unsupported',
  'unknown',
] as const;

/** One playback-failure reason. */
export const playbackFailureReasonSchema = z.enum(PLAYBACK_FAILURE_REASONS);

export type PlaybackFailureReason = z.infer<typeof playbackFailureReasonSchema>;

/**
 * A viewer-reported playback failure.
 *
 * The schema is strict on purpose: a report that carried a `sourceUrl` would
 * copy the administrator's source into the failure table, so an unknown field
 * is rejected rather than silently dropped.
 */
export const playbackFailureReportSchema = z.strictObject({
  episodeId: z.uuid(),
  reason: playbackFailureReasonSchema,
  detail: z.string().trim().max(2000).optional(),
});

export type PlaybackFailureReportInput = z.infer<typeof playbackFailureReportSchema>;

/** Parse subtitle-track metadata, throwing a validation error on failure. */
export function parseSubtitleTrackInput(input: unknown): SubtitleTrackInput {
  const parsed = subtitleTrackInputSchema.safeParse(input);

  if (!parsed.success) {
    const flattened = parsed.error.flatten();

    // A rule about the combination of two fields — the URL extension and the
    // declared format — is reported at the root of the payload. The
    // administrator still has to fix the URL, so the message is attached to
    // the URL field: that is where the form renders it.
    const formErrors = flattened.formErrors;
    const fieldErrors: Record<string, string[]> = { ...flattened.fieldErrors };

    if (formErrors.length > 0) {
      const existing = fieldErrors.sourceUrl ?? [];
      fieldErrors.sourceUrl = [...existing, ...formErrors];
    }

    throw new ValidationError('Invalid subtitle track.', fieldErrors);
  }

  return parsed.data;
}

/** Parse a playback-failure report, throwing a validation error on failure. */
export function parsePlaybackFailureReport(input: unknown): PlaybackFailureReportInput {
  const parsed = playbackFailureReportSchema.safeParse(input);

  if (!parsed.success) {
    throw new ValidationError('Invalid playback failure report.', parsed.error.flatten().fieldErrors);
  }

  return parsed.data;
}
