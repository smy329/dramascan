import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  resolveActorMock,
  createCategoryMock,
  updateCategoryMock,
  deleteCategoryMock,
  reorderCategoriesMock,
  createPlatformMock,
  updatePlatformMock,
  deletePlatformMock,
  reorderPlatformsMock,
} = vi.hoisted(() => ({
  resolveActorMock: vi.fn(),
  createCategoryMock: vi.fn(),
  updateCategoryMock: vi.fn(),
  deleteCategoryMock: vi.fn(),
  reorderCategoriesMock: vi.fn(),
  createPlatformMock: vi.fn(),
  updatePlatformMock: vi.fn(),
  deletePlatformMock: vi.fn(),
  reorderPlatformsMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));

// The real guard decides, so the test proves the actions enforce the canonical
// permission rather than trusting the caller.
vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );
  return { resolveActor: resolveActorMock, requirePermission: guards.requirePermission };
});

vi.mock('@/workflows/admin/taxonomy', () => ({
  createCategory: createCategoryMock,
  updateCategory: updateCategoryMock,
  deleteCategory: deleteCategoryMock,
  reorderCategories: reorderCategoriesMock,
  createPlatform: createPlatformMock,
  updatePlatform: updatePlatformMock,
  deletePlatform: deletePlatformMock,
  reorderPlatforms: reorderPlatformsMock,
}));

import {
  createCategoryAction,
  createPlatformAction,
  deleteCategoryAction,
  reorderCategoriesAction,
  reorderPlatformsAction,
  updateCategoryAction,
  updatePlatformAction,
  deletePlatformAction,
} from '@/workflows/admin/taxonomy-actions';

const ID = '11111111-1111-4111-8111-111111111111';

const manager = {
  userId: 'u1',
  roles: [],
  isSuperAdmin: false,
  permissions: ['category.manage', 'platform.manage'],
};

const categoryRow = {
  id: ID,
  name: 'Romance',
  slug: 'romance',
  position: 0,
  visibility: 'visible',
  usageCount: 3,
  createdAt: '2026-11-18T00:00:00.000Z',
};

beforeEach(() => {
  resolveActorMock.mockReset();
  resolveActorMock.mockResolvedValue(manager);
  createCategoryMock.mockReset();
  updateCategoryMock.mockReset();
  deleteCategoryMock.mockReset();
  reorderCategoriesMock.mockReset();
  createPlatformMock.mockReset();
  updatePlatformMock.mockReset();
  deletePlatformMock.mockReset();
  reorderPlatformsMock.mockReset();
});

describe('createCategoryAction', () => {
  it('passes the validated name and visibility and returns the workflow row', async () => {
    createCategoryMock.mockResolvedValue({ ok: true, category: categoryRow });

    const result = await createCategoryAction({ name: 'Romance', visibility: 'hidden' });

    expect(createCategoryMock).toHaveBeenCalledWith(manager, {
      name: 'Romance',
      visibility: 'hidden',
    });
    expect(result).toEqual({
      ok: true,
      data: {
        id: ID,
        name: 'Romance',
        slug: 'romance',
        position: 0,
        visibility: 'visible',
        usageCount: 3,
      },
    });
  });

  it('rejects an empty name before the workflow runs', async () => {
    const result = await createCategoryAction({ name: '', visibility: 'visible' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
    }
    expect(createCategoryMock).not.toHaveBeenCalled();
  });

  it('reports a duplicate-name error on the name field', async () => {
    createCategoryMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'validation_error',
        message: 'A category with this name already exists.',
        fieldErrors: { name: ['A category with this name already exists.'] },
      },
    });

    const result = await createCategoryAction({ name: 'Romance', visibility: 'visible' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.fieldErrors?.name).toEqual(['A category with this name already exists.']);
    }
  });

  it('refuses an actor without category.manage', async () => {
    resolveActorMock.mockResolvedValue({ ...manager, permissions: [] });

    const result = await createCategoryAction({ name: 'Romance', visibility: 'visible' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('forbidden');
    }
    expect(createCategoryMock).not.toHaveBeenCalled();
  });
});

