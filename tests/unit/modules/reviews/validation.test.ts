import { describe, expect, it } from 'vitest';

import {
  REVIEW_REPORT_REASONS,
  REVIEW_REPORT_REASON_VALUES,
  isReviewReportReason,
} from '@/modules/reviews/report-reasons';
import {
  parseRatingValue,
  parseReportReason,
  ratingValueSchema,
  reportDescriptionSchema,
  resolutionOutcomeSchema,
  reviewContentSchema,
  reviewContentTypeSchema,
  reviewIdSchema,
  reviewReportReasonSchema,
  reviewSortSchema,
  reviewTitleSchema,
} from '@/modules/reviews/validation';

/**
 * Runtime validation of the reviews module.
 *
 * A Server Action argument is untrusted request data. These cases pin the
 * boundaries: the rating scale, the report-reason catalog, the length limits,
 * and the sort orders. A value outside a documented range has to be rejected
 * here rather than reaching the database.
 */

const REVIEW_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('ratingValueSchema', () => {
  it('accepts every whole star from one to five', () => {
    for (const value of [1, 2, 3, 4, 5]) {
      expect(ratingValueSchema.safeParse(value).success).toBe(true);
    }
  });

  it('rejects a score outside the scale', () => {
    for (const value of [0, 6, -1, 100]) {
      expect(ratingValueSchema.safeParse(value).success).toBe(false);
    }
  });

  it('rejects a fractional score', () => {
    expect(ratingValueSchema.safeParse(4.5).success).toBe(false);
  });

  it('rejects a value that is not a number', () => {
    for (const value of ['4', null, undefined, NaN, {}]) {
      expect(ratingValueSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('parseRatingValue', () => {
  it('returns the parsed score', () => {
    expect(parseRatingValue(5)).toEqual({ ok: true, value: 5 });
  });

  it('returns a message instead of a score when the value is invalid', () => {
    const result = parseRatingValue(6);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toMatch(/between 1 and 5/);
    }
  });
});

describe('reviewContentTypeSchema', () => {
  it('accepts a drama and a movie', () => {
    expect(reviewContentTypeSchema.safeParse('drama').success).toBe(true);
    expect(reviewContentTypeSchema.safeParse('movie').success).toBe(true);
  });

  it('rejects an episode', () => {
    expect(reviewContentTypeSchema.safeParse('episode').success).toBe(false);
  });
});

describe('reviewIdSchema', () => {
  it('accepts a uuid', () => {
    expect(reviewIdSchema.safeParse(REVIEW_ID).success).toBe(true);
  });

  it('rejects anything that is not a uuid', () => {
    for (const value of ['', 'abc', 42, null]) {
      expect(reviewIdSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('the review report reason catalog', () => {
  it('contains exactly the approved reasons', () => {
    expect([...REVIEW_REPORT_REASON_VALUES]).toEqual([
      'spam_advertising',
      'harassment_bullying',
      'inappropriate_language',
      'misleading_false_information',
      'other',
    ]);
  });

  it('gives every reason a label', () => {
    for (const reason of REVIEW_REPORT_REASONS) {
      expect(reason.label.length).toBeGreaterThan(0);
    }
  });

  it('agrees with the runtime schema', () => {
    for (const reason of REVIEW_REPORT_REASON_VALUES) {
      expect(reviewReportReasonSchema.safeParse(reason).success).toBe(true);
      expect(isReviewReportReason(reason)).toBe(true);
    }
  });

  it('rejects a reason outside the catalog', () => {
    expect(reviewReportReasonSchema.safeParse('because_i_can').success).toBe(false);
    expect(isReviewReportReason('because_i_can')).toBe(false);
  });
});

describe('parseReportReason', () => {
  it('returns the parsed reason', () => {
    expect(parseReportReason('other')).toEqual({ ok: true, value: 'other' });
  });

  it('refuses an unknown reason', () => {
    const result = parseReportReason('nonsense');

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toMatch(/valid report reason/);
    }
  });
});

describe('reviewContentSchema', () => {
  it('accepts a written review', () => {
    expect(reviewContentSchema.safeParse('A wonderful, slow-burn story.').success).toBe(true);
  });

  it('rejects an empty review', () => {
    expect(reviewContentSchema.safeParse('   ').success).toBe(false);
  });

  it('rejects a review longer than five thousand characters', () => {
    expect(reviewContentSchema.safeParse('a'.repeat(5001)).success).toBe(false);
    expect(reviewContentSchema.safeParse('a'.repeat(5000)).success).toBe(true);
  });
});

describe('reviewTitleSchema', () => {
  it('accepts a missing title', () => {
    expect(reviewTitleSchema.safeParse(null).success).toBe(true);
    expect(reviewTitleSchema.safeParse(undefined).success).toBe(true);
  });

  it('rejects a title longer than two hundred characters', () => {
    expect(reviewTitleSchema.safeParse('a'.repeat(201)).success).toBe(false);
  });
});

describe('reportDescriptionSchema', () => {
  it('accepts a missing description', () => {
    expect(reportDescriptionSchema.safeParse(null).success).toBe(true);
    expect(reportDescriptionSchema.safeParse(undefined).success).toBe(true);
  });

  it('rejects a description longer than one thousand characters', () => {
    expect(reportDescriptionSchema.safeParse('a'.repeat(1001)).success).toBe(false);
  });
});

describe('resolutionOutcomeSchema', () => {
  it('requires an outcome', () => {
    expect(resolutionOutcomeSchema.safeParse('   ').success).toBe(false);
  });

  it('accepts a written outcome', () => {
    expect(resolutionOutcomeSchema.safeParse('The review was kept.').success).toBe(true);
  });
});

describe('reviewSortSchema', () => {
  it('accepts exactly the approved sort orders', () => {
    expect(reviewSortSchema.safeParse('most-enjoying').success).toBe(true);
    expect(reviewSortSchema.safeParse('newest').success).toBe(true);
    expect(reviewSortSchema.safeParse('highest-rated').success).toBe(true);
    expect(reviewSortSchema.safeParse('oldest').success).toBe(false);
  });
});
