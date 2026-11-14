import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration coverage for standalone-movie administration.
 *
 * Uses the real PostgreSQL test database and the ordered SQL migrations. The
 * tests verify creation, full-payload editing, association replacement, slug
 * history, publication state, and the HTTPS-only video-source contract, all
 * against the actual persistence layer.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for movie integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));

import { and, eq, inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import type { ActorContext } from '@/modules/authorization';
import {
  categories,
  content_slug_history as contentSlugHistory,
  movie_categories as movieCategories,
  movie_platforms as moviePlatforms,
  movies,
  platforms,
} from '@/modules/content/schema';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/platform/errors';
import { closePool } from '@/platform/db/pool';
import { createMovie, updateMovie } from '@/workflows/admin/movies';

const TEST_SLUG_PREFIX = 'it-movie-';
const HTTPS_SOURCE = 'https://media.example.com/movies/midnight-signal.mp4';

const anonymousActor: ActorContext = {
  userId: null,
  roles: [],
  isSuperAdmin: false,
  permissions: [],
};

const readerActor: ActorContext = {
  userId: 'it-movie-reader',
  roles: ['reader'],
  isSuperAdmin: false,
  permissions: ['movie.read'],
};

const managerActor: ActorContext = {
  userId: 'it-movie-manager',
  roles: ['content_manager'],
  isSuperAdmin: false,
  permissions: ['movie.manage'],
};

function testSlug(label: string): string {
  return `${TEST_SLUG_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

function movieInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Midnight Signal',
    slug: testSlug('midnight'),
    ...overrides,
  };
}

async function insertCategory(label: string): Promise<string> {
  const [row] = await db
    .insert(categories)
    .values({ name: `Test ${label}`, slug: testSlug(`cat-${label}`) })
    .returning({ id: categories.id });

  if (!row) {
    throw new Error('Category insert returned no row.');
  }

  return row.id;
}

async function insertPlatform(label: string): Promise<string> {
  const [row] = await db
    .insert(platforms)
    .values({ name: `Test ${label}`, slug: testSlug(`plat-${label}`) })
    .returning({ id: platforms.id });

  if (!row) {
    throw new Error('Platform insert returned no row.');
  }

  return row.id;
}

async function cleanupTestMovies(): Promise<void> {
  const rows = await db
    .select({ id: movies.id })
    .from(movies)
    .where(like(movies.slug, `${TEST_SLUG_PREFIX}%`));
  const ids = rows.map(row => row.id);

  if (ids.length > 0) {
    await db.delete(movieCategories).where(inArray(movieCategories.movie_id, ids));
    await db.delete(moviePlatforms).where(inArray(moviePlatforms.movie_id, ids));
    await db
      .delete(contentSlugHistory)
      .where(
        and(
          eq(contentSlugHistory.content_type, 'movie'),
          inArray(contentSlugHistory.content_id, ids)
        )
      );
    await db.delete(movies).where(inArray(movies.id, ids));
  }

  await db.delete(categories).where(like(categories.slug, `${TEST_SLUG_PREFIX}%`));
  await db.delete(platforms).where(like(platforms.slug, `${TEST_SLUG_PREFIX}%`));
}

async function categoryIdsFor(movieId: string): Promise<string[]> {
  const rows = await db
    .select({ categoryId: movieCategories.category_id })
    .from(movieCategories)
    .where(eq(movieCategories.movie_id, movieId));

  return rows.map(row => row.categoryId).sort();
}

async function platformIdsFor(movieId: string): Promise<string[]> {
  const rows = await db
    .select({ platformId: moviePlatforms.platform_id })
    .from(moviePlatforms)
    .where(eq(moviePlatforms.movie_id, movieId));

  return rows.map(row => row.platformId).sort();
}

beforeEach(async () => {
  await cleanupTestMovies();
});

afterEach(async () => {
  await cleanupTestMovies();
});

afterAll(async () => {
  await cleanupTestMovies();
  await closePool();
});

describe('authorization', () => {
  it('rejects anonymous actors before any write', async () => {
    await expect(createMovie(anonymousActor, movieInput())).rejects.toBeInstanceOf(
      AuthenticationError
    );
  });

  it('rejects actors without movie.manage', async () => {
    await expect(createMovie(readerActor, movieInput())).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('createMovie', () => {
  it('creates a standalone movie with metadata defaults', async () => {
    const input = movieInput();
    const movie = await createMovie(managerActor, input);

    expect(movie.slug).toBe(input.slug);
    expect(movie.title).toBe('Midnight Signal');
    expect(movie.publicationStatus).toBe('draft');
    expect(movie.videoSource).toBeNull();
    expect(movie.poster).toBeNull();
    expect(movie.banner).toBeNull();
    expect(movie.createdAt).toBeTruthy();
    expect(movie.updatedAt).toBeTruthy();

    const [row] = await db.select().from(movies).where(eq(movies.id, movie.id));
    expect(row).toBeDefined();
    expect(row?.description).toBeNull();
    expect(row?.deleted_at).toBeNull();
  });

  it('persists full metadata, a published state, and an HTTPS video source', async () => {
    const movie = await createMovie(
      managerActor,
      movieInput({
        title: 'The Last Tide',
        description: 'A standalone feature film.',
        poster: 'https://img.example.com/poster.jpg',
        banner: 'https://img.example.com/banner.jpg',
        publication_status: 'published',
        video_source: HTTPS_SOURCE,
      })
    );

    expect(movie.description).toBe('A standalone feature film.');
    expect(movie.poster).toBe('https://img.example.com/poster.jpg');
    expect(movie.banner).toBe('https://img.example.com/banner.jpg');
    expect(movie.publicationStatus).toBe('published');
    expect(movie.videoSource).toBe(HTTPS_SOURCE);
  });

  it('persists and de-duplicates category and platform associations', async () => {
    const categoryA = await insertCategory('a');
    const categoryB = await insertCategory('b');
    const platformA = await insertPlatform('a');

    const movie = await createMovie(
      managerActor,
      movieInput({
        categories: [categoryA, categoryB, categoryA],
        platforms: [platformA, platformA],
      })
    );

    expect(await categoryIdsFor(movie.id)).toEqual([categoryA, categoryB].sort());
    expect(await platformIdsFor(movie.id)).toEqual([platformA]);
  });

  it('rejects a duplicate active slug with ConflictError', async () => {
    const input = movieInput();
    await createMovie(managerActor, input);

    await expect(createMovie(managerActor, input)).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows a soft-deleted movie slug to be reused', async () => {
    const input = movieInput();
    const first = await createMovie(managerActor, input);

    await db.update(movies).set({ deleted_at: new Date() }).where(eq(movies.id, first.id));

    const second = await createMovie(managerActor, input);
    expect(second.id).not.toBe(first.id);
  });

  it('rejects an unknown category id', async () => {
    await expect(
      createMovie(managerActor, movieInput({ categories: [randomUUID()] }))
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an unknown platform id', async () => {
    await expect(
      createMovie(managerActor, movieInput({ platforms: [randomUUID()] }))
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an HTTP video source', async () => {
    await expect(
      createMovie(managerActor, movieInput({ video_source: 'http://example.com/movie.mp4' }))
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('enforces active-slug uniqueness at the database level', async () => {
    const slug = testSlug('db-unique');

    await db.insert(movies).values({ title: 'First', slug });

    await expect(db.insert(movies).values({ title: 'Second', slug })).rejects.toMatchObject({
      cause: { code: '23505' },
    });
  });
});

describe('updateMovie', () => {
  it('replaces metadata and associations in one operation', async () => {
    const categoryA = await insertCategory('update-a');
    const categoryB = await insertCategory('update-b');
    const platformA = await insertPlatform('update-a');
    const platformB = await insertPlatform('update-b');

    const created = await createMovie(
      managerActor,
      movieInput({ categories: [categoryA], platforms: [platformA] })
    );

    const updated = await updateMovie(managerActor, created.id, {
      title: 'Midnight Signal: Redux',
      slug: created.slug,
      description: 'Updated description.',
      poster: 'https://img.example.com/new-poster.jpg',
      banner: null,
      publication_status: 'unpublished',
      video_source: HTTPS_SOURCE,
      categories: [categoryB],
      platforms: [platformB],
    });

    expect(updated.title).toBe('Midnight Signal: Redux');
    expect(updated.description).toBe('Updated description.');
    expect(updated.poster).toBe('https://img.example.com/new-poster.jpg');
    expect(updated.banner).toBeNull();
    expect(updated.publicationStatus).toBe('unpublished');
    expect(updated.videoSource).toBe(HTTPS_SOURCE);

    expect(await categoryIdsFor(created.id)).toEqual([categoryB]);
    expect(await platformIdsFor(created.id)).toEqual([platformB]);
  });

  it('records slug history when the slug changes', async () => {
    const created = await createMovie(managerActor, movieInput());
    const originalSlug = created.slug;
    const newSlug = testSlug('renamed');

    await updateMovie(managerActor, created.id, {
      title: created.title,
      slug: newSlug,
    });

    const history = await db
      .select()
      .from(contentSlugHistory)
      .where(eq(contentSlugHistory.content_id, created.id));

    expect(history).toHaveLength(1);
    expect(history[0]?.content_type).toBe('movie');
    expect(history[0]?.old_slug).toBe(originalSlug);
    expect(history[0]?.new_slug).toBe(newSlug);
  });

  it('does not record slug history when the slug is unchanged', async () => {
    const created = await createMovie(managerActor, movieInput());

    await updateMovie(managerActor, created.id, {
      title: 'Renamed but same slug',
      slug: created.slug,
    });

    const history = await db
      .select()
      .from(contentSlugHistory)
      .where(eq(contentSlugHistory.content_id, created.id));

    expect(history).toHaveLength(0);
  });

  it('clears a nullable video source when null is supplied', async () => {
    const created = await createMovie(managerActor, movieInput({ video_source: HTTPS_SOURCE }));

    const updated = await updateMovie(managerActor, created.id, {
      title: created.title,
      slug: created.slug,
      video_source: null,
    });

    expect(updated.videoSource).toBeNull();

    const [row] = await db.select().from(movies).where(eq(movies.id, created.id));
    expect(row?.video_source).toBeNull();
  });

  it('rejects a slug already used by another active movie', async () => {
    const first = await createMovie(managerActor, movieInput());
    const second = await createMovie(managerActor, movieInput());

    await expect(
      updateMovie(managerActor, second.id, { title: second.title, slug: first.slug })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('allows a movie to keep its own slug during an edit', async () => {
    const created = await createMovie(managerActor, movieInput());

    const updated = await updateMovie(managerActor, created.id, {
      title: 'New title',
      slug: created.slug,
    });

    expect(updated.slug).toBe(created.slug);
  });

  it('rejects a missing movie with NotFoundError', async () => {
    await expect(updateMovie(managerActor, randomUUID(), movieInput())).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});
