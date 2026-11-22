/**
 * Client-safe content Trash contracts.
 *
 * The Trash spans four content types, so the read model has to normalise them
 * into one shape. The administrator surface renders that shape in the browser
 * and the admin routes accept it back, so the contracts live in `lib/contracts`
 * instead of in the workflow that owns the data access.
 */

import { z } from 'zod';

/** The content types that support Trash. */
export const TRASH_CONTENT_TYPES = ['drama', 'season', 'episode', 'movie'] as const;

export type TrashContentType = (typeof TRASH_CONTENT_TYPES)[number];

/** One trashed row, normalised across the four content types. */
export type TrashItem = {
  id: string;
  contentType: TrashContentType;
  title: string;
  parentTitle: string | null;
  deletedAt: string;
  expiresAt: string;
  childCounts: {
    seasons: number;
    episodes: number;
  };
};

/** A paginated Trash listing. */
export type TrashListResult = {
  items: TrashItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  retentionDays: number;
};

/**
 * The records a permanent deletion affects.
 *
 * The impact is shown before the administrator confirms, so the shape is part
 * of the client contract and not an internal detail of the workflow.
 */
export type PermanentDeleteImpact = {
  contentType: TrashContentType;
  id: string;
  title: string;
  seasons: number;
  episodes: number;
  bookmarks: number;
  playbackProgress: number;
  watchedState: number;
  watchHistory: number;
  ratings: number;
  reviews: number;
  analyticsEvents: number;
  notifications: number;
  metadataRows: number;
};

/** One item of a permanent deletion. */
export type PermanentDeleteRequest = {
  contentType: TrashContentType;
  id: string;
};

/** The outcome of one item of a bulk permanent deletion. */
export type PermanentDeleteItemResult = {
  contentType: TrashContentType;
  id: string;
  status: 'succeeded' | 'failed';
  message: string | null;
  impact: PermanentDeleteImpact | null;
};

/** The outcome of a bulk permanent deletion. */
export type PermanentDeleteBulkResult = {
  requested: number;
  succeeded: number;
  failed: number;
  results: PermanentDeleteItemResult[];
};

/** Body of the restore request. */
export const trashRestoreRequestSchema = z.object({
  contentType: z.enum(TRASH_CONTENT_TYPES),
  id: z.uuid(),
});

export type TrashRestoreRequest = z.infer<typeof trashRestoreRequestSchema>;

/** Body of a single permanent-deletion request. */
export const trashPermanentDeleteRequestSchema = z.object({
  contentType: z.enum(TRASH_CONTENT_TYPES),
  id: z.uuid(),
});

/** Body of a bulk permanent-deletion request. */
export const trashPermanentDeleteBulkRequestSchema = z.object({
  items: z
    .array(trashPermanentDeleteRequestSchema)
    .min(1)
    .max(100),
});
