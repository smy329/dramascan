import { describe, expect, it } from 'vitest';

import {
  buildFlatConversionPlan,
  buildRestoreSnapshotPlan,
  buildSeasonConversionPlan,
  buildSnapshotPayload,
  computeStructureFingerprint,
  defaultDistribution,
  normalizeDistribution,
  orderSeasonStructure,
  parseSnapshotPayload,
  type ConversionEpisodeState,
  type ConversionSeasonState,
  type ConversionStructureState,
} from '@/modules/content/conversion';
import { ValidationError } from '@/platform/errors';

function season(
  id: string,
  overrides: Partial<ConversionSeasonState> = {}
): ConversionSeasonState {
  return {
    id,
    title: `Season ${id}`,
    position: null,
    publicationStatus: null,
    createdAt: `2026-01-01T00:00:${id.padStart(2, '0')}Z`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function episode(
  id: string,
  overrides: Partial<ConversionEpisodeState> = {}
): ConversionEpisodeState {
  return {
    id,
    title: `Episode ${id}`,
    seasonId: null,
    episodeNumber: null,
    position: null,
    createdAt: `2026-01-01T00:00:${id.padStart(2, '0')}Z`,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function state(
  overrides: Partial<ConversionStructureState> = {}
): ConversionStructureState {
  return {
    dramaId: '11111111-1111-7111-8111-111111111111',
    structureType: 'season_based',
    seasons: [],
    episodes: [],
    ...overrides,
  };
}

describe('orderSeasonStructure', () => {
  it('orders seasons by position and episodes by position, number, created_at, id', () => {
    const seasons = [
      season('02', { position: 1 }),
      season('01', { position: 0 }),
      season('03', { position: null }),
    ];
    const episodes = [
      episode('05', { seasonId: '01', position: 1, episodeNumber: 1 }),
      episode('04', { seasonId: '01', position: 0, episodeNumber: 2 }),
      episode('06', { seasonId: '02', position: null, episodeNumber: 1 }),
      episode('07', { seasonId: null, position: 0, episodeNumber: 1 }),
    ];

    const ordered = orderSeasonStructure(seasons, episodes);

    expect(ordered.seasons.map(row => row.id)).toEqual(['01', '02', '03']);
    expect(ordered.episodes.map(row => row.id)).toEqual(['04', '05', '06', '07']);
  });

  it('sorts a null position after a numbered position and a null number last', () => {
    const episodes = [
      episode('a', { position: 0, episodeNumber: null }),
      episode('b', { position: null, episodeNumber: 1 }),
      episode('c', { position: 0, episodeNumber: 2 }),
    ];

    expect(orderSeasonStructure([], episodes).episodes.map(row => row.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });
});

describe('computeStructureFingerprint', () => {
  it('is deterministic and independent of input array order', () => {
    const first = state({
      seasons: [season('01'), season('02')],
      episodes: [episode('e1'), episode('e2')],
    });
    const second = state({
      seasons: [season('02'), season('01')],
      episodes: [episode('e2'), episode('e1')],
    });

    expect(computeStructureFingerprint(first)).toBe(computeStructureFingerprint(second));
  });

  it('changes when structure-relevant fields change', () => {
    const base = state({
      structureType: 'flat',
      seasons: [season('01', { position: 0 })],
      episodes: [episode('e1', { seasonId: '01', episodeNumber: 1, position: 0 })],
    });

    const renumbered = state({
      ...base,
      episodes: [episode('e1', { seasonId: '01', episodeNumber: 2, position: 0 })],
    });
    const reassigned = state({
      ...base,
      episodes: [episode('e1', { seasonId: null, episodeNumber: 1, position: 0 })],
    });

    expect(computeStructureFingerprint(renumbered)).not.toBe(computeStructureFingerprint(base));
    expect(computeStructureFingerprint(reassigned)).not.toBe(computeStructureFingerprint(base));
  });

  it('ignores episode titles because conversion never changes them', () => {
    const base = state({
      episodes: [episode('e1', { title: 'Original' })],
    });
    const renamed = state({
      episodes: [episode('e1', { title: 'Renamed' })],
    });

    expect(computeStructureFingerprint(base)).toBe(computeStructureFingerprint(renamed));
  });
});

describe('normalizeDistribution', () => {
  const episodes = [
    episode('e1', { position: 0, episodeNumber: 1 }),
    episode('e2', { position: 1, episodeNumber: 2 }),
  ];

  it('defaults to one Season 1 with every episode', () => {
    const normalized = normalizeDistribution(undefined, episodes);

    expect(normalized.seasons).toEqual([{ key: 'season-1', title: 'Season 1', position: 0 }]);
    expect([...normalized.assignments.entries()].sort()).toEqual([
      ['e1', 'season-1'],
      ['e2', 'season-1'],
    ]);
  });

  it('accepts a complete two-season map', () => {
    const normalized = normalizeDistribution(
      {
        seasons: [
          { key: 's1', title: 'Season 1', position: 0 },
          { key: 's2', title: 'Season 2', position: 1 },
        ],
        assignments: [
          { episodeId: 'e1', seasonKey: 's1' },
          { episodeId: 'e2', seasonKey: 's2' },
        ],
      },
      episodes
    );

    expect(normalized.assignments.get('e2')).toBe('s2');
  });

  it('rejects an unassigned episode', () => {
    expect(() =>
      normalizeDistribution(
        {
          seasons: [{ key: 's1', title: 'Season 1' }],
          assignments: [{ episodeId: 'e1', seasonKey: 's1' }],
        },
        episodes
      )
    ).toThrow(ValidationError);
  });

  it('rejects a duplicate assignment', () => {
    expect(() =>
      normalizeDistribution(
        {
          seasons: [{ key: 's1', title: 'Season 1' }],
          assignments: [
            { episodeId: 'e1', seasonKey: 's1' },
            { episodeId: 'e1', seasonKey: 's1' },
            { episodeId: 'e2', seasonKey: 's1' },
          ],
        },
        episodes
      )
    ).toThrow(ValidationError);
  });

  it('rejects an unknown episode, unknown season key, duplicate key, and duplicate position', () => {
    const base = {
      seasons: [{ key: 's1', title: 'Season 1' }],
      assignments: episodes.map(row => ({ episodeId: row.id, seasonKey: 's1' })),
    };

    expect(() =>
      normalizeDistribution(
        {
          ...base,
          assignments: [...base.assignments, { episodeId: 'missing', seasonKey: 's1' }],
        },
        episodes
      )
    ).toThrow(ValidationError);

    expect(() =>
      normalizeDistribution(
        {
          ...base,
          assignments: episodes.map(row => ({ episodeId: row.id, seasonKey: 'nope' })),
        },
        episodes
      )
    ).toThrow(ValidationError);

    expect(() =>
      normalizeDistribution(
        {
          seasons: [
            { key: 's1', title: 'Season 1', position: 0 },
            { key: 's1', title: 'Season 1 again', position: 1 },
          ],
          assignments: episodes.map(row => ({ episodeId: row.id, seasonKey: 's1' })),
        },
        episodes
      )
    ).toThrow(ValidationError);

    expect(() =>
      normalizeDistribution(
        {
          seasons: [
            { key: 's1', title: 'Season 1', position: 0 },
            { key: 's2', title: 'Season 2', position: 0 },
          ],
          assignments: episodes.map(row => ({ episodeId: row.id, seasonKey: 's1' })),
        },
        episodes
      )
    ).toThrow(ValidationError);
  });
});

describe('buildFlatConversionPlan', () => {
  it('renumbers sequentially and flattens seasons in order', () => {
    const plan = buildFlatConversionPlan(
      state({
        structureType: 'season_based',
        seasons: [season('s1', { position: 0 }), season('s2', { position: 1 })],
        episodes: [
          episode('e3', { seasonId: 's2', position: 0, episodeNumber: 1 }),
          episode('e1', { seasonId: 's1', position: 0, episodeNumber: 1 }),
          episode('e2', { seasonId: 's1', position: 1, episodeNumber: 2 }),
        ],
      })
    );

    expect(plan.episodes.map(row => [row.id, row.toEpisodeNumber, row.toPosition])).toEqual([
      ['e1', 1, 0],
      ['e2', 2, 1],
      ['e3', 3, 2],
    ]);
    expect(plan.episodes.every(row => row.toSeasonKey === null)).toBe(true);
    expect(plan.counts).toEqual({ activeEpisodes: 3, seasonsAffected: 2, seasonsCreated: 0 });
  });

  it('appends seasonless episodes and warns', () => {
    const plan = buildFlatConversionPlan(
      state({
        structureType: 'season_based',
        seasons: [season('s1', { position: 0 })],
        episodes: [
          episode('e2', { seasonId: null, position: 0 }),
          episode('e1', { seasonId: 's1', position: 0 }),
        ],
      })
    );

    expect(plan.episodes.map(row => row.id)).toEqual(['e1', 'e2']);
    expect(plan.warnings.join(' ')).toContain('seasonless');
  });
});

describe('buildSeasonConversionPlan', () => {
  it('creates the requested seasons and preserves episode numbers', () => {
    const plan = buildSeasonConversionPlan(
      state({
        structureType: 'flat',
        episodes: [
          episode('e1', { position: 0, episodeNumber: 4 }),
          episode('e2', { position: 1, episodeNumber: 5 }),
        ],
      }),
      {
        seasons: [{ key: 's1', title: 'Season 1', position: 0 }],
        assignments: [
          { episodeId: 'e1', seasonKey: 's1' },
          { episodeId: 'e2', seasonKey: 's1' },
        ],
      }
    );

    expect(plan.seasons).toEqual([
      { key: 's1', id: null, title: 'Season 1', position: 0, episodeCount: 2 },
    ]);
    expect(plan.episodes.map(row => row.toEpisodeNumber)).toEqual([4, 5]);
    expect(plan.counts.seasonsCreated).toBe(1);
  });
});

describe('snapshot payload', () => {
  it('round-trips an ordered payload', () => {
    const seasonOne = '11111111-1111-7111-8111-111111111111';
    const seasonTwo = '22222222-2222-7222-8222-222222222222';
    const episodeOne = '33333333-3333-7333-8333-333333333333';
    const episodeTwo = '44444444-4444-7444-8444-444444444444';

    const seasons = [
      season(seasonTwo, { position: 1 }),
      season(seasonOne, { position: 0 }),
    ];
    const episodes = [
      episode(episodeTwo, { seasonId: seasonOne, episodeNumber: 2, position: 1 }),
      episode(episodeOne, { seasonId: seasonOne, episodeNumber: 1, position: 0 }),
    ];

    const payload = buildSnapshotPayload(seasons, episodes);
    const parsed = parseSnapshotPayload(payload);

    expect(parsed.seasons.map(row => row.id)).toEqual([seasonOne, seasonTwo]);
    expect(parsed.episodes.map(row => row.id)).toEqual([episodeOne, episodeTwo]);
  });

  it('rejects duplicate ids and unknown season references', () => {
    const duplicateSeason = {
      seasons: [
        {
          id: '11111111-1111-7111-8111-111111111111',
          title: 'Season 1',
          position: 0,
          publication_status: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
        {
          id: '11111111-1111-7111-8111-111111111111',
          title: 'Season 1 duplicate',
          position: 1,
          publication_status: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      episodes: [],
    };

    expect(() => parseSnapshotPayload(duplicateSeason)).toThrow(ValidationError);

    const unknownSeason = {
      seasons: [],
      episodes: [
        {
          id: '22222222-2222-7222-8222-222222222222',
          season_id: '33333333-3333-7333-8333-333333333333',
          episode_number: 1,
          position: 0,
          title: 'Episode 1',
        },
      ],
    };

    expect(() => parseSnapshotPayload(unknownSeason)).toThrow(ValidationError);
  });
});

describe('buildRestoreSnapshotPlan', () => {
  it('builds the exact snapshot structure and marks it restorable', () => {
    const payload = buildSnapshotPayload(
      [season('s1', { position: 0, title: 'Season One' })],
      [episode('e1', { seasonId: 's1', episodeNumber: 7, position: 3, title: 'E1' })]
    );
    const current = state({
      structureType: 'flat',
      episodes: [episode('e1', { seasonId: null, episodeNumber: 1, position: 0 })],
    });

    const plan = buildRestoreSnapshotPlan(
      current,
      {
        id: 'snapshot-1',
        status: 'available',
        createdAt: '2026-01-01T00:00:00.000Z',
        payload,
      },
      true
    );

    expect(plan.strategy).toBe('restore_snapshot');
    expect(plan.snapshot?.restorable).toBe(true);
    expect(plan.episodes[0]).toMatchObject({
      toSeasonKey: 's1',
      toEpisodeNumber: 7,
      toPosition: 3,
      fromEpisodeNumber: 1,
    });
  });
});

describe('defaultDistribution', () => {
  it('uses one Season 1 for every episode', () => {
    const distribution = defaultDistribution([episode('e1'), episode('e2')]);

    expect(distribution.seasons).toEqual([{ key: 'season-1', title: 'Season 1', position: 0 }]);
    expect(distribution.assignments).toHaveLength(2);
  });
});
