import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  resolveActorMock,
  createEpisodeMock,
  updateEpisodeMock,
  deleteEpisodeMock,
  reorderEpisodesMock,
  renumberEpisodesMock,
  replaceEpisodeVideoSourceMock,
  updatePublicationMock,
} = vi.hoisted(() => ({
  resolveActorMock: vi.fn(),
  createEpisodeMock: vi.fn(),
  updateEpisodeMock: vi.fn(),
  deleteEpisodeMock: vi.fn(),
  reorderEpisodesMock: vi.fn(),
  renumberEpisodesMock: vi.fn(),
  replaceEpisodeVideoSourceMock: vi.fn(),
  updatePublicationMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );
  return { resolveActor: resolveActorMock, requirePermission: guards.requirePermission };
});

vi.mock('@/workflows/admin/episodes', () => ({
  createEpisode: createEpisodeMock,
  updateEpisode: updateEpisodeMock,
  deleteEpisode: deleteEpisodeMock,
  reorderEpisodes: reorderEpisodesMock,
  renumberEpisodes: renumberEpisodesMock,
  replaceEpisodeVideoSource: replaceEpisodeVideoSourceMock,
}));

vi.mock('@/workflows/admin/publication', () => ({
  updatePublication: updatePublicationMock,
}));

import {
  createEpisodeAction,
  deleteEpisodeAction,
  publishEpisodeAction,
  renumberEpisodesAction,
  reorderEpisodesAction,
  unpublishEpisodeAction,
  updateEpisodeAction,
} from '@/workflows/admin/episode-actions';

const DRAMA_ID = '00000000-0000-4000-8000-000000000000';
const EPISODE_ID = '11111111-1111-4111-8111-111111111111';
const SEASON_ID = '22222222-2222-4222-8222-222222222222';

const manager = {
  userId: 'u1',
  roles: [],
  isSuperAdmin: false,
  permissions: ['episode.manage'],
};

const episodeRow = {
  id: EPISODE_ID,
  dramaId: DRAMA_ID,
  seasonId: SEASON_ID,
  title: 'Episode 1',
  description: null,
  episodeNumber: 1,
  position: 0,
  publicationStatus: null,
  videoSource: null,
  createdAt: '2026-11-18T00:00:00.000Z',
  updatedAt: '2026-11-18T00:00:00.000Z',
};

beforeEach(() => {
  resolveActorMock.mockReset();
  resolveActorMock.mockResolvedValue(manager);
  createEpisodeMock.mockReset();
  updateEpisodeMock.mockReset();
  deleteEpisodeMock.mockReset();
  reorderEpisodesMock.mockReset();
  renumberEpisodesMock.mockReset();
  replaceEpisodeVideoSourceMock.mockReset();
  updatePublicationMock.mockReset();
});

