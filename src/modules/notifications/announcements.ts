import 'server-only';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { listActiveAccountIds } from '@/modules/auth';
import {
  requirePermission,
  toPermissionKey,
  type ActorContext,
} from '@/modules/authorization';
import type { DbExecutor } from '@/platform/db/executor';
import { NotFoundError, ValidationError } from '@/platform/errors';

import { announcements } from './schema';
import {
  MAX_AUDIENCE_SIZE,
  deliverToAudience,
  type NotificationRoundResult,
} from './audience';

/**
 * Website announcements (Prompt 153).
 *
 * An authorized administrator writes an announcement and publishes it by hand.
 * There is no scheduled publication and no recurring announcement: the
 * announcement is delivered when the administrator publishes it, and never
 * again.
 *
 * The announcement itself and the notifications it produces are separate
 * things. The announcement is the platform's message; the notifications are
 * one row per eligible viewer.
 */

/** The maximum length of an announcement title. */
export const ANNOUNCEMENT_TITLE_MAX_LENGTH = 200;

/** The maximum length of an announcement body. */
export const ANNOUNCEMENT_CONTENT_MAX_LENGTH = 5000;

/** The publication states an announcement can be in. */
export const ANNOUNCEMENT_STATUSES = ['draft', 'published'] as const;

/** One announcement state. */
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

/** An announcement to create. */
export type AnnouncementInput = {
  title: string;
  content: string;
  authorId: string;
  /** How long the announcement stays visible. `null` means it never expires. */
  expiresAt?: Date | null;
};

/** One announcement. */
export type AnnouncementView = {
  id: string;
  title: string;
  content: string;
  authorId: string;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
};

/** What one announcement publication did. */
export type AnnouncementPublicationResult = NotificationRoundResult & {
  /** The announcement that was published. */
  announcementId: string;
};

/**
 * Create a draft announcement.
 *
 * The announcement starts as a draft: nothing is delivered until it is
 * published.
 *
 * The service is the authority: it re-checks the permission the entrypoint
 * checked, so a caller that reaches it without the guard cannot create an
 * announcement (ARCHITECTURE §11.3).
 *
 * @param actor the administrator
 * @param input the announcement
 * @param executor the database executor
 * @returns the created announcement
 */
export async function createAnnouncement(
  actor: ActorContext,
  input: AnnouncementInput,
  executor: DbExecutor = db
): Promise<AnnouncementView> {
  requirePermission(actor, toPermissionKey('settings', 'manage'));

  const title = input.title.trim();
  const content = input.content.trim();

  if (title.length === 0 || title.length > ANNOUNCEMENT_TITLE_MAX_LENGTH) {
    throw new ValidationError(
      `The announcement title must be between 1 and ${ANNOUNCEMENT_TITLE_MAX_LENGTH} characters.`
    );
  }

  if (content.length === 0 || content.length > ANNOUNCEMENT_CONTENT_MAX_LENGTH) {
    throw new ValidationError(
      `The announcement content must be between 1 and ${ANNOUNCEMENT_CONTENT_MAX_LENGTH} characters.`
    );
  }

  const [row] = await executor
    .insert(announcements)
    .values({
      title,
      content,
      author_id: input.authorId,
      publication_status: 'draft',
      expires_at: input.expiresAt ?? null,
    })
    .returning({
      id: announcements.id,
      title: announcements.title,
      content: announcements.content,
      authorId: announcements.author_id,
      status: announcements.publication_status,
      expiresAt: announcements.expires_at,
      createdAt: announcements.created_at,
    });

  return {
    id: row?.id ?? '',
    title: row?.title ?? title,
    content: row?.content ?? content,
    authorId: row?.authorId ?? input.authorId,
    status: row?.status ?? 'draft',
    expiresAt: row?.expiresAt ?? input.expiresAt ?? null,
    createdAt: row?.createdAt ?? new Date(),
  };
}

/**
 * Publish an announcement and notify the eligible viewers.
 *
 * Publishing is idempotent: an announcement that is already published is not
 * published again, so a retried request produces no second round of
 * notifications.
 *
 * The service is the authority: it re-checks the permission the entrypoint
 * checked, so a caller that reaches it without the guard cannot publish an
 * announcement (ARCHITECTURE §11.3).
 *
 * @param actor the administrator
 * @param announcementId the announcement
 * @param executor the database executor
 * @returns what the publication did
 */
