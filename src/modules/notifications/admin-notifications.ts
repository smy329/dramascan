import 'server-only';

import {
  and,
  arrayOverlaps,
  count,
  desc,
  eq,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { db } from '@/db/client';
import type { DbExecutor } from '@/platform/db/executor';
import { ValidationError } from '@/platform/errors';

import {
  ADMIN_NOTIFICATION_AUDIENCES,
  canViewAdminNotification,
  type AdminNotificationAudience,
  type AdminNotificationViewer,
} from './admin-notification-rules';
import { admin_notification_reads, admin_notifications } from './schema';

/**
 * The administrator notification centre (Prompt 153 / D-067).
 *
 * There are two kinds of administrator notification, and they are authorized
 * differently:
 *
 *   - **Announcements** are written by an administrator with `settings.manage`
 *     and delivered to the viewers.
 *   - **Alerts** are written by the platform for the administrators who need to
 *     act on them: a new content report, a failed publication announcement, a
 *     security event. They are read in this centre.
 *
 * An alert carries an audience. `all` reaches every administrator who may read
 * alerts, `super_admin` reaches only the Super Admin, and `roles` reaches the
 * holders of the named roles. The audience is enforced here, on the server, on
 * every read and every read-state write — never by hiding a row in the UI.
 *
 * Read state is per administrator. One alert addressed to every moderator is
 * still unread for the moderator who has not opened it.
 */

/** The audiences an alert can address. */
export { ADMIN_NOTIFICATION_AUDIENCES, canViewAdminNotification };

export type { AdminNotificationAudience, AdminNotificationViewer };

/** The categories an alert can belong to. */
export const ADMIN_NOTIFICATION_CATEGORIES = [
  'security',
  'content',
  'system',
  'maintenance',
] as const;

/** One alert category. */
export type AdminNotificationCategory = (typeof ADMIN_NOTIFICATION_CATEGORIES)[number];

/** The priorities an alert can carry. */
export const ADMIN_NOTIFICATION_PRIORITIES = ['normal', 'high'] as const;

/** One alert priority. */
export type AdminNotificationPriority = (typeof ADMIN_NOTIFICATION_PRIORITIES)[number];

export const ADMIN_NOTIFICATION_TITLE_MAX_LENGTH = 200;
export const ADMIN_NOTIFICATION_CONTENT_MAX_LENGTH = 5000;
export const ADMIN_NOTIFICATION_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** One alert as the centre renders it. */
export type AdminNotificationView = Readonly<{
  id: string;
  title: string;
  content: string;
  audience: string;
  audienceRoles: readonly string[];
  category: string;
  priority: string;
  link: string | null;
  isResolved: boolean;
  createdAt: string;
  readAt: string | null;
}>;

/** One page of alerts. */
export type AdminNotificationPage = Readonly<{
  items: readonly AdminNotificationView[];
  total: number;
  page: number;
  pageSize: number;
}>;

/** An alert to write. */
export type AdminNotificationInput = Readonly<{
  title: string;
  content: string;
  audience: AdminNotificationAudience;
  audienceRoles?: readonly string[];
  category: AdminNotificationCategory;
  priority?: AdminNotificationPriority;
  link?: string | null;
  contentId?: string | null;
  contentType?: string | null;
}>;

/**
 * Write one administrator alert.
 *
 * The producer is a workflow, so the input is already server-built. The checks
 * here are a safety net against a programming mistake, not a user-input
 * validator.
 *
 * @param input the alert
 * @param executor the database executor
 * @returns the created alert id
 */
export async function createAdminNotification(
  input: AdminNotificationInput,
  executor: DbExecutor = db
): Promise<{ id: string }> {
  const title = input.title.trim();
  const content = input.content.trim();

  if (title.length === 0 || title.length > ADMIN_NOTIFICATION_TITLE_MAX_LENGTH) {
    throw new ValidationError('The alert title is not valid.');
  }

  if (content.length === 0 || content.length > ADMIN_NOTIFICATION_CONTENT_MAX_LENGTH) {
    throw new ValidationError('The alert content is not valid.');
  }

  if (!ADMIN_NOTIFICATION_AUDIENCES.includes(input.audience)) {
    throw new ValidationError('The alert audience is not valid.');
  }

  if (!ADMIN_NOTIFICATION_CATEGORIES.includes(input.category)) {
    throw new ValidationError('The alert category is not valid.');
  }

  const priority = input.priority ?? 'normal';

  if (!ADMIN_NOTIFICATION_PRIORITIES.includes(priority)) {
    throw new ValidationError('The alert priority is not valid.');
  }

  const audienceRoles = [...new Set(input.audienceRoles ?? [])];

  if (input.audience === 'roles' && audienceRoles.length === 0) {
    throw new ValidationError('A role-addressed alert needs at least one role.');
  }

  const [row] = await executor
    .insert(admin_notifications)
    .values({
      title,
      content,
      audience: input.audience,
      audience_roles: input.audience === 'roles' ? audienceRoles : null,
      category: input.category,
      priority,
      link: input.link ?? null,
      content_id: input.contentId ?? null,
      content_type: input.contentType ?? null,
    })
    .returning({ id: admin_notifications.id });

  if (!row) {
    throw new ValidationError('The alert could not be written.');
  }

  return row;
}

/**
 * One page of the alerts this viewer may see.
 *
 * @param viewer the administrator
 * @param options the category filter and the page
 * @param executor the database executor
 * @returns the page of alerts
 */
export async function listAdminNotifications(
  viewer: AdminNotificationViewer,
  options: { category?: string | null; page?: number; pageSize?: number } = {},
  executor: DbExecutor = db
): Promise<AdminNotificationPage> {
  if (!viewer.canViewAlerts) {
    return { items: [], total: 0, page: 1, pageSize: ADMIN_NOTIFICATION_PAGE_SIZE };
  }

  const pageSize = clamp(options.pageSize ?? ADMIN_NOTIFICATION_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const offset = (page - 1) * pageSize;
  const category =
    options.category !== undefined &&
    options.category !== null &&
    ADMIN_NOTIFICATION_CATEGORIES.includes(
      options.category as AdminNotificationCategory
    )
      ? options.category
      : null;

  const conditions: SQL[] = [
    isNull(admin_notifications.deleted_at),
    audienceFilter(viewer),
  ];

  if (category !== null) {
    conditions.push(eq(admin_notifications.category, category));
  }

  const where = and(...conditions) as SQL;

  const [totalRow] = await executor
    .select({ total: count() })
    .from(admin_notifications)
    .where(where);

  const rows = await executor
    .select({
      id: admin_notifications.id,
      title: admin_notifications.title,
      content: admin_notifications.content,
      audience: admin_notifications.audience,
      audienceRoles: admin_notifications.audience_roles,
      category: admin_notifications.category,
      priority: admin_notifications.priority,
      link: admin_notifications.link,
      isResolved: admin_notifications.is_resolved,
      createdAt: admin_notifications.created_at,
      readAt: admin_notification_reads.read_at,
    })
    .from(admin_notifications)
    .leftJoin(
      admin_notification_reads,
      and(
        eq(admin_notification_reads.notification_id, admin_notifications.id),
        eq(admin_notification_reads.admin_user_id, viewer.userId)
      )
    )
    .where(where)
    .orderBy(desc(admin_notifications.created_at))
    .limit(pageSize)
    .offset(offset);

  return {
    items: rows.map(row => ({
      id: row.id,
      title: row.title,
      content: row.content,
      audience: row.audience ?? 'all',
      audienceRoles: row.audienceRoles ?? [],
      category: row.category ?? 'system',
      priority: row.priority ?? 'normal',
      link: row.link,
      isResolved: row.isResolved === true,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt === null ? null : row.readAt.toISOString(),
    })),
    total: Number(totalRow?.total ?? 0),
    page,
    pageSize,
  };
}

/**
 * One alert, or `null` when it does not exist or the viewer may not see it.
 *
 * The two cases deliberately share a result: an alert the viewer may not see
 * must not become discoverable through a different response.
 *
 * @param viewer the administrator
 * @param notificationId the alert
 * @param executor the database executor
 * @returns the alert, or `null`
 */
export async function getAdminNotification(
  viewer: AdminNotificationViewer,
  notificationId: string,
  executor: DbExecutor = db
): Promise<AdminNotificationView | null> {
  if (!viewer.canViewAlerts) {
    return null;
  }

  const [row] = await executor
    .select({
      id: admin_notifications.id,
      title: admin_notifications.title,
      content: admin_notifications.content,
      audience: admin_notifications.audience,
      audienceRoles: admin_notifications.audience_roles,
      category: admin_notifications.category,
      priority: admin_notifications.priority,
      link: admin_notifications.link,
      isResolved: admin_notifications.is_resolved,
      createdAt: admin_notifications.created_at,
      readAt: admin_notification_reads.read_at,
    })
    .from(admin_notifications)
    .leftJoin(
      admin_notification_reads,
      and(
        eq(admin_notification_reads.notification_id, admin_notifications.id),
        eq(admin_notification_reads.admin_user_id, viewer.userId)
      )
    )
    .where(
      and(
        eq(admin_notifications.id, notificationId),
        isNull(admin_notifications.deleted_at),
        audienceFilter(viewer)
      )
    )
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    audience: row.audience ?? 'all',
    audienceRoles: row.audienceRoles ?? [],
    category: row.category ?? 'system',
    priority: row.priority ?? 'normal',
    link: row.link,
    isResolved: row.isResolved === true,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt === null ? null : row.readAt.toISOString(),
  };
}

/**
 * How many visible alerts the viewer has not read.
 *
 * @param viewer the administrator
 * @param executor the database executor
 * @returns the unread count
 */
export async function countUnreadAdminNotifications(
  viewer: AdminNotificationViewer,
  executor: DbExecutor = db
): Promise<number> {
  if (!viewer.canViewAlerts) {
    return 0;
  }

  const [row] = await executor
    .select({ total: count() })
    .from(admin_notifications)
    .leftJoin(
      admin_notification_reads,
      and(
        eq(admin_notification_reads.notification_id, admin_notifications.id),
        eq(admin_notification_reads.admin_user_id, viewer.userId)
      )
    )
    .where(
      and(
        isNull(admin_notifications.deleted_at),
        audienceFilter(viewer),
        isNull(admin_notification_reads.id)
      )
    );

  return Number(row?.total ?? 0);
}

/**
 * Mark one visible alert read or unread for this administrator.
 *
 * @param viewer the administrator
 * @param notificationId the alert
 * @param read the desired state
 * @param executor the database executor
 * @returns `false` when the alert does not exist or is not visible
 */
export async function setAdminNotificationRead(
  viewer: AdminNotificationViewer,
  notificationId: string,
  read: boolean,
  executor: DbExecutor = db
): Promise<boolean> {
  if (!viewer.canViewAlerts) {
    return false;
  }

  const [visible] = await executor
    .select({ id: admin_notifications.id })
    .from(admin_notifications)
    .where(
      and(
        eq(admin_notifications.id, notificationId),
        isNull(admin_notifications.deleted_at),
        audienceFilter(viewer)
      )
    )
    .limit(1);

  if (!visible) {
    return false;
  }

  if (read) {
    await executor
      .insert(admin_notification_reads)
      .values({
        notification_id: notificationId,
        admin_user_id: viewer.userId,
        read_at: sql`now()`,
      })
      .onConflictDoNothing();

    return true;
  }

  await executor
    .delete(admin_notification_reads)
    .where(
      and(
        eq(admin_notification_reads.notification_id, notificationId),
        eq(admin_notification_reads.admin_user_id, viewer.userId)
      )
    );

  return true;
}

/**
 * The SQL form of the audience rule.
 *
 * `all` is visible to every alert reader. `super_admin` is visible only to the
 * Super Admin. `roles` overlaps the viewer's assigned role names.
 */
function audienceFilter(viewer: AdminNotificationViewer): SQL {
  const clauses: SQL[] = [eq(admin_notifications.audience, 'all')];

  if (viewer.isSuperAdmin) {
    clauses.push(eq(admin_notifications.audience, 'super_admin'));
  }

  if (viewer.roles.length > 0) {
    const roleClause = and(
      eq(admin_notifications.audience, 'roles'),
      arrayOverlaps(admin_notifications.audience_roles, [...viewer.roles])
    );

    if (roleClause) {
      clauses.push(roleClause);
    }
  }

  return or(...clauses) as SQL;
}

/** Clamp an integer into a range. */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(Math.floor(value), maximum));
}
