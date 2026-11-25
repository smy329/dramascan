import { z } from 'zod';

import { ValidationError } from '@/platform/errors';

/**
 * The analytics request contracts (Prompts 139–142).
 *
 * The payloads are validated on the server, before any write. A client can
 * never assert a visitor, a content id it did not receive, or a watch
 * duration it did not earn.
 *
 * The contracts are pure: they hold no database and no content lookup, so
 * they can be imported by a unit test and by a server module alike. The
 * availability check of a content target lives beside them in
 * `analytics-targets.ts`.
 */

/** The content types a view can be counted for. */
export const analyticsContentTypeSchema = z.enum(['drama', 'movie']);

/** The payload of a view report. */
export const analyticsViewInputSchema = z.object({
  type: analyticsContentTypeSchema,
  contentId: z.string().uuid(),
});

/** The playback event types the player may report. */
export const analyticsPlaybackEventTypeSchema = z.enum([
  'play',
  'play_pause',
  'seek',
  'completion',
  'exit',
]);

/** The payload of a playback event report. */
export const analyticsPlaybackInputSchema = z
  .object({
    eventType: analyticsPlaybackEventTypeSchema,
    episodeId: z.string().uuid().optional(),
    dramaId: z.string().uuid().optional(),
    movieId: z.string().uuid().optional(),
    positionSeconds: z.number().finite().min(0).optional(),
    watchDurationSeconds: z.number().finite().min(0).optional(),
    completionThresholdMet: z.boolean().optional(),
  })
  .refine(
    value =>
      value.episodeId !== undefined && value.dramaId !== undefined ||
      value.movieId !== undefined,
    {
      message:
        'A playback event names either an episode with its drama, or a movie.',
    }
  )
  .transform(value => ({
    ...value,
    // A completion may only be asserted by a completion event. The player
    // sends the field on every event, so the field is honoured only where it
    // means something: a beacon that claims "the viewer finished" on a pause
    // is a claim the server refuses to record (D-070).
    completionThresholdMet:
      value.eventType === 'completion' ? value.completionThresholdMet === true : false,
  }));

/** A validated view report. */
export type AnalyticsViewInput = z.infer<typeof analyticsViewInputSchema>;

/** A validated playback event report. */
export type AnalyticsPlaybackInput = z.infer<typeof analyticsPlaybackInputSchema>;

/**
 * Parse a view report.
 *
 * @param input the raw payload
 * @returns the validated payload
 */
export function parseAnalyticsViewInput(input: unknown): AnalyticsViewInput {
  const parsed = analyticsViewInputSchema.safeParse(input);

  if (!parsed.success) {
    throw new ValidationError('The view report is not valid.', {
      body: parsed.error.issues.map(issue => issue.message),
    });
  }

  return parsed.data;
}

/**
 * Parse a playback event report.
 *
 * @param input the raw payload
 * @returns the validated payload
 */
export function parseAnalyticsPlaybackInput(input: unknown): AnalyticsPlaybackInput {
  const parsed = analyticsPlaybackInputSchema.safeParse(input);

  if (!parsed.success) {
    throw new ValidationError('The playback event is not valid.', {
      body: parsed.error.issues.map(issue => issue.message),
    });
  }

  return parsed.data;
}
