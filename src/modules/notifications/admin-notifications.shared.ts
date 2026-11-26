/**
 * The administrator alert contract (Prompt 153 / D-067, D-085).
 *
 * This file is pure: it holds the shape of an alert and of a page of alerts,
 * and nothing else. It carries no `server-only` marker and no database import,
 * so a client island may import it directly (D-049).
 *
 * The shape lives here because two sides build it: the server reads the rows
 * and the browser renders them. One definition keeps the two from drifting.
 */

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
