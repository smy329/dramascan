'use server';

import type { ActionResult } from '@/lib/contracts/common';
import { movieFormSchema, movieSlugFromTitle, type MovieFormValues } from '@/lib/contracts/movie-form';
import { resolveActor, requirePermission } from '@/modules/authorization';
import { parseOrThrow } from '@/modules/content/validation';

import { toActionError, withFieldError } from '../action-errors';
import { createMovie, deleteMovie, updateMovie } from './movies';

/** Server Actions behind the admin standalone-movie forms. */

export type MovieActionData = {
  id: string;
  title: string;
  slug: string;
};

function toDomainInput(values: MovieFormValues): Record<string, unknown> {
  return {
    title: values.title,
    slug: movieSlugFromTitle(values.title),
    description: values.description?.trim() ? values.description : undefined,
    poster: values.poster === '' || values.poster === undefined ? null : values.poster,
    banner: values.banner === '' || values.banner === undefined ? null : values.banner,
    video_source:
      values.video_source === '' || values.video_source === undefined ? null : values.video_source,
    categories: values.categories,
    platforms: values.platforms,
  };
}

function toData(movie: { id: string; title: string; slug: string }): MovieActionData {
  return { id: movie.id, title: movie.title, slug: movie.slug };
}

export async function createMovieAction(_payload: unknown): Promise<ActionResult<MovieActionData>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'movie.manage');

    const values = parseOrThrow(movieFormSchema, _payload);
    const movie = await createMovie(actor, toDomainInput(values));

    return { ok: true, data: toData(movie) };
  } catch (error) {
    return { ok: false, error: withFieldError(toActionError(error), 'slug', 'title') };
  }
}

export async function updateMovieAction(
  movieId: string,
  _payload: unknown
): Promise<ActionResult<MovieActionData>> {
  try {
    const actor = await resolveActor();
    requirePermission(actor, 'movie.manage');

    const values = parseOrThrow(movieFormSchema, _payload);
    const movie = await updateMovie(actor, movieId, toDomainInput(values));

    return { ok: true, data: toData(movie) };
  } catch (error) {
    return { ok: false, error: withFieldError(toActionError(error), 'slug', 'title') };
  }
}

/** Move a movie to Trash. Only Super Admin may permanently delete it later. */
export async function deleteMovieAction(movieId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await resolveActor();
    const movie = await deleteMovie(actor, movieId);

    return { ok: true, data: { id: movie.id } };
  } catch (error) {
    return { ok: false, error: toActionError(error) };
  }
}
