/**
 * Application and API rate limiting module.
 *
 * Provides PostgreSQL-backed rate limiting for authentication endpoints,
 * report submission, reviews, and sensitive admin operations. Includes
 * appropriate limits by identity and request context. No Redis is used.
 *
 * Do not implement: Redis-backed rate limiting, persistent worker monitoring,
 * or queue priorities.
 */

import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { requirePermission, type ActorContext } from '@/modules/authorization';

import { system_settings } from './schema';
import { admin_audit_log } from './schema';

/** Rate limit status. */
export type RateLimitStatus = 'ok' | 'rate-limited' | 'blocked';

/** Rate limit result. */
export interface RateLimitResult {
  status: RateLimitStatus;
  remaining: number;
  resetTime: string;
  limit: number;
}

/** Rate limit configuration by endpoint. */
export interface RateLimitConfig {
  /** Requests per window */
  requests: number;
  /** Window in milliseconds */
  windowMs: number;
  /** Whether the endpoint is authenticated-only */
  authenticatedOnly: boolean;
  /** Identifier function (e.g., by IP or user ID) */
  identifier: 'ip' | 'user' | 'session';
}

/** Default rate limit configurations. */
export const DEFAULT_RATE_LIMIT_CONFIGS: Record<string, RateLimitConfig> = {
  /** Authentication endpoints: 5 requests per 15 minutes */
  auth: {
    requests: 5,
    windowMs: 15 * 60 * 1000,
    authenticatedOnly: false,
    identifier: 'ip',
  },
  /** Report submission: 10 requests per hour */
  report: {
    requests: 10,
    windowMs: 60 * 60 * 1000,
    authenticatedOnly: true,
    identifier: 'user',
  },
  /** Review submission: 20 requests per hour */
  review: {
    requests: 20,
    windowMs: 60 * 60 * 1000,
    authenticatedOnly: true,
    identifier: 'user',
  },
  /** Admin operations: 30 requests per hour */
  admin: {
    requests: 30,
    windowMs: 60 * 60 * 1000,
    authenticatedOnly: true,
    identifier: 'user',
  },
  /** API general: 100 requests per 10 minutes */
  api: {
    requests: 100,
    windowMs: 10 * 60 * 1000,
    authenticatedOnly: false,
    identifier: 'ip',
  },
};

/** Get rate limit configuration for an endpoint. */
export function getRateLimitConfig(endpoint: string): RateLimitConfig {
  return DEFAULT_RATE_LIMIT_CONFIGS[endpoint] || DEFAULT_RATE_LIMIT_CONFIGS.api;
}

/** Check rate limit for a request. */
export async function checkRateLimit(
  endpoint: string,
  identifier: string,
  performedBy: string
): Promise<RateLimitResult> {
  const config = getRateLimitConfig(endpoint);
  const now = new Date().getTime();
  const windowStart = now - config.windowMs;

  // Query the database for requests within this window
  const [row] = await db
    .select({ count: sql`count(*)` })
    .from(system_settings) // Using system_settings as temporary rate limit store
    .where(
      sql`${system_settings.key}.like('rate_limit_%') AND JSON_EXTRACT(${system_settings.value}, '$.identifier') = ${identifier} AND JSON_EXTRACT(${system_settings.value}, '$.endpoint') = ${endpoint}`
    );

  const requestCount = row ? row.count : 0;

  const isRateLimited = requestCount >= config.requests;

  return {
    status: isRateLimited ? 'rate-limited' : 'ok',
    remaining: Math.max(0, config.requests - requestCount - 1),
    resetTime: new Date(now - (now % config.windowMs) + config.windowMs).toISOString(),
    limit: config.requests,
  };
}

/** Record a rate limit hit. */
export async function recordRateLimitHit(
  endpoint: string,
  identifier: string,
  performedBy: string
): Promise<RateLimitResult> {
  const config = getRateLimitConfig(endpoint);
  const now = new Date().getTime();
  const key = `rate_limit_${crypto.randomUUID()}`;

  await db
    .insert(system_settings)
    .values({
      key,
      value: JSON.stringify({
        id: key,
        endpoint,
        identifier,
        timestamp: now,
        performedBy,
      }),
      description: 'Rate limit tracking',
      updated_by: performedBy,
      updated_at: new Date(),
    })
    .onConflictDoUpdate{
      target: system_settings.key,
      set: {
        value: JSON.stringify({
          id: key,
          endpoint,
          identifier,
          timestamp: now,
          performedBy,
        }),
        description: 'Rate limit tracking',
        updated_by: performedBy,
        updated_at: new Date(),
      },
    };

  return checkRateLimit(endpoint, identifier, performedBy);
}

/** Get rate limit status for display. */
export function formatRateLimitStatus(result: RateLimitResult): string {
  if (result.status === 'ok') {
    return `OK - ${result.remaining} ${result.remaining === 1 ? 'request' : 'requests'} remaining until ${new Date(result.resetTime).toLocaleTimeString()}`;
  } else if (result.status === 'rate-limited') {
    return `Rate limited - try again at ${new Date(result.resetTime).toLocaleTimeString()}`;
  } else {
    return 'Blocked - contact administrator';
  }
}