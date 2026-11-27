import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// The delivery module imports the database client for its default executor.
// This suite compares constants, so no connection is opened.
vi.mock('@/db/client', () => ({ db: {} }));

import {
  DELIVERY_LEASE_SECONDS,
  DELIVERY_RETENTION_DAYS,
  MAX_DELIVERY_ATTEMPTS,
  MAX_PUSH_RETRY_ATTEMPTS,
  PUSH_RETRY_WINDOW_DAYS,
} from '@/modules/notifications/delivery';
import {
  DELIVERY_LEASE_SECONDS as COMMAND_DELIVERY_LEASE_SECONDS,
  DELIVERY_RETENTION_DAYS as COMMAND_DELIVERY_RETENTION_DAYS,
  MAX_DELIVERY_ATTEMPTS as COMMAND_MAX_DELIVERY_ATTEMPTS,
  MAX_PUSH_RETRY_ATTEMPTS as COMMAND_MAX_PUSH_RETRY_ATTEMPTS,
  PUSH_RETRY_WINDOW_DAYS as COMMAND_PUSH_RETRY_WINDOW_DAYS,
} from '../../../../scripts/notification-maintenance.mjs';

/**
 * The delivery limits of the application and of the maintenance command.
 *
 * The command is a short-lived `.mjs` script that mirrors the application's
 * delivery rules. Its SQL cannot call the application's service — the module
 * index pulls in the database client and the `server-only` marker, and the
 * command runs on plain Node without a build step — so the *numbers* are
 * shared instead of the code.
 *
 * A number that exists in only one of the two is a number the command and the
 * application disagree about: the command would retry a notification the
 * application would have abandoned, or keep a delivery record the application
 * would have removed.
 *
 * The shared file therefore holds the numbers, and both sides import it.
 */

const SHARED_FILE = 'src/modules/notifications/delivery-limits.ts';

describe('the delivery limits', () => {
  it('are the same numbers in the application and in the command', () => {
    expect(COMMAND_MAX_DELIVERY_ATTEMPTS).toBe(MAX_DELIVERY_ATTEMPTS);
    expect(COMMAND_MAX_PUSH_RETRY_ATTEMPTS).toBe(MAX_PUSH_RETRY_ATTEMPTS);
    expect(COMMAND_PUSH_RETRY_WINDOW_DAYS).toBe(PUSH_RETRY_WINDOW_DAYS);
    expect(COMMAND_DELIVERY_RETENTION_DAYS).toBe(DELIVERY_RETENTION_DAYS);
    expect(COMMAND_DELIVERY_LEASE_SECONDS).toBe(DELIVERY_LEASE_SECONDS);
  });

  it('live in one file that both sides import', () => {
    const delivery = readFileSync(
      join(process.cwd(), 'src/modules/notifications/delivery.ts'),
      'utf8'
    );
    const command = readFileSync(
      join(process.cwd(), 'scripts/notification-maintenance.mjs'),
      'utf8'
    );

    expect(delivery).toContain("from './delivery-limits'");
    expect(command).toContain(`from '../${SHARED_FILE}'`);
  });

  it('keep the documented values', () => {
    expect(MAX_DELIVERY_ATTEMPTS).toBe(10);
    expect(MAX_PUSH_RETRY_ATTEMPTS).toBe(3);
    expect(PUSH_RETRY_WINDOW_DAYS).toBe(7);
    expect(DELIVERY_RETENTION_DAYS).toBe(30);
    expect(DELIVERY_LEASE_SECONDS).toBe(300);
  });
});
