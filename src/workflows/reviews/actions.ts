'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/contracts/common';

import { resolveActor } from '@/modules/authorization';
import { getPublicContentTarget } from '@/modules/content';
import {
  parseRatingValue,
  parseReportReason,
  reportDescriptionSchema,
  reviewContentSchema,
  reviewContentTypeSchema,
  reviewIdSchema,
  reviewTitleSchema,
  submitDramaRating,
  submitDramaReview,
  submitMovieRating,
  submitMovieReview,
  submitReviewReport,
  toggleReviewEnjoying,
} from '@/modules/reviews';

import { toActionError } from '../action-errors';

/**
 * Server Actions for ratings, reviews, reactions, and review reports.
 *
 * The actor is resolved from the session on the server, so a client can never
 * rate, review, react, or report on somebody else's behalf. Every argument is
 * parsed at runtime before it reaches a service: a Server Action argument is
 * untrusted request data, and a TypeScript annotation proves nothing about
 * what actually arrives.
 */

/** The content routes whose page shows the rating and the reviews. */
function revalidateContentPaths(type: 'drama' | 'movie'): void {
  if (type === 'drama') {
    revalidatePath('/drama/[dramaId]/[slug]', 'page');
  } else {
    revalidatePath('/movie/[id]/[slug]', 'page');
  }

  revalidatePath('/');
  revalidatePath('/highest-rated', 'page');
}

/** Submit or update the viewer's rating for a drama or a movie. */
export async function submitRatingAction(input: unknown): Promise<
  ActionResult<{ rating: number; count: number }>
> {
  try {
    const actor = await resolveActor();

    if (actor.userId === null) {
      return { ok: false, error: { code: 'authentication_required', message: 'Sign in to rate.' } };
    }

    const parsedInput = reviewContentTypeSchema.safeParse(
      typeof input === 'object' && input !== null ? (input as { type?: unknown }).type : undefined
    );

    if (!parsedInput.success) {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid content type.' } };
    }

    const type = parsedInput.data;

    const parsedId = reviewIdSchema.safeParse(
      typeof input === 'object' && input !== null ? (input as { contentId?: unknown }).contentId : undefined
    );

    if (!parsedId.success) {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid content id.' } };
    }

    const parsedValue = parseRatingValue(
      typeof input === 'object' && input !== null ? (input as { value?: unknown }).value : undefined
    );

    if (!parsedValue.ok) {
      return { ok: false, error: { code: 'validation_error', message: parsedValue.error } };
    }

    const target = await getPublicContentTarget(type, parsedId.data);

    if (!target) {
      return { ok: false, error: { code: 'not_found', message: 'That content is not available.' } };
    }

    const result =
      type === 'drama'
        ? await submitDramaRating(actor.userId, parsedId.data, parsedValue.value)
        : await submitMovieRating(actor.userId, parsedId.data, parsedValue.value);

    revalidateContentPaths(type);

    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/** Submit or update the viewer's written review for a drama or a movie. */
export async function submitReviewAction(input: unknown): Promise<
  ActionResult<{ id: string }>
> {
  try {
    const actor = await resolveActor();

    if (actor.userId === null) {
      return { ok: false, error: { code: 'authentication_required', message: 'Sign in to write a review.' } };
    }

    if (typeof input !== 'object' || input === null) {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid review.' } };
    }

    const payload = input as {
      type?: unknown;
      contentId?: unknown;
      title?: unknown;
      content?: unknown;
    };

    const parsedType = reviewContentTypeSchema.safeParse(payload.type);

    if (!parsedType.success) {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid content type.' } };
    }

    const parsedId = reviewIdSchema.safeParse(payload.contentId);

    if (!parsedId.success) {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid content id.' } };
    }

    const parsedContent = reviewContentSchema.safeParse(payload.content);

    if (!parsedContent.success) {
      return {
        ok: false,
        error: {
          code: 'validation_error',
          message: parsedContent.error.issues[0]?.message ?? 'Invalid review.',
          fieldErrors: { content: [parsedContent.error.issues[0]?.message ?? 'Invalid review.'] },
        },
      };
    }

    const parsedTitle = reviewTitleSchema.safeParse(payload.title ?? null);

    if (!parsedTitle.success) {
      return {
        ok: false,
        error: {
          code: 'validation_error',
          message: parsedTitle.error.issues[0]?.message ?? 'Invalid title.',
          fieldErrors: { title: [parsedTitle.error.issues[0]?.message ?? 'Invalid title.'] },
        },
      };
    }

    const target = await getPublicContentTarget(parsedType.data, parsedId.data);

    if (!target) {
      return { ok: false, error: { code: 'not_found', message: 'That content is not available.' } };
    }

    const review =
      parsedType.data === 'drama'
        ? await submitDramaReview(
            actor.userId,
            parsedId.data,
            parsedTitle.data ?? null,
            parsedContent.data
          )
        : await submitMovieReview(
            actor.userId,
            parsedId.data,
            parsedTitle.data ?? null,
            parsedContent.data
          );

    if (!review) {
      return { ok: false, error: { code: 'internal_error', message: 'The review could not be saved.' } };
    }

    revalidateContentPaths(parsedType.data);

    return { ok: true, data: { id: review.id } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/** Toggle the viewer's "Enjoying" reaction on a review. */
export async function toggleReviewReactionAction(input: unknown): Promise<
  ActionResult<{ enjoying: boolean; count: number }>
> {
  try {
    const actor = await resolveActor();

    if (actor.userId === null) {
      return {
        ok: false,
        error: { code: 'authentication_required', message: 'Sign in to react to a review.' },
      };
    }

    const parsedId = reviewIdSchema.safeParse(
      typeof input === 'object' && input !== null ? (input as { reviewId?: unknown }).reviewId : input
    );

    if (!parsedId.success) {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid review id.' } };
    }

    const result = await toggleReviewEnjoying(parsedId.data, actor.userId);

    revalidatePath('/');
    revalidatePath('/drama/[dramaId]/[slug]', 'page');
    revalidatePath('/movie/[id]/[slug]', 'page');

    return { ok: true, data: result };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}

/** Report a review to the moderation team. */
export async function submitReviewReportAction(input: unknown): Promise<
  ActionResult<{ id: string }>
> {
  try {
    const actor = await resolveActor();

    if (actor.userId === null) {
      return {
        ok: false,
        error: { code: 'authentication_required', message: 'Sign in to report a review.' },
      };
    }

    if (typeof input !== 'object' || input === null) {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid report.' } };
    }

    const payload = input as {
      reviewId?: unknown;
      reason?: unknown;
      description?: unknown;
    };

    const parsedId = reviewIdSchema.safeParse(payload.reviewId);

    if (!parsedId.success) {
      return { ok: false, error: { code: 'validation_error', message: 'Invalid review id.' } };
    }

    const parsedReason = parseReportReason(payload.reason);

    if (!parsedReason.ok) {
      return { ok: false, error: { code: 'validation_error', message: parsedReason.error } };
    }

    const parsedDescription = reportDescriptionSchema.safeParse(payload.description ?? null);

    if (!parsedDescription.success) {
      return {
        ok: false,
        error: {
          code: 'validation_error',
          message:
            parsedDescription.error.issues[0]?.message ?? 'Invalid description.',
        },
      };
    }

    const report = await submitReviewReport(
      actor.userId,
      parsedId.data,
      parsedReason.value,
      parsedDescription.data ?? null
    );

    if (!report) {
      return { ok: false, error: { code: 'internal_error', message: 'The report could not be saved.' } };
    }

    revalidatePath('/admin/reviews', 'page');

    return { ok: true, data: { id: report.id } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