export async function publishAnnouncement(
  actor: ActorContext,
  announcementId: string,
  executor: DbExecutor = db
): Promise<AnnouncementPublicationResult> {
  requirePermission(actor, toPermissionKey('settings', 'manage'));

  const result: AnnouncementPublicationResult = {
    announcementId,
    notified: 0,
    skippedByPreference: 0,
    skippedAsDuplicate: 0,
    pushAttempts: 0,
  };

  const [announcement] = await executor
    .select({
      id: announcements.id,
      title: announcements.title,
      content: announcements.content,
      status: announcements.publication_status,
    })
    .from(announcements)
    .where(
      and(
        eq(announcements.id, announcementId),
        isNull(announcements.deleted_at)
      )
    )
    .limit(1);

  if (!announcement) {
    throw new NotFoundError('The announcement was not found.');
  }

  if (announcement.status === 'published') {
    // Already published: a retry must not produce a second notification.
    return result;
  }

  const updated = await executor
    .update(announcements)
    .set({
      publication_status: 'published',
      updated_at: sql`now()`,
    })
    .where(
      and(
        eq(announcements.id, announcementId),
        eq(announcements.publication_status, 'draft')
      )
    )
    .returning({ id: announcements.id });

  if (updated.length === 0) {
    // Somebody else published it in the meantime.
    return result;
  }

  const userIds = await listActiveAccountIds(MAX_AUDIENCE_SIZE, executor);

  if (userIds.length === 0) {
    return result;
  }

  const round = await deliverToAudience({
    eventType: 'website_announcement',
    contentId: announcement.id,
    userIds,
    message: {
      title: announcement.title,
      content: announcement.content,
      contentType: 'announcement',
      link: '/notifications',
    },
    executor,
  });

  return {
    announcementId: result.announcementId,
    notified: round.notified,
    skippedByPreference: round.skippedByPreference,
    skippedAsDuplicate: round.skippedAsDuplicate,
    pushAttempts: round.pushAttempts,
  };
}

/**
 * The published announcements that are still visible, newest first.
 *
 * @param limit the maximum number of announcements
 * @param executor the database executor
 * @returns the announcements
 */
export async function listPublishedAnnouncements(
  limit: number = 20,
  executor: DbExecutor = db
): Promise<AnnouncementView[]> {
  const bounded = Math.max(1, Math.min(limit, 100));

  const rows = await executor
    .select({
      id: announcements.id,
      title: announcements.title,
      content: announcements.content,
      authorId: announcements.author_id,
      status: announcements.publication_status,
      expiresAt: announcements.expires_at,
      createdAt: announcements.created_at,
    })
    .from(announcements)
    .where(
      and(
        eq(announcements.publication_status, 'published'),
        isNull(announcements.deleted_at)
      )
    )
    .orderBy(desc(announcements.created_at), desc(announcements.id))
    .limit(bounded);

  const now = new Date();

  return rows
    .map(row => ({ ...row, status: row.status ?? 'draft' }))
    .filter(
      row => row.expiresAt === null || row.expiresAt === undefined || row.expiresAt > now
    );
}

/** The maximum number of announcements the administration list may return. */
export const ANNOUNCEMENT_LIST_LIMIT = 50;

/**
 * Every announcement, for the administration list.
 *
 * The list is bounded: the administration screen shows the most recent
 * announcements, not every announcement the platform has ever published.
 *
 * @param limit the maximum number of announcements
 * @param executor the database executor
 * @returns the announcements, newest first
 */
export async function listAnnouncements(
  limit: number = ANNOUNCEMENT_LIST_LIMIT,
  executor: DbExecutor = db
): Promise<AnnouncementView[]> {
  const bounded = Math.max(1, Math.min(limit, ANNOUNCEMENT_LIST_LIMIT));

  const rows = await executor
    .select({
      id: announcements.id,
      title: announcements.title,
      content: announcements.content,
      authorId: announcements.author_id,
      status: announcements.publication_status,
      expiresAt: announcements.expires_at,
      createdAt: announcements.created_at,
    })
    .from(announcements)
    .where(isNull(announcements.deleted_at))
    .orderBy(desc(announcements.created_at), desc(announcements.id))
    .limit(bounded);

  return rows.map(row => ({ ...row, status: row.status ?? 'draft' }));
}
