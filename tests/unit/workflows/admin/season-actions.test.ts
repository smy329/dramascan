import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  resolveActorMock,
  createSeasonMock,
  updateSeasonMock,
  deleteSeasonMock,
  reorderSeasonsMock,
} = vi.hoisted(() => ({
  resolveActorMock: vi.fn(),
  createSeasonMock: vi.fn(),
  updateSeasonMock: vi.fn(),
  deleteSeasonMock: vi.fn(),
  reorderSeasonsMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );
  return { resolveActor: resolveActorMock, requirePermission: guards.requirePermission };
});

vi.mock('@/workflows/admin/seasons', () => ({
  createSeason: createSeasonMock,
  updateSeason: updateSeasonMock,
  deleteSeason: deleteSeasonMock,
  reorderSeasons: reorderSeasonsMock,
}));

import {
  createSeasonAction,
  deleteSeasonAction,
  reorderSeasonsAction,
} from '@/workflows/admin/season-actions';

const DRAMA_ID = '00000000-0000-4000-8000-000000000000';
const SEASON_ID = '11111111-1111-4111-8111-111111111111';

const manager = {
  userId: 'u1',
  roles: [],
  isSuperAdmin: false,
  permissions: ['season.manage'],
};

const seasonRow = {
  id: SEASON_ID,
  dramaId: DRAMA_ID,
  title: 'Season 1',
  position: 0,
  episodeCount: 0,
  createdAt: '2026-11-18T00:00:00.000Z',
};

beforeEach(() => {
  resolveActorMock.mockReset();
  resolveActorMock.mockResolvedValue(manager);
  createSeasonMock.mockReset();
  updateSeasonMock.mockReset();
  deleteSeasonMock.mockReset();
  reorderSeasonsMock.mockReset();
});

describe('createSeasonAction', () => {
  it('forwards title and position to workflow and returns season data', async () => {
    createSeasonMock.mockResolvedValue({ ok: true, season: seasonRow });

    const result = await createSeasonAction({ dramaId: DRAMA_ID, title: 'Season 1', position: 0 });

    expect(createSeasonMock).toHaveBeenCalledWith(manager, DRAMA_ID, {
      title: 'Season 1',
      position: 0,
    });
    expect(result).toEqual({ ok: true, data: seasonRow });
  });

  it('refuses an actor without season.manage', async () => {
    resolveActorMock.mockResolvedValue({ ...manager, permissions: [] });

    const result = await createSeasonAction({ dramaId: DRAMA_ID, title: 'Season 1' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { code: string }).code).toBe('forbidden');
    }
  });
});

describe('deleteSeasonAction', () => {
  it('returns affectedEpisodes on success', async () => {
    deleteSeasonMock.mockResolvedValue({ ok: true, affectedEpisodes: 3 });

    const result = await deleteSeasonAction({ id: SEASON_ID });

    expect(deleteSeasonMock).toHaveBeenCalledWith(manager, SEASON_ID);
    expect(result).toEqual({ ok: true, data: { affectedEpisodes: 3 } });
  });
});

describe('reorderSeasonsAction', () => {
  it('forwards dramaId and ordered season ids', async () => {
    reorderSeasonsMock.mockResolvedValue({ ok: true, reordered: 2 });

    const result = await reorderSeasonsAction({
      drama_id: DRAMA_ID,
      ids: [SEASON_ID, '22222222-2222-4222-8222-222222222222'],
    });

    expect(reorderSeasonsMock).toHaveBeenCalledWith(manager, DRAMA_ID, [
      SEASON_ID,
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(result).toEqual({ ok: true, data: { reordered: 2 } });
  });
});
