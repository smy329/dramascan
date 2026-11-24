import 'server-only';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';

import { admin_audit_log } from './schema';

/**
 * Administrative audit trail.
 *
 * The audit trail answers operational questions: what changed, who changed it,
 * and when. It deliberately does **not** become a second copy of the data it
 * describes. A video-source replacement, for example, records that the source
 * was replaced and which hosts were involved, but never stores the URL: the
 * URL points at a third-party host, has different retention rules, and would
 * turn the audit table into an ungoverned copy of the content table.
 *
 * Values that look like URLs are therefore removed from the metadata before
 * the row is written, at any nesting depth.
 */

/** One administrative action worth recording. */
export type AdminAuditEventInput = {
  /** The administrator who performed the action, or `null` for a system action. */
  actorId: string | null;
  /** Canonical `resource.action` token, for example `episode.video_source.replaced`. */
  action: string;
  /** The type of the entity the action was performed on. */
  entityType: string;
  /**
   * The entity the action was performed on, or `null` when there is none.
   *
   * A global setting — the featured item, the hero rotation, the Trending
   * pins — is not a content row and has no identifier. Such an event is
   * recorded with `entityType = 'homepage_setting'` and no entity id.
   */
  entityId: string | null;
  /** Short human-readable description of what happened. */
  summary: string;
  /** Structured detail. URL-bearing values are stripped before writing. */
  metadata?: Record<string, unknown>;
};

/** A metadata key whose value is treated as a URL and therefore removed. */
const URL_LIKE_KEY = /(url|uri|href|source|src|link)/i;

/** A value that looks like an absolute URL. */
const URL_LIKE_VALUE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Remove URL-bearing values from audit metadata.
 *
 * The check is deliberately conservative: a key that mentions a URL, a
 * source, or a link is dropped whatever its value is, and any string value
 * that looks like an absolute URL is dropped wherever it appears. What
 * survives is the operational detail — counts, flags, host names — that makes
 * the record useful without copying the source.
 */
export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  const sanitize = (value: unknown, key: string): unknown => {
    if (typeof value === 'string') {
      return URL_LIKE_VALUE.test(value) ? undefined : value;
    }

    if (Array.isArray(value)) {
      return value
        .map(item => sanitize(item, key))
        .filter(item => item !== undefined);
    }

    if (value && typeof value === 'object') {
      const result: Record<string, unknown> = {};

      for (const [childKey, childValue] of Object.entries(value)) {
        const sanitized = sanitize(childValue, childKey);

        if (sanitized !== undefined) {
          result[childKey] = sanitized;
        }
      }

      return result;
    }

    return value;
  };

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (URL_LIKE_KEY.test(key)) {
      continue;
    }

    const sanitized = sanitize(value, key);

    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  }

  return result;
}

/**
 * Record one administrative action.
 *
 * @param input    What happened.
 * @param executor Transaction handle to run in; defaults to the pool.
 */
export async function recordAdminAuditEvent(
  input: AdminAuditEventInput,
  executor: DbExecutor = db
): Promise<void> {
  await executor.insert(admin_audit_log).values({
    actor_id: input.actorId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    summary: input.summary,
    metadata: sanitizeAuditMetadata(input.metadata),
  });
}
