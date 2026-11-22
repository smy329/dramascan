'use client';

import type { JSX } from 'react';
import { useId, useState } from 'react';
import { useFormContext } from 'react-hook-form';

import { Input } from '@/components/ui/input';
import {
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_IMAGE_BYTES,
  type ImageContentType,
  type ImageKind,
} from '@/lib/contracts/media';
import { cn } from '@/lib/utils';

export type ImageUploadFieldProps = Readonly<{
  /** Form field name; stores the managed `/media/...` path or an external URL. */
  name: string;
  /** Visible role, for example `Poster`. */
  label: string;
  contentType: ImageContentType;
  kind: ImageKind;
  hint?: string;
  className?: string;
}>;

type UploadResponse = {
  data?: { path?: unknown };
  error?: { message?: unknown; fieldErrors?: Record<string, string[]> };
};

function errorMessage(errors: unknown, name: string): string | undefined {
  if (typeof errors !== 'object' || errors === null) {
    return undefined;
  }

  const error = (errors as Record<string, unknown>)[name];

  return error && typeof error === 'object' && 'message' in error
    ? ((error as { message?: unknown }).message as string | undefined)
    : undefined;
}

/**
 * Poster/banner reference field.
 *
 * The administrator may paste an existing absolute URL or upload an original
 * file. The upload goes to `POST /admin/api/media`, which validates the
 * signature, size, and proportions and returns a managed `/media/...` path. No
 * image processing happens in the browser or on the server.
 */
export function ImageUploadField({
  name,
  label,
  contentType,
  kind,
  hint,
  className,
}: ImageUploadFieldProps): JSX.Element {
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext<Record<string, unknown>>();
  const id = useId();
  const fileId = `${id}-file`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const message = errorMessage(errors, name);
  const value = watch(name);
  const reference = typeof value === 'string' ? value : '';
  const describedBy =
    [message ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function upload(file: File): Promise<void> {
    setUploading(true);
    setUploadError(null);

    try {
      const form = new FormData();
      form.append('contentType', contentType);
      form.append('kind', kind);
      form.append('file', file);

      const response = await fetch('/admin/api/media', { method: 'POST', body: form });
      const body = (await response.json().catch(() => ({}))) as UploadResponse;

      if (!response.ok) {
        const fieldMessage = body.error?.fieldErrors
          ? Object.values(body.error.fieldErrors).flat()[0]
          : undefined;

        setUploadError(
          typeof fieldMessage === 'string'
            ? fieldMessage
            : typeof body.error?.message === 'string'
              ? body.error.message
              : 'The image could not be uploaded.'
        );
        return;
      }

      if (typeof body.data?.path !== 'string') {
        setUploadError('The upload response did not include an image path.');
        return;
      }

      setValue(name, body.data.path, { shouldDirty: true, shouldValidate: true });
    } catch {
      setUploadError('The image could not be uploaded.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {`${label} URL`}
      </label>
      <Input
        id={id}
        type="text"
        autoComplete="off"
        placeholder="https://… or an uploaded /media/… path"
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy}
        {...register(name)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={fileId}
          className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-input px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          {uploading ? `Uploading ${label.toLowerCase()}…` : `Upload ${label.toLowerCase()}`}
        </label>
        <input
          id={fileId}
          type="file"
          accept={IMAGE_ACCEPT_ATTRIBUTE}
          className="sr-only"
          disabled={uploading}
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = '';
          }}
        />
        <span className="text-xs text-muted-foreground">
          JPEG, PNG, WebP, or GIF, up to {Math.floor(MAX_IMAGE_BYTES / (1024 * 1024))} MB.
        </span>
      </div>
      {uploadError ? (
        <p className="text-sm text-destructive" role="alert">
          {uploadError}
        </p>
      ) : null}
      {reference.length > 0 ? (
        <div className="mt-2 overflow-hidden rounded-lg border border-border bg-muted">
          {/* No Next image optimisation and no resizing: the original is shown. */}
          <img
            src={reference}
            alt={`${label} preview`}
            className={cn(
              'h-auto w-full object-cover',
              kind === 'poster' ? 'max-h-72 max-w-48' : 'max-h-40'
            )}
          />
        </div>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {message ? (
        <p id={errorId} className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
    </div>
  );
}
