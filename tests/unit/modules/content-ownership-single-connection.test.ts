import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// The ownership modules import the database client for their type definitions.
// This suite pins the query contract with a fake transaction, so no connection
// is opened.
vi.mock('@/db/client', () => ({ db: {} }));

import { countContentReferences as countAnalyticsReferences } from '@/modules/analytics/content-ownership';
import { countContentReferences as countNotificationReferences } from '@/modules/notifications/content-ownership';
import { countContentReferences as countReviewReferences } from '@/modules/reviews/content-ownership';
import {
  countContentReferences as countUserReferences,
  countEpisodeImpact,
  countPurgeImpact as countUserPurgeImpact,
} from '@/modules/users/content-ownership';

/**
 * A transaction may only run one query at a time.
 *
 * A Drizzle transaction is bound to a single PostgreSQL connection. Running two
 * queries on that connection at the same time is deprecated by the driver
 * (`Calling client.query() when the client is already executing a query`) and
 * is removed in pg 9. The count helpers are called from inside the Trash
 * transaction, so they have to await their queries one after the other.
 *
 * The fake transaction below records how many queries are in flight at the
 * same time. A helper that starts its queries concurrently is visible as a
 * maximum in-flight count above one.
 */

type CountRow = { total: number };

type FakeQueryBuilder = {
  from: () => FakeQueryBuilder;
  where: () => FakeQueryBuilder;
  then: PromiseLike<CountRow[]>['then'];
};

type FakeTransaction = {
  select: () => FakeQueryBuilder;
};

type Probe = {
  tx: FakeTransaction;
  maxInFlight: () => number;
};

function createProbe(): Probe {
  let inFlight = 0;
  let peak = 0;

  const builder: FakeQueryBuilder = {
    from: () => builder,
    where: () => builder,
    then(onfulfilled, onrejected) {
      inFlight += 1;
      peak = Math.max(peak, inFlight);

      // The query resolves on a later tick, so a helper that starts its
      // queries concurrently has them overlap.
      return new Promise<CountRow[]>(resolve =>
        setTimeout(() => {
          inFlight -= 1;
          resolve([{ total: 0 }]);
        }, 5)
      ).then(onfulfilled, onrejected);
    },
  };

  const tx: FakeTransaction = {
    select: () => builder,
  };

  return { tx, maxInFlight: () => peak };
}

describe('content ownership counts on a transaction', () => {
  it('counts the user references without running two queries at once', async () => {
    const probe = createProbe();

    await countUserReferences(probe.tx as never, 'drama', 'drama-1');

    expect(probe.maxInFlight()).toBe(1);
  });

  it('counts the purge impact of the user references without overlapping queries', async () => {
    const probe = createProbe();

    await countUserPurgeImpact(probe.tx as never, 'drama', 'drama-1', ['episode-1']);

    expect(probe.maxInFlight()).toBe(1);
  });

  it('counts the episode impact without running two queries at once', async () => {
    const probe = createProbe();

    await countEpisodeImpact(probe.tx as never, ['episode-1']);

    expect(probe.maxInFlight()).toBe(1);
  });

  it('counts the ratings and reviews without running two queries at once', async () => {
    const probe = createProbe();

    await countReviewReferences(probe.tx as never, 'drama-1');

    expect(probe.maxInFlight()).toBe(1);
  });

  it('counts the notifications without running two queries at once', async () => {
    const probe = createProbe();

    await countNotificationReferences(probe.tx as never, 'drama-1');

    expect(probe.maxInFlight()).toBe(1);
  });

  it('counts the analytics rows without running two queries at once', async () => {
    const probe = createProbe();

    await countAnalyticsReferences(probe.tx as never, 'drama-1');

    expect(probe.maxInFlight()).toBe(1);
  });
});
