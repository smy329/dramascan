// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { previewMock, applyMock, refreshMock } = vi.hoisted(() => ({
  previewMock: vi.fn(),
  applyMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('@/workflows/admin/movie-conversion-actions', () => ({
  previewDramaMovieConversion: previewMock,
  applyDramaMovieConversion: applyMock,
}));

// The real dialog is covered by the browser suite; this test isolates the
// panel's state machine from the portal implementation.
vi.mock('@/components/dialogs/confirmation-dialog', () => ({
  ConfirmationDialog: (props: {
    open?: boolean;
    title: string;
    confirmLabel?: string;
    onConfirm: () => void;
  }) => {
    if (!props.open) {
      return null;
    }

    return (
      <div role="alertdialog">
        <p>{props.title}</p>
        <button type="button" onClick={props.onConfirm}>
          {props.confirmLabel ?? 'Confirm'}
        </button>
      </div>
    );
  },
}));

import { DramaMovieConversionPanel } from '@/components/admin/dramas/drama-movie-conversion-panel';
import type {
  MovieConversionApplyResultDto,
  MovieConversionPreviewDto,
} from '@/lib/contracts/drama-movie-conversion';

const DRAMA_ID = '0198f3a2-0000-7000-8000-000000000010';
const FINGERPRINT = 'a'.repeat(64);

function plan(overrides: Partial<MovieConversionPreviewDto['movie']> = {}): MovieConversionPreviewDto {
  return {
    dramaId: DRAMA_ID,
    fingerprint: FINGERPRINT,
    source: {
      dramaId: DRAMA_ID,
      episodeId: '0198f3a2-0000-7000-8000-000000000011',
      episodeTitle: 'The Last Winter',
      episodeNumber: 1,
      seasonId: null,
    },
    movie: {
      title: 'Seasons of Glass',
      slug: 'seasons-of-glass',
      description: 'A quiet family drama.',
      poster: 'https://media.example.com/posters/glass.jpg',
      banner: null,
      publicationStatus: 'published',
      videoSource: 'https://media.example.com/episodes/glass.mp4',
      convertedFromDramaId: DRAMA_ID,
      categories: [{ id: '0198f3a2-0000-7000-8000-0000000000a1', name: 'Drama' }],
      platforms: [{ id: '0198f3a2-0000-7000-8000-0000000000b1', name: 'Web' }],
      ...overrides,
    },
    relationships: {
      ratings: 4,
      reviews: 2,
      bookmarks: 1,
      playbackProgress: 3,
      watchedState: 1,
      watchHistory: 9,
      categories: 1,
      platforms: 1,
      slugHistory: 0,
      seo: 0,
      assets: 0,
      notifications: 2,
      adminNotifications: 0,
      analyticsEvents: 30,
    },
    warnings: [],
  };
}

function applied(overrides: Partial<MovieConversionApplyResultDto> = {}): MovieConversionApplyResultDto {
  return { ...plan(), applied: true, movieId: '0198f3a2-0000-7000-8000-0000000000ff', ...overrides };
}

function renderPanel(overrides: Record<string, unknown> = {}) {
  return render(
    <DramaMovieConversionPanel
      dramaId={DRAMA_ID}
      dramaTitle="Seasons of Glass"
      eligible
      ineligibilityReason={null}
      episodeTitle="The Last Winter"
      activeEpisodeCount={1}
      {...overrides}
    />
  );
}

beforeEach(() => {
  previewMock.mockReset();
  applyMock.mockReset();
  refreshMock.mockReset();
});

afterEach(cleanup);

describe('DramaMovieConversionPanel', () => {
  it('explains why an ineligible drama cannot be converted', () => {
    renderPanel({
      eligible: false,
      ineligibilityReason: 'The drama has 2 active episodes.',
      activeEpisodeCount: 2,
    });

    expect(screen.getByRole('alert').textContent).toContain('2 active episodes');
    expect(screen.queryByRole('button', { name: 'Preview conversion' })).toBeNull();
  });

  it('starts with the confirm action disabled until a preview exists', () => {
    renderPanel();

    expect(screen.getByText(/currently has 1 active episode\./)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Convert to movie' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('renders the preview details returned by the server', async () => {
    previewMock.mockResolvedValue({ ok: true, data: plan() });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Preview conversion' }));

    expect(await screen.findByText('seasons-of-glass')).toBeTruthy();
    expect(screen.getByText('A quiet family drama.')).toBeTruthy();
    expect(screen.getByText('https://media.example.com/episodes/glass.mp4')).toBeTruthy();
    expect(screen.getByText('Drama')).toBeTruthy();
    expect(screen.getByText('Web')).toBeTruthy();
    expect(screen.getByText('Ratings: 4')).toBeTruthy();
    expect(previewMock).toHaveBeenCalledWith(DRAMA_ID);

    const confirm = screen.getByRole('button', { name: 'Convert to movie' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
  });

  it('shows a preview conflict without enabling the confirm action', async () => {
    previewMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'conflict',
        message: 'The slug "seasons-of-glass" is already used by the movie "Existing".',
      },
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Preview conversion' }));

    expect(await screen.findByText(/already used by the movie "Existing"/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Convert to movie' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('applies the exact previewed fingerprint and reports success', async () => {
    previewMock.mockResolvedValue({ ok: true, data: plan() });
    applyMock.mockResolvedValue({ ok: true, data: applied() });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Preview conversion' }));
    await screen.findByText('seasons-of-glass');

    fireEvent.click(screen.getByRole('button', { name: 'Convert to movie' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Convert this drama to a movie?');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Convert to movie' }));

    await waitFor(() => expect(applyMock).toHaveBeenCalledWith(DRAMA_ID, FINGERPRINT));
    expect(await screen.findByText(/was created as a standalone movie/)).toBeTruthy();
    expect(refreshMock).toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('reports an apply conflict and keeps the preview for a retry', async () => {
    previewMock.mockResolvedValue({ ok: true, data: plan() });
    applyMock.mockResolvedValue({
      ok: false,
      error: { code: 'conflict', message: 'The drama changed after the preview.' },
    });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Preview conversion' }));
    await screen.findByText('seasons-of-glass');

    fireEvent.click(screen.getByRole('button', { name: 'Convert to movie' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Convert to movie' }));

    expect(await screen.findByText('The drama changed after the preview.')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByText(/was created as a standalone movie/)).toBeNull();
    expect(screen.getByText('seasons-of-glass')).toBeTruthy();
  });
});
