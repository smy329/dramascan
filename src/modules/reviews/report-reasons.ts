/**
 * Review report reasons (canonical catalog).
 *
 * The catalog is shared by the server-side validation and the client-side
 * report form, so it lives in a module without `server-only`: importing the
 * server-only module index from a client component would break the build.
 *
 * New reasons cannot be added outside this catalog. The server re-validates
 * every submitted reason, so a hand-crafted request cannot file a reason the
 * form does not offer.
 */

/** The approved review-report reasons. */
export const REVIEW_REPORT_REASON_VALUES = [
  'spam_advertising',
  'harassment_bullying',
  'inappropriate_language',
  'misleading_false_information',
  'other',
] as const;

export type ReviewReportReason = (typeof REVIEW_REPORT_REASON_VALUES)[number];

/** One reason, with the label the form shows. */
export type ReviewReportReasonOption = {
  value: ReviewReportReason;
  label: string;
};

/** The canonical report-reason catalog, with the labels the UI shows. */
export const REVIEW_REPORT_REASONS: ReadonlyArray<ReviewReportReasonOption> = [
  { value: 'spam_advertising', label: 'Spam or advertising' },
  { value: 'harassment_bullying', label: 'Harassment or bullying' },
  { value: 'inappropriate_language', label: 'Inappropriate language' },
  { value: 'misleading_false_information', label: 'Misleading or false information' },
  { value: 'other', label: 'Other' },
];

/** Is this value one of the approved reasons? */
export function isReviewReportReason(value: unknown): value is ReviewReportReason {
  return (
    typeof value === 'string' &&
    (REVIEW_REPORT_REASON_VALUES as readonly string[]).includes(value)
  );
}
