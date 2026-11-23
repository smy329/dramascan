'use client';

import { useState } from 'react';
import { useActionState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ReportReason, ReportReasons } from '@/modules/users/report-types';
import { submitReport } from '@/workflows/users/report-action';

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [result, mutate] = useActionState(submitReport, {
    reason: 'video_not_playing',
    contentType,
    contentId,
    description: '',
  });

  if (result?.ok) {
    setSubmitting(false);
    setSuccess(true);
    setError(null);

    // Reset after a moment
    setTimeout(() => {
      setSuccess(false);
    }, 5000);
  }

  if (result?.error) {
    setSubmitting(false);
    setError(result.error.message || 'Failed to submit report.');
  }

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow max-w-md mx-auto">
      <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">
        Report {contentType}
      </h2>

      {error && (
        <div className="mb-4 rounded border-red-500 bg-red-100 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 rounded border-green-500 bg-green-100 p-3 text-sm text-green-600">
          Your report has been submitted. Thank you for helping us improve.
        </div>
      )}

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSubmitting(true);
          setError(null);
          setSuccess(false);

          await mutate({
            reason,
            contentType,
            contentId,
            description: description.trim() || undefined,
          });
        }}
        className="space-y-4"
      >
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Why are you reporting this {contentType}?
          </label>

          <div className="grid grid-cols-2 gap-2">
            {ReportReasons.map((reasonOption) => (
              <label
                key={reasonOption.value}
                className={
                  reason === reasonOption.value
                    ? 'group rounded border-blue-600 bg-blue-100 p-2 text-sm font-medium text-blue-600'
                    : 'rounded border-gray-300 dark:border-gray-600 p-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-900 cursor-pointer'
                }
                onClick={() => setReason(reasonOption.value)}
                aria-pressed={reason === reasonOption.value}
              >
                {reasonOption.label}
                <svg
                  className={reason === reasonOption.value ? 'size-4 fill-current' : 'size-4 opacity-50'}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M5 3h14v2H5V3zm6 4h4v14h-4V7zm6 4h2v6h-2v-6z" />
                </svg>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Description (optional)
          </label>

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Provide more details (optional)"
            rows={3}
            className={
              'w-full rounded border border-gray-300 dark:border-gray-600 p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 resize-none text-sm'
            }
            disabled={submitting}
            aria-describedby="description-help"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className={cn(
            buttonVariants({ variant: 'default', size: 'lg' }),
            'w-full'
          )}
        >
          {submitting ? 'Submitting...' : 'Submit Report'}
        </button>

        {submitting && (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Please wait while your report is being processed.
          </p>
        )}
      </form>
    </div>
  );
}