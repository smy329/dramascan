// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const actionMocks = vi.hoisted(() => ({
  preview: vi.fn(),
  apply: vi.fn(),
}));

vi.mock('@/workflows/admin/conversion-actions', () => ({
  previewDramaConversion: actionMocks.preview,
  applyDramaConversion: actionMocks.apply,
}));

import { DramaConversionPanel } from '@/components/admin/dramas/drama-conversion-panel';
import type { ConversionPlanDto } from '@/lib/contracts/drama-conversion';

const EPISODES = [
  {
    id: '11111111-1111-7111-8111-111111111111',
    title: 'Episode 1',
    episodeNumber: 1,
    position: 0,
    seasonId: '22222222-2222-7222-8222-222222222222',
  },
  {
    id: '33333333-3333-7333-8333-333333333333',
    title: 'Episode 2',
    episodeNumber: 2,
    position: 1,
    seasonId: '22222222-2222-7222-8222-222222222222',
  },
] as const;

function flatPlan(): ConversionPlanDto {
  return {
    dramaId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
    currentStructureType: 'season_based',
    targetStructureType: 'flat',
    strategy: 'convert',
    fingerprint: 'a'.repeat(64),
    seasons: [],
    episodes: EPISODES.map((episode, index) => ({
      id: episode.id,
      title: episode.title,
      fromSeasonId: episode.seasonId,
      toSeasonKey: null,
      fromEpisodeNumber: episode.episodeNumber,
      toEpisodeNumber: index + 1,
      fromPosition: episode.position,
      toPosition: index,
    })),
    counts: { activeEpisodes: 2, seasonsAffected: 1, seasonsCreated: 0 },
    snapshot: null,
    warnings: [],
  };
}

function seasonPlan(): ConversionPlanDto {
  return {
    dramaId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
    currentStructureType: 'flat',
    targetStructureType: 'season_based',
    strategy: 'convert',
    fingerprint: 'b'.repeat(64),
    seasons: [{ key: 'season-1', id: null, title: 'Season 1', position: 0, episodeCount: 2 }],
    episodes: EPISODES.map(episode => ({
      id: episode.id,
      title: episode.title,
      fromSeasonId: null,
      toSeasonKey: 'season-1',
      fromEpisodeNumber: episode.episodeNumber,
      toEpisodeNumber: episode.episodeNumber,
      fromPosition: episode.position,
      toPosition: episode.position,
    })),
    counts: { activeEpisodes: 2, seasonsAffected: 0, seasonsCreated: 1 },
    snapshot: null,
    warnings: [],
  };
}

beforeEach(() => {
  actionMocks.preview.mockReset();
  actionMocks.apply.mockReset();
});

afterEach(cleanup);

describe('season-based drama conversion', () => {
  it('previews the renumbering and applies it with the preview fingerprint', async () => {
    actionMocks.preview.mockResolvedValue({ ok: true, data: flatPlan() });
    actionMocks.apply.mockResolvedValue({
      ok: true,
      data: { plan: flatPlan(), newFingerprint: 'c'.repeat(64) },
    });

    render(
      <DramaConversionPanel
        dramaId="aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa"
        dramaTitle="Test Drama"
        currentStructureType="season_based"
        episodes={EPISODES}
        hasAvailableSnapshot={false}
      />
    );

    expect(screen.getByText(/Current structure: Season-based/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Preview conversion' }));

    await waitFor(() => {
      expect(actionMocks.preview).toHaveBeenCalledTimes(1);
    });

    expect(actionMocks.preview.mock.calls[0]?.[1]).toMatchObject({
      mode: 'preview',
      targetStructureType: 'flat',
    });

    await screen.findByText('Episode 1');
    expect(screen.getByText('Episode 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm conversion' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));

    await waitFor(() => {
      expect(actionMocks.apply).toHaveBeenCalledTimes(1);
    });

    expect(actionMocks.apply.mock.calls[0]?.[1]).toMatchObject({
      mode: 'apply',
      targetStructureType: 'flat',
      fingerprint: 'a'.repeat(64),
    });

    await screen.findByText('Conversion applied.');
  });

  it('renders a server error in an alert region', async () => {
    actionMocks.preview.mockResolvedValue({
      ok: false,
      error: { code: 'conflict', message: 'The drama structure changed after the preview.' },
    });

    render(
      <DramaConversionPanel
        dramaId="aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa"
        dramaTitle="Test Drama"
        currentStructureType="season_based"
        episodes={EPISODES}
        hasAvailableSnapshot={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preview conversion' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The drama structure changed after the preview.');
  });
});

describe('flat drama conversion', () => {
  it('shows the distribution editor and sends the full distribution', async () => {
    actionMocks.preview.mockResolvedValue({ ok: true, data: seasonPlan() });

    render(
      <DramaConversionPanel
        dramaId="aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa"
        dramaTitle="Test Drama"
        currentStructureType="flat"
        episodes={EPISODES}
        hasAvailableSnapshot={false}
      />
    );

    expect(screen.getByLabelText('Season title')).toBeTruthy();
    expect(screen.getByLabelText(/Episode 1/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add season' }));

    const titles = screen.getAllByLabelText('Season title') as HTMLInputElement[];
    expect(titles).toHaveLength(2);

    fireEvent.change(titles[1]!, { target: { value: 'Season 2' } });

    const assignment = screen.getByLabelText(/Episode 2/) as HTMLSelectElement;
    fireEvent.change(assignment, { target: { value: 'season-2' } });

    fireEvent.click(screen.getByRole('button', { name: 'Preview conversion' }));

    await waitFor(() => {
      expect(actionMocks.preview).toHaveBeenCalledTimes(1);
    });

    const request = actionMocks.preview.mock.calls[0]?.[1] as {
      strategy?: string;
      distribution?: {
        seasons: { key: string; title: string }[];
        assignments: { episodeId: string; seasonKey: string }[];
      };
    };

    expect(request.strategy).toBe('convert');
    expect(request.distribution?.seasons).toEqual([
      { key: 'season-1', title: 'Season 1', position: 0 },
      { key: 'season-2', title: 'Season 2', position: 1 },
    ]);
    expect(request.distribution?.assignments).toEqual([
      { episodeId: EPISODES[0].id, seasonKey: 'season-1' },
      { episodeId: EPISODES[1].id, seasonKey: 'season-2' },
    ]);
  });

  it('requires an explicit strategy choice when a snapshot is available', async () => {
    actionMocks.preview.mockResolvedValue({ ok: true, data: seasonPlan() });

    render(
      <DramaConversionPanel
        dramaId="aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa"
        dramaTitle="Test Drama"
        currentStructureType="flat"
        episodes={EPISODES}
        hasAvailableSnapshot
      />
    );

    const restore = screen.getByLabelText(/Restore previous structure/) as HTMLInputElement;
    const convert = screen.getByLabelText(/Create new seasons/) as HTMLInputElement;

    expect(restore.checked).toBe(true);
    expect(convert.checked).toBe(false);

    fireEvent.click(convert);

    expect((screen.getByLabelText(/Create new seasons/) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText('Season title')).toBeTruthy();
  });
});
