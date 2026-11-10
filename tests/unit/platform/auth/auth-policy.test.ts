import { describe, expect, it } from 'vitest';
import {
  bootstrapSuperAdmin,
  decideSessionCreation,
  decideSuperAdminPromotion,
  normalizeEmail,
  type SuperAdminBootstrapStore,
  type SuperAdminCandidate,
} from '@/platform/auth/auth-policy';

function candidate(overrides: Partial<SuperAdminCandidate> = {}): SuperAdminCandidate {
  return {
    id: 'user-1',
    email: 'Admin@Example.com',
    isSuperAdmin: false,
    isActive: true,
    deletedAt: null,
    ...overrides,
  };
}

type MemoryBootstrap = {
  users: Map<string, SuperAdminCandidate>;
  store: SuperAdminBootstrapStore;
  runExclusive: <T>(_work: (_store: SuperAdminBootstrapStore) => Promise<T>) => Promise<T>;
};

/**
 * In-memory store whose `runExclusive` serializes work with a promise chain,
 * mirroring the production advisory lock.
 */
function createMemoryBootstrap(seed: SuperAdminCandidate[]): MemoryBootstrap {
  const users = new Map(seed.map(user => [user.id, { ...user }]));

  const store: SuperAdminBootstrapStore = {
    async findCandidate(userId) {
      const user = users.get(userId);
      return user ? { ...user } : null;
    },
    async hasSuperAdmin() {
      return [...users.values()].some(user => user.isSuperAdmin);
    },
    async promote(userId) {
      const user = users.get(userId);
      if (user) {
        user.isSuperAdmin = true;
      }
    },
  };

  let tail: Promise<unknown> = Promise.resolve();

  const runExclusive = <T>(_work: (_store: SuperAdminBootstrapStore) => Promise<T>): Promise<T> => {
    const run = tail.then(() => _work(store));
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  return { users, store, runExclusive };
}

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Admin@Example.COM ')).toBe('admin@example.com');
  });
});

describe('decideSuperAdminPromotion', () => {
  it('does nothing when no SUPER_ADMIN_EMAIL is configured', () => {
    expect(decideSuperAdminPromotion(candidate(), null, false)).toBe('not-configured');
  });

  it('reports a missing user', () => {
    expect(decideSuperAdminPromotion(null, 'admin@example.com', false)).toBe('user-missing');
  });

  it('never demotes or re-promotes an existing Super Admin', () => {
    expect(
      decideSuperAdminPromotion(candidate({ isSuperAdmin: true }), 'admin@example.com', false)
    ).toBe('already-super-admin');
  });

  it('refuses deactivated users', () => {
    expect(
      decideSuperAdminPromotion(candidate({ isActive: false }), 'admin@example.com', false)
    ).toBe('inactive');
  });

  it('refuses soft-deleted users', () => {
    expect(
      decideSuperAdminPromotion(candidate({ deletedAt: new Date() }), 'admin@example.com', false)
    ).toBe('deleted');
  });

  it('matches the configured email case-insensitively', () => {
    expect(
      decideSuperAdminPromotion(candidate({ email: 'ADMIN@example.COM' }), 'admin@example.com', false)
    ).toBe('promoted');
  });

  it('refuses a non-matching email', () => {
    expect(decideSuperAdminPromotion(candidate(), 'someone-else@example.com', false)).toBe(
      'email-mismatch'
    );
  });

  it('does not promote when a Super Admin already exists', () => {
    expect(decideSuperAdminPromotion(candidate(), 'admin@example.com', true)).toBe(
      'super-admin-exists'
    );
  });
});

describe('bootstrapSuperAdmin', () => {
  it('skips the store entirely when bootstrap is not configured', async () => {
    createMemoryBootstrap([candidate()]);
    let called = false;

    const result = await bootstrapSuperAdmin('user-1', {
      configuredEmail: null,
      runExclusive: work => {
        called = true;
        return work(createMemoryBootstrap([]).store);
      },
    });

    expect(result).toEqual({ promoted: false, reason: 'not-configured' });
    expect(called).toBe(false);
  });

  it('promotes the matching user', async () => {
    const { users, runExclusive } = createMemoryBootstrap([candidate()]);

    const result = await bootstrapSuperAdmin('user-1', {
      configuredEmail: 'admin@example.com',
      runExclusive,
    });

    expect(result).toEqual({ promoted: true, reason: 'promoted' });
    expect(users.get('user-1')?.isSuperAdmin).toBe(true);
  });

  it('does not promote when another Super Admin exists', async () => {
    const { users, runExclusive } = createMemoryBootstrap([
      candidate({ id: 'existing', email: 'existing@example.com', isSuperAdmin: true }),
      candidate({ id: 'user-1', email: 'admin@example.com' }),
    ]);

    const result = await bootstrapSuperAdmin('user-1', {
      configuredEmail: 'admin@example.com',
      runExclusive,
    });

    expect(result).toEqual({ promoted: false, reason: 'super-admin-exists' });
    expect(users.get('user-1')?.isSuperAdmin).toBe(false);
  });

  it('does not query for a Super Admin when the candidate cannot match', async () => {
    const { store } = createMemoryBootstrap([candidate()]);
    let hasSuperAdminCalls = 0;
    const countingStore: SuperAdminBootstrapStore = {
      findCandidate: store.findCandidate,
      hasSuperAdmin: async () => {
        hasSuperAdminCalls += 1;
        return false;
      },
      promote: store.promote,
    };

    const result = await bootstrapSuperAdmin('user-1', {
      configuredEmail: 'different@example.com',
      runExclusive: work => work(countingStore),
    });

    expect(result).toEqual({ promoted: false, reason: 'email-mismatch' });
    expect(hasSuperAdminCalls).toBe(0);
  });

  it('promotes exactly one user under concurrent first sign-ins', async () => {
    const { users, runExclusive } = createMemoryBootstrap([
      candidate({ id: 'user-a', email: 'admin@example.com' }),
      candidate({ id: 'user-b', email: 'ADMIN@EXAMPLE.COM' }),
    ]);

    const deps = { configuredEmail: 'admin@example.com', runExclusive };
    const results = await Promise.all([
      bootstrapSuperAdmin('user-a', deps),
      bootstrapSuperAdmin('user-b', deps),
    ]);

    expect(results.filter(result => result.promoted)).toHaveLength(1);
    expect([...users.values()].filter(user => user.isSuperAdmin)).toHaveLength(1);
  });
});

describe('decideSessionCreation', () => {
  it('denies a missing user', () => {
    expect(decideSessionCreation(null)).toBe('user-missing');
  });

  it('denies a deactivated user', () => {
    expect(decideSessionCreation({ isActive: false, deletedAt: null })).toBe('inactive');
  });

  it('denies a soft-deleted user', () => {
    expect(decideSessionCreation({ isActive: true, deletedAt: new Date() })).toBe('deleted');
  });

  it('allows an active user', () => {
    expect(decideSessionCreation({ isActive: true, deletedAt: null })).toBe('allowed');
  });
});