describe('updateCategoryAction', () => {
  it('passes the id and the editable fields', async () => {
    updateCategoryMock.mockResolvedValue({ ok: true, category: categoryRow });

    const result = await updateCategoryAction({
      id: ID,
      name: 'Romance',
      visibility: 'hidden',
    });

    expect(updateCategoryMock).toHaveBeenCalledWith(manager, ID, {
      name: 'Romance',
      visibility: 'hidden',
    });
    expect(result.ok).toBe(true);
  });
});

describe('deleteCategoryAction', () => {
  it('returns the workflow usage count', async () => {
    deleteCategoryMock.mockResolvedValue({ ok: true, usageCount: 2 });

    const result = await deleteCategoryAction({ id: ID });

    expect(deleteCategoryMock).toHaveBeenCalledWith(manager, ID);
    expect(result).toEqual({ ok: true, data: { usageCount: 2 } });
  });

  it('rejects a non-uuid id before the workflow runs', async () => {
    const result = await deleteCategoryAction({ id: 'nope' });

    expect(result.ok).toBe(false);
    expect(deleteCategoryMock).not.toHaveBeenCalled();
  });
});

describe('reorderCategoriesAction', () => {
  it('forwards the full id order', async () => {
    reorderCategoriesMock.mockResolvedValue({ ok: true, reordered: 2 });

    const result = await reorderCategoriesAction({ ids: [ID, '22222222-2222-4222-8222-222222222222'] });

    expect(reorderCategoriesMock).toHaveBeenCalledWith(manager, [
      ID,
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(result).toEqual({ ok: true, data: { reordered: 2 } });
  });

  it('rejects an empty order as validation_error', async () => {
    const result = await reorderCategoriesAction({ ids: [] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
    }
    expect(reorderCategoriesMock).not.toHaveBeenCalled();
  });
});

describe('platform actions', () => {
  it('creates a platform with the name only', async () => {
    createPlatformMock.mockResolvedValue({
      ok: true,
      platform: { ...categoryRow, visibility: null },
    });

    const result = await createPlatformAction({ name: 'Netflix' });

    expect(createPlatformMock).toHaveBeenCalledWith(manager, { name: 'Netflix' });
    expect(result).toEqual({
      ok: true,
      data: {
        id: ID,
        name: 'Romance',
        slug: 'romance',
        position: 0,
        visibility: null,
        usageCount: 3,
      },
    });
  });

  it('rejects a payload carrying a visibility key', async () => {
    const result = await createPlatformAction({ name: 'Netflix', visibility: 'visible' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
    }
    expect(createPlatformMock).not.toHaveBeenCalled();
  });

  it('updates and deletes platforms', async () => {
    updatePlatformMock.mockResolvedValue({ ok: true, platform: { ...categoryRow, visibility: null } });
    deletePlatformMock.mockResolvedValue({ ok: true, usageCount: 0 });

    await updatePlatformAction({ id: ID, name: 'Netflix' });
    const deleted = await deletePlatformAction({ id: ID });

    expect(updatePlatformMock).toHaveBeenCalledWith(manager, ID, { name: 'Netflix' });
    expect(deletePlatformMock).toHaveBeenCalledWith(manager, ID);
    expect(deleted).toEqual({ ok: true, data: { usageCount: 0 } });
  });

  it('reorders platforms and requires platform.manage', async () => {
    reorderPlatformsMock.mockResolvedValue({ ok: true, reordered: 1 });

    await reorderPlatformsAction({ ids: [ID] });

    expect(reorderPlatformsMock).toHaveBeenCalledWith(manager, [ID]);

    resolveActorMock.mockResolvedValue({ ...manager, permissions: [] });
    const refused = await reorderPlatformsAction({ ids: [ID] });

    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe('forbidden');
    }
  });
});
