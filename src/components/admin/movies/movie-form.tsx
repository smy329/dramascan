'use client';

import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import { useFormContext } from 'react-hook-form';

import { AdminForm } from '@/components/admin/forms/admin-form';
import { AdminFormField } from '@/components/admin/forms/admin-form-field';
import { ImageUploadField } from '@/components/admin/media/image-upload-field';
import { VideoSourcePreview } from '@/components/admin/media/video-source-preview';
import { MOVIE_FORM_DEFAULTS, movieFormSchema } from '@/lib/contracts/movie-form';
import { createMovieAction, updateMovieAction } from '@/workflows/admin/movie-actions';

export type MovieTaxonomyOption = Readonly<{ id: string; name: string }>;

export type MovieFormFieldsProps = Readonly<{
  categories: readonly MovieTaxonomyOption[];
  platforms: readonly MovieTaxonomyOption[];
}>;

function fieldError(errors: unknown, name: string): string | undefined {
  if (typeof errors !== 'object' || errors === null) {
    return undefined;
  }

  const error = (errors as Record<string, unknown>)[name];

  return error && typeof error === 'object' && 'message' in error
    ? ((error as { message?: unknown }).message as string | undefined)
    : undefined;
}

function CheckboxGroupField({
  name,
  label,
  options,
  emptyMessage,
}: Readonly<{
  name: string;
  label: string;
  options: readonly MovieTaxonomyOption[];
  emptyMessage: string;
}>): JSX.Element {
  const {
    register,
    formState: { errors },
  } = useFormContext<Record<string, unknown>>();
  const message = fieldError(errors, name);

  return (
    <fieldset className="space-y-2" aria-describedby={message ? `${name}-error` : undefined}>
      <legend className="text-sm font-medium text-foreground">{label}</legend>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {options.map(option => (
            <label
              key={option.id}
              htmlFor={`${name}-${option.id}`}
              className="flex items-center gap-2 text-sm text-foreground"
            >
              <input
                id={`${name}-${option.id}`}
                type="checkbox"
                value={option.id}
                className="size-4 rounded border-input"
                {...register(name)}
              />
              {option.name}
            </label>
          ))}
        </div>
      )}
      {message ? (
        <p id={`${name}-error`} className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
    </fieldset>
  );
}

/**
 * Browser playback preview for the administrator-supplied direct MP4 URL.
 *
 * The URL is handed to the browser as-is. The server never fetches it, so this
 * preview is the only proof that the source actually plays.
 */
export function MovieFormFields({ categories, platforms }: MovieFormFieldsProps): JSX.Element {
  return (
    <>
      <AdminFormField
        name="title"
        label="Title"
        required
        autoComplete="off"
        hint="The URL slug is generated from the title."
      />
      <AdminFormField name="description" label="Description" multiline />
      <div className="grid gap-6 sm:grid-cols-2">
        <ImageUploadField
          name="poster"
          label="Poster"
          contentType="movie"
          kind="poster"
          hint="Portrait artwork is required for a poster."
        />
        <ImageUploadField
          name="banner"
          label="Banner"
          contentType="movie"
          kind="banner"
          hint="Landscape artwork is required for a banner."
        />
      </div>
      <AdminFormField
        name="video_source"
        label="Video source URL"
        autoComplete="off"
        hint="Public direct HTTPS MP4 URL. The server validates syntax only; verify playback below."
      />
      <VideoSourcePreview />
      <CheckboxGroupField
        name="categories"
        label="Categories"
        options={categories}
        emptyMessage="No categories exist yet. Create categories before associating them."
      />
      <CheckboxGroupField
        name="platforms"
        label="Platforms"
        options={platforms}
        emptyMessage="No platforms exist yet. Create platforms before associating them."
      />
    </>
  );
}

export function MovieCreateForm({ categories, platforms }: MovieFormFieldsProps): JSX.Element {
  const router = useRouter();

  return (
    <AdminForm
      schema={movieFormSchema}
      serverAction={createMovieAction}
      defaultValues={MOVIE_FORM_DEFAULTS}
      resetOnSuccess={false}
      submitLabel="Create movie"
      pendingLabel="Creating…"
      onSuccess={() => {
        router.push('/admin/movies');
        router.refresh();
      }}
    >
      <MovieFormFields categories={categories} platforms={platforms} />
    </AdminForm>
  );
}

export function MovieEditForm({
  movieId,
  defaultValues,
  categories,
  platforms,
}: Readonly<{
  movieId: string;
  defaultValues: Readonly<Record<string, unknown>>;
  categories: readonly MovieTaxonomyOption[];
  platforms: readonly MovieTaxonomyOption[];
}>): JSX.Element {
  const router = useRouter();

  return (
    <AdminForm
      schema={movieFormSchema}
      serverAction={values => updateMovieAction(movieId, values)}
      defaultValues={defaultValues}
      resetOnSuccess={false}
      submitLabel="Save movie"
      pendingLabel="Saving…"
      onSuccess={() => {
        router.push('/admin/movies');
        router.refresh();
      }}
    >
      <MovieFormFields categories={categories} platforms={platforms} />
    </AdminForm>
  );
}
