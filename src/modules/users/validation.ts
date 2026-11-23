/**
 * Admin user-listing input validation.
 *
 * The Zod schema lives here, not in `lib/contracts`, because a module may not
 * import `lib` (`ARCHITECTURE.md` §7) and this schema is the module's own
 * input boundary. The shared URL contract lives in `src/lib/contracts/table.ts`
 * and is kept in step by a unit test.
 *
 * Every field normalizes instead of failing: an admin page is a navigable URL,
 * and a hand-edited or shared link must never produce an error page. The
 * sortable-column allowlist is still enforced, so an unknown column can never
 * reach SQL.
 */

import { z } from 'zod';

import type { UserAccountSortField, UserAccountStatus } from '@/modules/auth';
import { ValidationError } from '@/platform/errors';

export const ADMIN_USER_STATUSES = ['active', 'deactivated', 'deleted'] as const satisfies readonly UserAccountStatus[];

export type AdminUserStatus = UserAccountStatus;

export const ADMIN_USER_SORT_FIELDS = [
  'name',
  'email',
  'createdAt',
  'updatedAt',
] as const satisfies readonly UserAccountSortField[];

export type AdminUserSortField = UserAccountSortField;

/** `CONVENTIONS.md` §6.3: page-based paging, default 20 rows, maximum 100. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

const SORT_FIELDS = new Set<string>(ADMIN_USER_SORT_FIELDS);

export type AdminUsersQuery = {
  page: number;
  pageSize: number;
  sortBy: AdminUserSortField;
  sortDirection: 'asc' | 'desc';
  search: string;
  status: AdminUserStatus | null;
  superAdmin: boolean | null;
};

/** Build a sort token from a column and a direction. */
export function formatSortToken(
  sortBy: AdminUserSortField,
  sortDirection: 'asc' | 'desc'
): string {
  return sortDirection === 'desc' ? `-${sortBy}` : sortBy;
}

/**
 * Resolve a sort token to a column and a direction.
 *
 * The token may be a comma separated list (`CONVENTIONS.md` §6.4); the first
 * recognized column wins. An unrecognized column falls back to the default
 * sort rather than reaching the query.
 */
export function parseSortToken(token: string): {
  sortBy: AdminUserSortField;
  sortDirection: 'asc' | 'desc';
} {
  const segments = token.split(',');

  for (const segment of segments) {
    const trimmed = segment.trim();

    if (trimmed.length === 0) {
      continue;
    }

    const descending = trimmed.startsWith('-');
    const column = descending ? trimmed.slice(1) : trimmed;

    if (SORT_FIELDS.has(column)) {
      return {
        sortBy: column as AdminUserSortField,
        sortDirection: descending ? 'desc' : 'asc',
      };
    }
  }

  return { sortBy: 'createdAt', sortDirection: 'desc' };
}

const superAdminFilterSchema = z
  .enum(['yes', 'no'])
  .optional()
  .catch(undefined)
  .transform(value => {
    if (value === undefined) {
      return null;
    }
    return value === 'yes';
  });

export const adminUsersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).catch(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).catch(DEFAULT_PAGE_SIZE),
    sort: z.string().trim().max(32).catch('-createdAt'),
    q: z.string().trim().max(200).catch(''),
    status: z.enum(ADMIN_USER_STATUSES).optional().catch(undefined),
    superAdmin: superAdminFilterSchema,
  })
  .transform(value => ({
    page: value.page,
    pageSize: value.pageSize,
    ...parseSortToken(value.sort),
    search: value.q,
    status: value.status ?? null,
    superAdmin: value.superAdmin,
  }));

/** Parse untrusted query input into a validated admin users query. */
export function parseAdminUsersQuery(input: unknown): AdminUsersQuery {
  return adminUsersQuerySchema.parse(input);
}

/**
 * Playback-progress input.
 *
 * The browser reports where the viewer is: the position it observed, the
 * duration of the media, and the moment it observed it. The moment matters:
 * two tabs or two devices can report at the same time, and the update that was
 * observed earlier must never overwrite the newer one.
 */

/** The longest media the progress write accepts, in seconds (24 hours). */
export const MAX_PLAYBACK_DURATION_SECONDS = 86_400;

/** An ISO 8601 timestamp, parsed into a `Date`. */
const watchedAtSchema = z
  .string()
  .trim()
  .min(1, 'The observation time is required.')
  .refine(value => !Number.isNaN(Date.parse(value)), 'The observation time must be an ISO 8601 timestamp.')
  .transform(value => new Date(value));

export const playbackProgressInputSchema = z
  .strictObject({
    /** The episode the viewer is watching. */
    episodeId: z.string().uuid(),
    /** The playback position, in seconds. */
    positionSeconds: z
      .number()
      .min(0, 'The position cannot be negative.')
      .max(MAX_PLAYBACK_DURATION_SECONDS, 'The position is out of range.'),
    /** The duration of the media, in seconds. Zero when it is not known yet. */
    durationSeconds: z
      .number()
      .min(0, 'The duration cannot be negative.')
      .max(MAX_PLAYBACK_DURATION_SECONDS, 'The duration is out of range.'),
    /** The moment the browser observed the position. */
    watchedAt: watchedAtSchema,
  })
  .superRefine((value, ctx) => {
    if (value.durationSeconds > 0 && value.positionSeconds > value.durationSeconds + 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['positionSeconds'],
        message: 'The position cannot be beyond the duration of the episode.',
      });
    }
  });

/** A validated playback-progress report. */
export type PlaybackProgressInput = z.infer<typeof playbackProgressInputSchema>;

/** Parse untrusted progress input, throwing a validation error on failure. */
export function parsePlaybackProgressInput(input: unknown): PlaybackProgressInput {
  const parsed = playbackProgressInputSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};

    for (const issue of parsed.error.issues) {
      const field = issue.path.length > 0 ? String(issue.path[0]) : 'form';
      const messages = fieldErrors[field] ?? [];
      messages.push(issue.message);
      fieldErrors[field] = messages;
    }

    throw new ValidationError('Invalid playback progress.', fieldErrors);
  }

  return parsed.data;
}
