/**
 * The announcement contract (Prompt 153 / D-085).
 *
 * This file is pure: it holds the shape of an announcement, and nothing else.
 * It carries no `server-only` marker and no database import, so a client
 * island may import it directly (D-049).
 */

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
