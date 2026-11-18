import type { ActionError } from '@/lib/contracts/common';
import { AppError, InternalError } from '@/platform/errors';
import { mapErrorToActionResult } from '@/platform/Http';

/**
 * Shared Server Action error adaptation.
 *
 * This module has no `'use server'` directive: it is imported by Server Action
 * modules and by their unit tests. It only maps errors, so it never touches
 * request state and stays safe on both sides.
 */

/**
 * Convert a workflow error into the standard `ActionResult` error shape.
 *
 * Workflows report some domain conflicts as plain serializable objects rather
 * than `AppError`s, so both shapes are accepted. Anything unrecognized is
 * wrapped as an internal error rather than leaked to the client.
 */
export function toActionError(error: unknown): ActionError {
  if (error instanceof AppError) {
    return mapErrorToActionResult(error).error;
  }

  if (isActionErrorLike(error)) {
    return error;
  }

  return mapErrorToActionResult(
    new InternalError('An unexpected error occurred.', error instanceof Error ? error : undefined)
  ).error;
}

function isActionErrorLike(error: unknown): error is ActionError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown; fieldErrors?: unknown };

  if (typeof candidate.code !== 'string' || typeof candidate.message !== 'string') {
    return false;
  }

  const fieldErrors = candidate.fieldErrors;

  if (fieldErrors === undefined) {
    return true;
  }

  return typeof fieldErrors === 'object' && fieldErrors !== null;
}

/**
 * Move a field error from one field onto another.
 *
 * When a form has no input for the field the server names, the message would
 * render nowhere and the administrator would only see the alert. The conflict
 * is usually still caused by a field they can edit, so the message belongs
 * there: for example a drama `slug` conflict belongs on `title`, which is what
 * the client uses to derive it.
 */
export function withFieldError(error: ActionError, from: string, to: string): ActionError {
  const fieldErrors: Record<string, string[]> = { ...error.fieldErrors };
  const messages = fieldErrors[from];

  if (!messages) {
    return error;
  }

  delete fieldErrors[from];
  fieldErrors[to] = messages;

  return { ...error, fieldErrors };
}
