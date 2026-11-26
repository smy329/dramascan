import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// The notification module imports the database client for its default
// executor. This suite hands the service a fake transaction, so no connection
// is opened.
vi.mock('@/db/client', () => ({ db: {} }));

import { deliverToAudience } from '@/modules/notifications/audience';

/**
 * The single-connection rule for the audience delivery (CONVENTIONS §5.6).
 *
 * A Drizzle transaction is bound to one PostgreSQL connection and may run one
 * query at a time. The audience delivery reads the whole audience in three
 * queries — the notifications that already exist, the preferences, and the
 * push subscriptions — and the helper receives a transaction handle, so those
 * three reads have to run one after the other.
 *
 * The fake executor below records how many queries are in flight at the same
 * time. A delivery that starts its reads concurrently is visible as a maximum
 * in-flight count above one.
 */

type FakeRow = Record<string, unknown>;

type FakeThenable<T> = {
  then: <TResult1 = T, TResult2 = never>(
    _onfulfilled?: ((_value: T) => TResult1 | PromiseLike<TResult1>) | null,
    _onrejected?: ((_reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => PromiseLike<TResult1 | TResult2>;
};

type FakeQueryBuilder = FakeThenable<FakeRow[]> & {
  from: () => FakeQueryBuilder;
  where: () => FakeQueryBuilder;
  limit: () => FakeQueryBuilder;
};

type FakeInsertBuilder = {
  values: () => FakeInsertBuilder;
  onConflictDoNothing: () => FakeInsertBuilder;
  returning: () => FakeThenable<FakeRow[]>;
};

type Probe = {
  executor: unknown;
  maxInFlight: () => number;
};

function createProbe(): Probe {
  let inFlight = 0;
  let peak = 0;
  let notificationId = 0;

  function enter(): void {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
  }

  function leave(): void {
    inFlight -= 1;
  }

  const builder: FakeQueryBuilder = {
    from: () => builder,
    where: () => builder,
    limit: () => builder,
    then(onfulfilled, onrejected) {
      enter();

      // The query resolves on a later tick, so a helper that starts its reads
      // concurrently has them overlap.
      return new Promise<FakeRow[]>(resolve =>
        setTimeout(() => {
          leave();
          resolve([]);
        }, 5)
      ).then(onfulfilled, onrejected);
    },
  };

  const insertBuilder: FakeInsertBuilder = {
    values: () => insertBuilder,
    onConflictDoNothing: () => insertBuilder,
    returning() {
      enter();

      notificationId += 1;
      const row = { id: `notification-${notificationId}` };

      return {
        then(onfulfilled, onrejected) {
          return new Promise<FakeRow[]>(resolve =>
            setTimeout(() => {
              leave();
              resolve([row]);
            }, 5)
          ).then(onfulfilled, onrejected);
        },
      };
    },
  };

  const executor = {
    select: () => builder,
    selectDistinct: () => builder,
    insert: () => insertBuilder,
  };

  return { executor, maxInFlight: () => peak };
}

describe('the audience delivery on a transaction', () => {
  it('reads the audience one query at a time', async () => {
    const probe = createProbe();

    await deliverToAudience({
      eventType: 'new_drama',
      contentId: 'drama-1',
      userIds: ['user-1', 'user-2'],
      message: {
        title: 'New drama',
        content: 'A new drama is available.',
        contentType: 'drama',
        link: '/drama/drama-1',
      },
      // The fake executor stands in for the transaction handle. The assertion
      // is about the number of queries in flight, not about the database.
      executor: probe.executor as never,
    });

    expect(probe.maxInFlight()).toBe(1);
  });

  it('notifies every eligible viewer', async () => {
    const probe = createProbe();

    const result = await deliverToAudience({
      eventType: 'new_drama',
      contentId: 'drama-2',
      userIds: ['user-1', 'user-2'],
      message: {
        title: 'New drama',
        content: 'A new drama is available.',
        contentType: 'drama',
        link: '/drama/drama-2',
      },
      executor: probe.executor as never,
    });

    expect(result.notified).toBe(2);
  });
});
