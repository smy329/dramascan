/**
 * User report reasons (canonical catalog).
 *
 * These reasons gate the report form and determine how reports are handled
 * in the administration interface. New reasons cannot be added outside this
 * catalog.
 */
import { z } from 'zod';

export type ReportReason =
  | 'video_not_playing'
  | 'wrong_missing_episode'
  | 'incorrect_information'
  | 'copyright_complaint'
  | 'inappropriate_content'
  | 'other';

export type ReportReasonLabel = {
  value: ReportReason;
  label: string;
};

export const ReportReasons: ReportReasonLabel[] = [
  { value: 'video_not_playing', label: 'Video not playing' },
  { value: 'wrong_missing_episode', label: 'Wrong or missing episode' },
  { value: 'incorrect_information', label: 'Incorrect information' },
  { value: 'copyright_complaint', label: 'Copyright complaint' },
  { value: 'inappropriate_content', label: 'Inappropriate content' },
  { value: 'other', label: 'Other' },
];

export function isValidReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && ReportReasons.some((r) => r.value === value);
}

/** Parse report input from form submission. */
export function parseReportInput(input: unknown): {
  reason: ReportReason;
  contentType: 'drama' | 'movie';
  contentId: string;
  description: string | null;
} {
  const validated = parseReportInputSchema.safeParse(input);

  if (!validated.success) {
    const errors = validated.error.flatten();
    throw new Error(
      'Invalid report submission. ' +
        Object.keys(errors.fieldErrors ?? {}).map((k) => `${k}: ${errors.fieldErrors?.[k]?.join(', ')}`).join('. ')
    );
  }

  return validated.data;
}

const parseReportInputSchema = z.object({
  reason: z.string(),
  contentType: z.enum(['drama', 'movie']),
  contentId: z.string(),
  description: z.string().max(1000),
});