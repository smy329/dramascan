import 'server-only';

import { and, eq, inArray, isNull, ne } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';
import { ConflictError, NotFoundError, ValidationError } from '@/platform/errors';

import {
  categories,
  content_slug_history as contentSlugHistory,
  movie_categories as movieCategories,
  movie_platforms as moviePlatforms,
  movies,
  platforms,
} from '@/modules/content/schema';
import {
  parseCreateMovieInput,
  parseOrThrow,
  parseUpdateMovieInput,
  type CreateMovieInput,
} from '@/modules/content/validation';

import { z } from 'zod';

/**
 * Standalone movie administration.
 *
 * Movies are an independent content type: nothing here creates a drama, season,
 * or episode. The workflow owns persistence, slug history, association
 * replacement, and server-side authorization. Routes are thin adapters.
 */

/** Permission key for movie management. */
const MANAGE_PERMISSION = 'movie.manage';

export type AdminMovie = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  poster: string | null;
  banner: string | null;
  publicationStatus: string | null;
  videoSource: string | null;
  createdAt: string;
  updatedAt: string;
};

function toMovie(row: typeof movies.$inferSelect): AdminMovie {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    description: row.description,
    poster: row.poster,
    banner: row.banner,
    publicationStatus: row.publication_status,
    videoSource: row.video_source,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** PostgreSQL unique-violation code, including Drizzle's wrapped query errors. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (
      typeof current === 'object' &&
      current !== null &&
      'code' in current &&
      (current as { code?: unknown }).code === '23505'
    ) {
      return true;
    }

    current =
      typeof current === 'object' && current !== null
        ? (current as { cause?: unknown }).cause
        : undefined;
  }

  return false;
}

function duplicateSlugError(): ConflictError {
  return new ConflictError('A movie with this slug already exists.');
}

/**
 * Validate that every requested category/platform is a live row. The join
 * tables carry composite primary keys, so a missing reference would otherwise
 * surface as a foreign-key error instead of a useful field error.
 */
async function assertAssociationsExist(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: Pick<CreateMovieInput, 'categories' | 'platforms'>
): Promise<void> {
  const categoryIds = Array.from(new Set(input.categories));
  const platformIds = Array.from(new Set(input.platforms));

  if (categoryIds.length > 0) {
    const rows = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(inArray(categories.id, categoryIds), isNull(categories.deleted_at)));

    if (rows.length !== categoryIds.length) {
      throw new ValidationError('One or more categories were not found.', {
        categories: ['One or more categories were not found.'],
      });
    }
  }

  if (platformIds.length > 0) {
    const rows = await tx
      .select({ id: platforms.id })
      .from(platforms)
      .where(and(inArray(platforms.id, platformIds), isNull(platforms.deleted_at)));

    if (rows.length !== platformIds.length) {
      throw new ValidationError('One or more platforms were not found.', {
        platforms: ['One or more platforms were not found.'],
      });
    }
  }
}

/** Replace the movie's category and platform associations in one transaction. */
async function replaceAssociations(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  movieId: string,
  input: Pick<CreateMovieInput, 'categories' | 'platforms'>
): Promise<void> {
  const categoryIds = Array.from(new Set(input.categories));
  const platformIds = Array.from(new Set(input.platforms));

  await tx.delete(movieCategories).where(eq(movieCategories.movie_id, movieId));
  await tx.delete(moviePlatforms).where(eq(moviePlatforms.movie_id, movieId));

  if (categoryIds.length > 0) {
    await tx.insert(movieCategories).values(
      categoryIds.map(categoryId => ({
        movie_id: movieId,
        category_id: categoryId,
      }))
    );
  }

  if (platformIds.length > 0) {
    await tx.insert(moviePlatforms).values(
      platformIds.map(platformId => ({
        movie_id: movieId,
        platform_id: platformId,
      }))
    );
  }
}

/**
 * Create a standalone movie. The slug is explicitly supplied by the
 * administrator and must be unique among non-deleted movies.
 */
export async function createMovie(actor: ActorContext, input: unknown): Promise<AdminMovie> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsed = parseCreateMovieInput(input);

  const [existing] = await db
    .select({ id: movies.id })
    .from(movies)
    .where(and(eq(movies.slug, parsed.slug), isNull(movies.deleted_at)));

  if (existing) {
    throw duplicateSlugError();
  }

  try {
    return await db.transaction(async tx => {
      await assertAssociationsExist(tx, parsed);

      const [row] = await tx
        .insert(movies)
        .values({
          title: parsed.title,
          slug: parsed.slug,
          description: parsed.description ?? null,
          poster: parsed.poster,
          banner: parsed.banner,
          publication_status: parsed.publication_status,
          video_source: parsed.video_source,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning();

      if (!row) {
        throw new Error('Movie insert returned no row.');
      }

      await replaceAssociations(tx, row.id, parsed);

      return toMovie(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw duplicateSlugError();
    }
    throw error;
  }
}

/**
 * Edit a standalone movie. This is a full-payload replace, matching the drama
 * contract: unset images/video become null and associations are replaced.
 *
 * Changing the slug records the previous value in `content_slug_history` so
 * canonical-URL redirects can be built later.
 */
export async function updateMovie(
  actor: ActorContext,
  movieId: string,
  input: unknown
): Promise<AdminMovie> {
  requirePermission(actor, MANAGE_PERMISSION);

  const parsedId = parseOrThrow(z.uuid(), movieId);
  const parsed = parseUpdateMovieInput(input);

  try {
    return await db.transaction(async tx => {
      const [existing] = await tx
        .select({ id: movies.id, slug: movies.slug })
        .from(movies)
        .where(and(eq(movies.id, parsedId), isNull(movies.deleted_at)));

      if (!existing) {
        throw new NotFoundError('Movie not found.');
      }

      if (existing.slug !== parsed.slug) {
        const [conflict] = await tx
          .select({ id: movies.id })
          .from(movies)
          .where(
            and(eq(movies.slug, parsed.slug), isNull(movies.deleted_at), ne(movies.id, parsedId))
          );

        if (conflict) {
          throw duplicateSlugError();
        }

        await tx.insert(contentSlugHistory).values({
          content_type: 'movie',
          content_id: parsedId,
          old_slug: existing.slug,
          new_slug: parsed.slug,
        });
      }

      await assertAssociationsExist(tx, parsed);

      const [row] = await tx
        .update(movies)
        .set({
          title: parsed.title,
          slug: parsed.slug,
          description: parsed.description ?? null,
          poster: parsed.poster,
          banner: parsed.banner,
          publication_status: parsed.publication_status,
          video_source: parsed.video_source,
          updated_at: new Date(),
        })
        .where(and(eq(movies.id, parsedId), isNull(movies.deleted_at)))
        .returning();

      if (!row) {
        throw new NotFoundError('Movie not found.');
      }

      await replaceAssociations(tx, parsedId, parsed);

      return toMovie(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw duplicateSlugError();
    }
    throw error;
  }
}