describe('createEpisodeAction', () => {
  it('forwards form fields to workflow and returns episode data', async () => {
    createEpisodeMock.mockResolvedValue({ ok: true, episode: episodeRow });

    const result = await createEpisodeAction({
      dramaId: DRAMA_ID,
      title: 'Episode 1',
      season_id: SEASON_ID,
      episode_number: 1,
    });

    expect(createEpisodeMock).toHaveBeenCalledWith(manager, DRAMA_ID, {
      title: 'Episode 1',
      description: undefined,
      season_id: SEASON_ID,
      episode_number: 1,
      video_source: undefined,
    });
    expect(result).toEqual({ ok: true, data: episodeRow });
  });

  it('refuses an actor without episode.manage', async () => {
    resolveActorMock.mockResolvedValue({ ...manager, permissions: [] });

    const result = await createEpisodeAction({ dramaId: DRAMA_ID, title: 'Episode 1' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('forbidden');
    }
    expect(createEpisodeMock).not.toHaveBeenCalled();
  });

  it('maps a workflow validation error to an action error', async () => {
    createEpisodeMock.mockResolvedValue({
      ok: false,
      error: { code: 'validation_error', message: 'An episode with this episode number already exists.' },
    });

    const result = await createEpisodeAction({
      dramaId: DRAMA_ID,
      title: 'Episode 1',
      episode_number: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('An episode with this episode number already exists.');
    }
  });
});

describe('updateEpisodeAction', () => {
  it('forwards form fields to workflow', async () => {
    updateEpisodeMock.mockResolvedValue({ ok: true, episode: episodeRow });

    const result = await updateEpisodeAction({
      id: EPISODE_ID,
      drama_id: DRAMA_ID,
      title: 'Renamed',
    });

    expect(updateEpisodeMock).toHaveBeenCalledWith(manager, EPISODE_ID, {
      title: 'Renamed',
      description: undefined,
      episode_number: undefined,
      season_id: undefined,
      video_source: undefined,
    });
    expect(result).toEqual({ ok: true, data: episodeRow });
  });

  it('refuses an actor without episode.manage', async () => {
    resolveActorMock.mockResolvedValue({ ...manager, permissions: [] });

    const result = await updateEpisodeAction({ id: EPISODE_ID, drama_id: DRAMA_ID, title: 'Renamed' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('forbidden');
    }
    expect(updateEpisodeMock).not.toHaveBeenCalled();
  });
});

describe('deleteEpisodeAction', () => {
  it('returns the deleted episode id on success', async () => {
    deleteEpisodeMock.mockResolvedValue({ ok: true });

    const result = await deleteEpisodeAction({ id: EPISODE_ID });

    expect(deleteEpisodeMock).toHaveBeenCalledWith(manager, EPISODE_ID);
    expect(result).toEqual({ ok: true, data: { id: EPISODE_ID } });
  });

  it('maps a missing episode to a not-found error', async () => {
    deleteEpisodeMock.mockResolvedValue({ ok: false, error: new Error('Episode not found.') });

    const result = await deleteEpisodeAction({ id: EPISODE_ID });

    expect(result.ok).toBe(false);
  });
});

describe('reorderEpisodesAction', () => {
  it('forwards drama id and ordered episode ids', async () => {
    reorderEpisodesMock.mockResolvedValue({ ok: true, episodesReordered: 2 });

    const result = await reorderEpisodesAction({
      drama_id: DRAMA_ID,
      ids: [EPISODE_ID, '33333333-3333-4333-8333-333333333333'],
    });

    expect(reorderEpisodesMock).toHaveBeenCalledWith(
      manager,
      DRAMA_ID,
      [EPISODE_ID, '33333333-3333-4333-8333-333333333333']
    );
    expect(result).toEqual({ ok: true, data: { episodesReordered: 2 } });
  });
});

describe('renumberEpisodesAction', () => {
  it('forwards the drama id and reports modified episodes', async () => {
    renumberEpisodesMock.mockResolvedValue({ ok: true, episodesModified: 4 });

    const result = await renumberEpisodesAction({ drama_id: DRAMA_ID });

    expect(renumberEpisodesMock).toHaveBeenCalledWith(manager, DRAMA_ID);
    expect(result).toEqual({ ok: true, data: { episodesModified: 4 } });
  });
});

describe('publishEpisodeAction', () => {
  it('publishes an episode and returns updated status', async () => {
    updatePublicationMock.mockResolvedValue({
      ok: true,
      results: [{
        id: EPISODE_ID,
        status: 'succeeded',
        publicationStatus: 'published',
        publiclyAvailable: true,
      }],
    });

    const result = await publishEpisodeAction({ id: EPISODE_ID });

    expect(updatePublicationMock).toHaveBeenCalledWith(manager, {
      contentType: 'episode',
      action: 'publish',
      ids: [EPISODE_ID],
    });
    expect(result).toEqual({
      ok: true,
      data: { id: EPISODE_ID, publicationStatus: 'published', publiclyAvailable: true },
    });
  });

  it('refuses an actor without episode.manage', async () => {
    resolveActorMock.mockResolvedValue({ ...manager, permissions: [] });

    const result = await publishEpisodeAction({ id: EPISODE_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('forbidden');
    }
    expect(updatePublicationMock).not.toHaveBeenCalled();
  });

  it('returns error when publication fails', async () => {
    updatePublicationMock.mockResolvedValue({
      ok: true,
      results: [{
        id: EPISODE_ID,
        status: 'failed',
        message: 'Episode has no video source.',
      }],
    });

    const result = await publishEpisodeAction({ id: EPISODE_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Episode has no video source.');
    }
  });
});

describe('unpublishEpisodeAction', () => {
  it('unpublishes an episode and returns updated status', async () => {
    updatePublicationMock.mockResolvedValue({
      ok: true,
      results: [{
        id: EPISODE_ID,
        status: 'succeeded',
        publicationStatus: 'unpublished',
        publiclyAvailable: false,
      }],
    });

    const result = await unpublishEpisodeAction({ id: EPISODE_ID });

    expect(updatePublicationMock).toHaveBeenCalledWith(manager, {
      contentType: 'episode',
      action: 'unpublish',
      ids: [EPISODE_ID],
    });
    expect(result).toEqual({
      ok: true,
      data: { id: EPISODE_ID, publicationStatus: 'unpublished', publiclyAvailable: false },
    });
  });

  it('refuses an actor without episode.manage', async () => {
    resolveActorMock.mockResolvedValue({ ...manager, permissions: [] });

    const result = await unpublishEpisodeAction({ id: EPISODE_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('forbidden');
    }
    expect(updatePublicationMock).not.toHaveBeenCalled();
  });

  it('returns error when unpublication fails', async () => {
    updatePublicationMock.mockResolvedValue({
      ok: true,
      results: [{
        id: EPISODE_ID,
        status: 'failed',
        message: 'Episode is already unpublished.',
      }],
    });

    const result = await unpublishEpisodeAction({ id: EPISODE_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Episode is already unpublished.');
    }
  });
});
