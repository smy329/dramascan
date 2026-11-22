// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { createDramaActionMock, pushMock, refreshMock } = vi.hoisted(() => ({
  createDramaActionMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock('@/workflows/admin/drama-actions', () => ({
  createDramaAction: createDramaActionMock,
}));

import { DramaCreateForm } from '@/components/admin/dramas/drama-create-form';

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
const PLATFORM_ID = '22222222-2222-4222-8222-222222222222';

const CATEGORIES = [{ id: CATEGORY_ID, name: 'Romance' }];
const PLATFORMS = [{ id: PLATFORM_ID, name: 'Netflix' }];

beforeEach(() => {
  createDramaActionMock.mockReset();
  pushMock.mockReset();
  refreshMock.mockReset();
});

afterEach(cleanup);

describe('DramaCreateForm', () => {
  it('renders every field required by Prompt 053 except the derived slug', () => {
    render(<DramaCreateForm categories={CATEGORIES} platforms={PLATFORMS} />);

    expect(screen.getByLabelText(/Title/)).toBeTruthy();
    expect(screen.getByLabelText('Description')).toBeTruthy();
    expect(screen.getByLabelText(/Status/)).toBeTruthy();
    expect(screen.getByLabelText(/Episode structure/)).toBeTruthy();
    expect(screen.getByLabelText('Poster URL')).toBeTruthy();
    expect(screen.getByLabelText('Banner URL')).toBeTruthy();
    expect(screen.getByLabelText('Romance')).toBeTruthy();
    expect(screen.getByLabelText('Netflix')).toBeTruthy();
    expect(screen.queryByLabelText(/release year/i)).toBeNull();

    // The slug is derived from the title, so no slug control may exist.
    expect(screen.queryByRole('textbox', { name: /slug/i })).toBeNull();
    expect(screen.getByText('The URL slug is generated from the title.')).toBeTruthy();
  });

  it('blocks submission until the required fields are valid', async () => {
    render(<DramaCreateForm categories={CATEGORIES} platforms={PLATFORMS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Create drama' }));

    expect(await screen.findByText('Title is required.')).toBeTruthy();
    expect(createDramaActionMock).not.toHaveBeenCalled();
  });

  it('submits the title without a slug so the action derives it', async () => {
    createDramaActionMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'drama-1',
        title: 'This Is My Home',
        slug: 'this-is-my-home',
        structure_type: 'flat',
      },
    });

    render(<DramaCreateForm categories={CATEGORIES} platforms={PLATFORMS} />);

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'This Is My Home' } });
    fireEvent.change(screen.getByLabelText(/Status/), { target: { value: 'completed' } });
    fireEvent.change(screen.getByLabelText(/Episode structure/), { target: { value: 'flat' } });
    fireEvent.click(screen.getByLabelText('Romance'));
    fireEvent.click(screen.getByLabelText('Netflix'));
    fireEvent.click(screen.getByRole('button', { name: 'Create drama' }));

    await waitFor(() => expect(createDramaActionMock).toHaveBeenCalledTimes(1));

    const submitted = createDramaActionMock.mock.calls[0]?.[0];

    expect(submitted).toEqual({
      title: 'This Is My Home',
      description: '',
      status: 'completed',
      structure_type: 'flat',
      visibility: 'coming_soon',
      poster: '',
      banner: '',
      categories: [CATEGORY_ID],
      platforms: [PLATFORM_ID],
    });
    expect(submitted).not.toHaveProperty('slug');

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/admin/dramas'));
    expect(refreshMock).toHaveBeenCalled();
  });

  it('keeps the administrator on the form and shows the duplicate-title conflict', async () => {
    createDramaActionMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'validation_error',
        message: 'A drama with this slug already exists.',
        fieldErrors: { title: ['A drama with this slug already exists.'] },
      },
    });

    render(<DramaCreateForm categories={CATEGORIES} platforms={PLATFORMS} />);

    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Seasons of Glass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create drama' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(
      (await screen.findAllByText('A drama with this slug already exists.')).length
    ).toBeGreaterThan(0);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
