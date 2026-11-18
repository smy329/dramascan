import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveActorMock, createDramaMock } = vi.hoisted(() => ({
  resolveActorMock: vi.fn(),
  createDramaMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));

// The real guard decides, so the test proves the action enforces the canonical
// permission rather than trusting the caller.
vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );
  return { resolveActor: resolveActorMock, requirePermission: guards.requirePermission };
});

vi.mock('@/workflows/admin/dramas', () => ({ createDrama: createDramaMock }));

import { createDramaAction } from '@/workflows/admin/drama-actions';

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';

const manager = {
  userId: 'u1',
  roles: [],
  isSuperAdmin: false,
  permissions: ['drama.manage'],
};

const createdDrama = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Seasons of Glass',
  slug: 'seasons-of-glass',
  description: null,
  status: 'ongoing',
  structure_type: 'flat',
  visibility: 'coming_soon',
  poster: null,
  banner: null,
  publicationStatus: 'draft',
  publiclyAvailable: false,
  createdAt: '2026-11-18T00:00:00.000Z',
  updatedAt: '2026-11-18T00:00:00.000Z',
};

function formValues(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Seasons of Glass',
    slug: 'seasons-of-glass',
    description: '',
    status: 'ongoing',
    structure_type: 'flat',
    poster: '',
    banner: '',
    categories: [CATEGORY_ID],
    platforms: [],
    ...overrides,
  };
}

beforeEach(() => {
  resolveActorMock.mockReset();
  createDramaMock.mockReset();
  resolveActorMock.mockResolvedValue(manager);
});

describe('createDramaAction', () => {
  it('normalizes the form values into the domain payload', async () => {
    createDramaMock.mockResolvedValue({ ok: true, drama: createdDrama });

    const result = await createDramaAction(formValues());

    expect(result).toEqual({
      ok: true,
      data: {
        id: createdDrama.id,
        title: createdDrama.title,
        slug: createdDrama.slug,
        structure_type: 'flat',
      },
    });
    expect(createDramaMock).toHaveBeenCalledWith(manager, {
      title: 'Seasons of Glass',
      slug: 'seasons-of-glass',
      description: undefined,
      status: 'ongoing',
      structure_type: 'flat',
      poster: null,
      banner: null,
      categories: [CATEGORY_ID],
      platforms: [],
    });
  });

  it('strips the empty description and keeps supplied media URLs', async () => {
    createDramaMock.mockResolvedValue({ ok: true, drama: createdDrama });

    await createDramaAction(
      formValues({
        description: 'Two families, one secret.',
        poster: 'https://cdn.example.com/poster.jpg',
        banner: 'https://cdn.example.com/banner.jpg',
      })
    );

    expect(createDramaMock).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        description: 'Two families, one secret.',
        poster: 'https://cdn.example.com/poster.jpg',
        banner: 'https://cdn.example.com/banner.jpg',
      })
    );
  });

  it('returns the duplicate-slug error as a field error instead of an internal error', async () => {
    createDramaMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'validation_error',
        message: 'A drama with this slug already exists.',
        fieldErrors: { slug: ['A drama with this slug already exists.'] },
      },
    });

    const result = await createDramaAction(formValues());

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'validation_error',
        message: 'A drama with this slug already exists.',
        fieldErrors: { slug: ['A drama with this slug already exists.'] },
      },
    });
  });

  it('maps an AppError thrown by the workflow through the standard error mapper', async () => {
    const { NotFoundError } = await import('@/platform/errors');
    createDramaMock.mockRejectedValue(new NotFoundError('Drama not found.'));

    const result = await createDramaAction(formValues());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_found');
      expect(result.error.message).toBe('Drama not found.');
    }
  });

  it('rejects invalid input before the workflow runs', async () => {
    const result = await createDramaAction(formValues({ slug: 'Not A Slug' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
      expect(result.error.fieldErrors?.slug).toBeDefined();
    }
    expect(createDramaMock).not.toHaveBeenCalled();
  });

  it('refuses an actor without drama.manage', async () => {
    resolveActorMock.mockResolvedValue({ ...manager, permissions: [] });

    const result = await createDramaAction(formValues());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('forbidden');
    }
    expect(createDramaMock).not.toHaveBeenCalled();
  });
});
