/**
 * The notification centre contract (Prompt 151).
 *
 * This file is pure: it holds the shape of the notifications the viewer sees,
 * and nothing else. It carries no `server-only` marker and no database import,
 * so a client island may import it directly (D-049).
 */

/** One notification as the viewer sees it. */
export type NotificationView = {
  id: string;
  title: string;
  content: string;
  eventType: string;
  contentId: string | null;
  contentType: string | null;
  link: string | null;
  priority: string;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
};

/** The viewer's notification center. */
export type NotificationCenter = {
  notifications: NotificationView[];
  /** How many notifications the viewer has not read. */
  unreadCount: number;
  /** How many notifications the center holds in total. */
  totalCount: number;
};
