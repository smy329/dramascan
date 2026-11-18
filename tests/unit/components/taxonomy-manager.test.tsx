// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const {
  createCategoryActionMock,
  updateCategoryActionMock,
  deleteCategoryActionMock,
  reorderCategoriesActionMock,
  createPlatformActionMock,
  updatePlatformActionMock,
  deletePlatformActionMock,
  reorderPlatformsActionMock,
  refreshMock,
} = vi.hoisted(() => ({
  createCategoryActionMock: vi.fn(),
  updateCategoryActionMock: vi.fn(),
  deleteCategoryActionMock: vi.fn(),
  reorderCategoriesActionMock: vi.fn(),
  createPlatformActionMock: vi.fn(),
  updatePlatformActionMock: vi.fn(),
  deletePlatformActionMock: vi.fn(),
  reorderPlatformsActionMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

vi.mock('@/workflows/admin/taxonomy-actions', () => ({
  createCategoryAction: createCategoryActionMock,
  updateCategoryAction: updateCategoryActionMock,
  deleteCategoryAction: deleteCategoryActionMock,
  reorderCategoriesAction: reorderCategoriesActionMock,
  createPlatformAction: createPlatformActionMock,
  updatePlatformAction: updatePlatformActionMock,
  deletePlatformAction: deletePlatformActionMock,
  reorderPlatformsAction: reorderPlatformsActionMock,
}));

import type { TaxonomyDto } from '@/lib/contracts/taxonomy-form';

import { TaxonomyManager } from '@/components/admin/taxonomy/taxonomy-manager';

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_CATEGORY_ID = '22222222-2222-4222-8222-222222222222';

const ROWS: readonly TaxonomyDto[] = [
  {
    id: CATEGORY_ID,
    name: 'Romance',
    slug: 'romance',
    position: 0,
    visibility: 'visible',
    usageCount: 2,
  },
  {
    id: SECOND_CATEGORY_ID,
    name: 'Comedy',
    slug: 'comedy',
    position: 1,
    visibility: 'hidden',
    usageCount: 0,
  },
];

beforeEach(() => {
  createCategoryActionMock.mockReset();
  updateCategoryActionMock.mockReset();
  deleteCategoryActionMock.mockReset();
  reorderCategoriesActionMock.mockReset();
  createPlatformActionMock.mockReset();
  updatePlatformActionMock.mockReset();
  deletePlatformActionMock.mockReset();
  reorderPlatformsActionMock.mockReset();
  refreshMock.mockReset();
});

afterEach(cleanup);

describe('TaxonomyManager', () => {
  it('renders the category create form with a name field and a visibility select', () => {
    render(<TaxonomyManager resource="category" rows={ROWS} />);

    expect(screen.getByText('New category')).toBeTruthy();
    expect(screen.getByLabelText('Name *')).toBeTruthy();
    expect(screen.getByLabelText('Visibility *')).toBeTruthy();
    expect(screen.getByText('Romance')).toBeTruthy();
    expect(screen.getByText('Comedy')).toBeTruthy();
  });

  it('renders the platform form without a visibility select', () => {
    render(<TaxonomyManager resource="platform" rows={ROWS} />);

    expect(screen.getByText('New platform')).toBeTruthy();
    expect(screen.getByLabelText('Name *')).toBeTruthy();
    expect(screen.queryByLabelText(/Visibility/)).toBeNull();
  });

  it('disables Move up on the first row and Move down on the last', () => {
    render(<TaxonomyManager resource="category" rows={ROWS} />);

    const moves = screen.getAllByRole('button', { name: /Move/ });

    expect(moves).toHaveLength(4);
    expect((moves[0] as HTMLButtonElement).disabled).toBe(true);
    expect((moves[1] as HTMLButtonElement).disabled).toBe(false);
    expect((moves[2] as HTMLButtonElement).disabled).toBe(false);
    expect((moves[3] as HTMLButtonElement).disabled).toBe(true);
  });

  it('reveals a prefilled edit form when Edit is clicked', () => {
    render(<TaxonomyManager resource="category" rows={ROWS} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);

    const names = screen.getAllByLabelText('Name *');

    expect(names).toHaveLength(2);
    expect((names[1] as HTMLInputElement).value).toBe('Romance');
    expect((screen.getAllByLabelText('Visibility *')[1] as HTMLSelectElement).value).toBe('visible');
  });

  it('opens a delete dialog naming the usage count and deletes on confirm', async () => {
    deleteCategoryActionMock.mockResolvedValue({ ok: true, data: { usageCount: 2 } });

    render(<TaxonomyManager resource="category" rows={ROWS} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);

    const dialog = await screen.findByRole('alertdialog');

    expect((dialog as HTMLElement).textContent ?? '').toContain('Used by 2 items.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteCategoryActionMock).toHaveBeenCalledWith({ id: CATEGORY_ID }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('blocks an empty create and shows the validation message', async () => {
    render(<TaxonomyManager resource="category" rows={ROWS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));

    expect(await screen.findByText('Name is required.')).toBeTruthy();
    expect(createCategoryActionMock).not.toHaveBeenCalled();
  });

  it('refreshes after a successful create', async () => {
    createCategoryActionMock.mockResolvedValue({
      ok: true,
      data: ROWS[0],
    });

    render(<TaxonomyManager resource="category" rows={ROWS} />);

    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Thriller' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add category' }));

    await waitFor(() => expect(createCategoryActionMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('reorders by sending the full id order', async () => {
    reorderCategoriesActionMock.mockResolvedValue({ ok: true, data: { reordered: 2 } });

    render(<TaxonomyManager resource="category" rows={ROWS} />);

    fireEvent.click(screen.getAllByRole('button', { name: /Move .* down/ })[0]!);

    await waitFor(() =>
      expect(reorderCategoriesActionMock).toHaveBeenCalledWith({
        ids: [SECOND_CATEGORY_ID, CATEGORY_ID],
      })
    );
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });
});
