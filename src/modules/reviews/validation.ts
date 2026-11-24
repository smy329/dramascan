import { z } from 'zod';

import { REVIEW_REPORT_REASON_VALUES, type ReviewReportReason } from './report-reasons';

/**
 * Runtime validation for the reviews module.
 *
 * Server Action arguments arrive as untrusted request data. A TypeScript
 * annotation proves nothing at runtime, so every value that crosses the
 * entrypoint boundary is parsed here before it reaches a service.
 *
 * The schemas are deliberately strict: a value that is not exactly one of the
 * documented choices is rejected instead of being coerced into one.
 */

/** The content kinds a rating or a review may target. Episodes are excluded. */
export const reviewContentTypeSchema = z.enum(['drama', 'movie']);

/** The five-point scale. Only whole stars from one to five are accepted. */
export const ratingValueSchema = z
  .number()
  .int('A rating must be a whole number of stars.')
  .min(1, 'A rating must be between 1 and 5.')
  .max(5, 'A rating must be between 1 and 5.');

/** A UUID identifier supplied by the client. */
export const reviewIdSchema = z.string().uuid('A valid id is required.');

/** The reasons a viewer may report a review for (requirements §7.5). */
export const reviewReportReasonSchema = z.enum(REVIEW_REPORT_REASON_VALUES);

export type { ReviewReportReason } from './report-reasons';
export type { ReviewReportReasonOption } from './report-reasons';

/** The canonical report-reason catalog, with the labels the UI shows. */
export {
  REVIEW_REPORT_REASONS,
  REVIEW_REPORT_REASON_VALUES,
  isReviewReportReason,
} from './report-reasons';

/** The review body. Long enough to be a real review, short enough to read. */
export const reviewContentSchema = z
  .string()
  .trim()
  .min(1, 'A review cannot be empty.')
  .max(5000, 'A review cannot be longer than 5000 characters.');

/** The optional review title. */
export const reviewTitleSchema = z
  .string()
  .trim()
  .max(200, 'A review title cannot be longer than 200 characters.')
  .nullable()
  .optional();

/** The optional free-text description attached to a report. */
export const reportDescriptionSchema = z
  .string()
  .trim()
  .max(1000, 'A description cannot be longer than 1000 characters.')
  .nullable()
  .optional();

/** The outcome a moderator records when resolving a report. */
export const resolutionOutcomeSchema = z
  .string()
  .trim()
  .min(1, 'A resolution outcome is required.')
  .max(1000, 'A resolution outcome cannot be longer than 1000 characters.');

/** The approved review sort orders. */
export const reviewSortSchema = z.enum(['most-enjoying', 'newest', 'highest-rated']);

export type ReviewSort = z.infer<typeof reviewSortSchema>;

/** Parse a rating value, returning a validation error message on failure. */
export function parseRatingValue(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const parsed = ratingValueSchema.safeParse(value);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid rating.' };
  }

  return { ok: true, value: parsed.data };
}

/** Parse a report reason, returning a validation error message on failure. */
export function parseReportReason(
  value: unknown
): { ok: true; value: ReviewReportReason } | { ok: false; error: string } {
  const parsed = reviewReportReasonSchema.safeParse(value);

  if (!parsed.success) {
    return { ok: false, error: 'Choose a valid report reason.' };
  }

  return { ok: true, value: parsed.data };
}
