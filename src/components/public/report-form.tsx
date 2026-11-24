'use client';

import { useActionState, useState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ReportReason, ReportReasons } from '@/modules/users/report-types';
import { submitReport, type ReportFormState } from '@/workflows/users/report-action';

/** Report form submitted via Server Action. */
export function ReportForm({
  contentType, // 'drama' or 'movie'
  contentId, // drama id or movie id
  title, // content title for the form context
}: {
  contentType: 'drama' | 'movie';
  contentId: string;
  title: string;
}) {
  const [reason, setReason] = useState<ReportReason>('video_not_playing');
  const [description, setDescription] = useState('');

  const [result, submitAction, isPending] = useActionState<ReportFormState, unknown>(
    submitReport,
    { ok: false }
  );

  const error = result.error ?? null;
  const submitted = result.ok === true;

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow max-w-md mx-auto">
      <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Report {title}</h2>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded border-red-500 bg-red-100 p-3 text-sm text-red-600"
        >
          {error}
        </div>
      )}

      {submitted && (
        <div
          role="status"
          className="mb-4 rounded border-green-500 bg-green-100 p-3 text-sm text-green-600"
        >
          Your report has been submitted. Thank you for helping us improve.
        </div>
      )}

      <form
        onSubmit={event => {
          event.preventDefault();

          void submitAction({
            reason,
            contentType,
            contentId,
            description: description.trim(),
          });
        }}
        className="space-y-4"
      >
        <fieldset disabled={isPending || submitted}>
          <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Why are you reporting {title}?
          </legend>

          <div className="grid grid-cols-2 gap-2">
            {ReportReasons.map(reasonOption => {
              const selected = reason === reasonOption.value;

              return (
                <label
                  key={reasonOption.value}
                  className={cn(
                    'group rounded border p-2 text-sm font-medium cursor-pointer',
                    selected
                      ? 'border-blue-600 bg-blue-100 text-blue-600'
                      : 'border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-900'
                  )}
                >
                  <input
                    type="radio"
                    name="reason"
                    value={reasonOption.value}
                    checked={selected}
                    onChange={() => setReason(reasonOption.value)}
                    className="sr-only"
                  />
                  {reasonOption.label}
                  <svg
                    className={selected ? 'size-4 fill-current' : 'size-4 opacity-50'}
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M5 3h14v2H5V3zm6 4h4v14h-4V7zm6 4h2v6h-2v-6z" />
                  </svg>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div>
          <label
            htmlFor="report-description"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
          >
            Description (optional)
          </label>

          <textarea
            id="report-description"
            name="description"
            value={description}
            onChange={event => setDescription(event.target.value)}
            placeholder="Provide more details (optional)"
            rows={3}
            maxLength={1000}
            disabled={isPending || submitted}
            aria-describedby="description-help"
            className={
              'w-full rounded border border-gray-300 dark:border-gray-600 p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 resize-none text-sm'
            }
          />
          <p id="description-help" className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Up to 1000 characters.
          </p>
        </div>

        <button
          type="submit"
          disabled={isPending || submitted}
          className={cn(buttonVariants({ variant: 'default', size: 'lg' }), 'w-full')}
        >
          {isPending ? 'Submitting...' : 'Submit Report'}
        </button>

        {isPending && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Please wait while your report is being processed.
          </p>
        )}
      </form>
    </div>
  );
}
