import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Review moderation integration coverage.
 *
 * Moderation is the part of the community feature where a mistake is
 * expensive: a report may be resolved without an audit trail, a review may
 * disappear without its history, or a reporter may never learn what happened.
 *
 * These tests exercise the real PostgreSQL test database, the real moderation
 * workflow, and the real authorization guards. Only the session resolution is
 * mocked, because a session cannot exist outside a request.
 */

vi.hoisted(() => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error('TEST_DATABASE_URL is required for moderation integration tests.');
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  delete process.env.TEST_DATABASE_URL;
});

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { resolveActorMock } = vi.hoisted(() => ({ resolveActorMock: vi.fn() }));

vi.mock('@/modules/authorization', async () => {
  const guards = await vi.importActual<typeof import('@/modules/authorization/guards')>(
    '@/modules/authorization/guards'
  );
  const permissions = await vi.importActual<typeof import('@/modules/authorization/permissions')>(
    '@/modules/authorization/permissions'
  );
  const actors = await vi.importActual<typeof import('@/modules/authorization/actors')>(
    '@/modules/authorization/actors'
  );

  return { ...permissions, ...guards, ...actors, resolveActor: resolveActorMock };
});

const { notifyReporterMock } = vi.hoisted(() => ({ notifyReporterMock: vi.fn() }));

vi.mock('@/modules/notifications', async () => {
  const actual = await vi.importActual<typeof import('@/modules/notifications')>(
    '@/modules/notifications'
  );

  return { ...actual, notifyReporter: notifyReporterMock };
});

import { and, eq, inArray, like } from 'drizzle-orm';

import { db } from '@/db/client';
import { users } from '@/modules/auth/schema';
import type { ActorContext } from '@/modules/authorization';
import { dramas, episodes, seasons } from '@/modules/content/schema';
import { moderation_actions } from '@/modules/moderation/schema';
import { notifications } from '@/modules/notifications/schema';
import {
  removeReview,
  submitDramaReview,
  submitReviewReport,
  toggleReviewEnjoying,
} from '@/modules/reviews';
import { review_reactions, review_reports, reviews } from '@/modules/reviews/schema';
import { closePool } from '@/platform/db/pool';
import { AuthenticationError, AuthorizationError, NotFoundError } from '@/platform/errors';
import {
  removeReviewAction,
  resolveReviewReportAction,
} from '@/workflows/moderation/review-moderation';

const notificationsActual = await vi.importActual<typeof import('@/modules/notifications')>(
  '@/modules/notifications'
);

const TEST_PREFIX = 'it-moderation-';

type Seed = {
  authorId: string;
  reporterId: string;
  moderatorId: string;
  outsiderId: string;
  dramaId: string;
  reviewId: string;
  reportId: string;
};

/** The moderator the workflow acts as. */
function moderatorActor(userId: string): ActorContext {
  return {
    userId,
    roles: ['moderator'],
    isSuperAdmin: false,
    permissions: ['review.read', 'review.manage'],
  };
}

/** An authenticated viewer with no moderation permission. */
function outsiderActor(userId: string): ActorContext {
  return {
    userId,
    roles: ['viewer'],
    isSuperAdmin: false,
    permissions: [],
  };
}

async function seed(): Promise<Seed> {
  const suffix = randomUUID().slice(0, 8);
  const authorId = randomUUID();
  const reporterId = randomUUID();
  const moderatorId = randomUUID();
  const outsiderId = randomUUID();
  const dramaId = randomUUID();
  const seasonId = randomUUID();
  const episodeId = randomUUID();

  await db.insert(users).values([
    {
      id: authorId,
      name: 'Review author',
      email: `${TEST_PREFIX}author-${suffix}@example.com`,
    },
    {
      id: reporterId,
      name: 'Review reporter',
      email: `${TEST_PREFIX}reporter-${suffix}@example.com`,
    },
    {
      id: moderatorId,
      name: 'Review moderator',
      email: `${TEST_PREFIX}moderator-${suffix}@example.com`,
    },
    {
      id: outsiderId,
      name: 'Review outsider',
      email: `${TEST_PREFIX}outsider-${suffix}@example.com`,
    },
  ]);

  await db.insert(dramas).values({
    id: dramaId,
    title: 'Moderation drama',
    slug: `${TEST_PREFIX}${suffix}`,
    structure_type: 'season_based',
    status: 'ongoing',
    publication_status: 'published',
    visibility: 'coming_soon',
  });

  await db.insert(seasons).values({
    id: seasonId,
    drama_id: dramaId,
    title: 'Season 1',
    position: 0,
    publication_status: 'published',
  });

  await db.insert(episodes).values({
    id: episodeId,
    drama_id: dramaId,
    season_id: seasonId,
    title: 'Episode 1',
    episode_number: 1,
    position: 0,
    publication_status: 'published',
    video_source: 'https://media.example.com/episodes/moderation.mp4',
  });

  const review = await submitDramaReview(authorId, dramaId, null, 'A reported review.');

  if (!review) {
    throw new Error('The review insert returned no row.');
  }

  const report = await submitReviewReport(reporterId, review.id, 'spam_advertising', 'Spam.');

  if (!report) {
    throw new Error('The report insert returned no row.');
  }

  return {
    authorId,
    reporterId,
    moderatorId,
    outsiderId,
    dramaId,
    reviewId: review.id,
    reportId: report.id,
  };
}

/** The moderation audit rows recorded for one target. */
async function auditRowsFor(targetId: string) {
  return db.select().from(moderation_actions).where(eq(moderation_actions.target_id, targetId));
}

/** The notifications delivered to one user. */
async function notificationsFor(userId: string) {
  return db.select().from(notifications).where(eq(notifications.user_id, userId));
}

async function cleanup(): Promise<void> {
  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_PREFIX}%`));

  const userIds = userRows.map(row => row.id);

  const dramaRows = await db
    .select({ id: dramas.id })
    .from(dramas)
    .where(like(dramas.slug, `${TEST_PREFIX}%`));

  const dramaIds = dramaRows.map(row => row.id);

  if (userIds.length > 0) {
    await db.delete(notifications).where(inArray(notifications.user_id, userIds));
  }

  if (dramaIds.length > 0) {
    const reviewRows = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(inArray(reviews.drama_id, dramaIds));

    const reviewIds = reviewRows.map(row => row.id);

    if (reviewIds.length > 0) {
      await db.delete(review_reactions).where(inArray(review_reactions.review_id, reviewIds));
      await db.delete(review_reports).where(
        inArray(review_reports.review_id_snapshot, reviewIds)
      );
    }

    await db.delete(reviews).where(inArray(reviews.drama_id, dramaIds));
  }

  if (userIds.length > 0) {
    // Reports whose review was already removed have a null `review_id`, so they
    // are found through the reporter instead.
    const reportRows = await db
      .select({ id: review_reports.id })
      .from(review_reports)
      .where(inArray(review_reports.user_id, userIds));

    const reportIds = reportRows.map(row => row.id);

    // The audit trail outlives the moderator, so it is removed through the
    // target it refers to rather than through its actor.
    if (reportIds.length > 0) {
      await db.delete(moderation_actions).where(inArray(moderation_actions.target_id, reportIds));
    }

    await db.delete(review_reports).where(inArray(review_reports.user_id, userIds));
    await db.delete(moderation_actions).where(
      inArray(moderation_actions.actor_user_id, userIds)
    );
  }

  if (dramaIds.length > 0) {
    const reviewRows = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(inArray(reviews.drama_id, dramaIds));

    const reviewIds = reviewRows.map(row => row.id);

    if (reviewIds.length > 0) {
      await db.delete(moderation_actions).where(inArray(moderation_actions.target_id, reviewIds));
    }

    await db.delete(episodes).where(inArray(episodes.drama_id, dramaIds));
    await db.delete(seasons).where(inArray(seasons.drama_id, dramaIds));
    await db.delete(dramas).where(inArray(dramas.id, dramaIds));
  }

  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds));
  }
}

beforeEach(async () => {
  await cleanup();

  notifyReporterMock.mockReset();
  notifyReporterMock.mockImplementation(notificationsActual.notifyReporter);
  resolveActorMock.mockReset();
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe('recordModerationAction', () => {
  it('writes an audit row with the action, the target, and the actor', async () => {
    const seeded = await seed();

    const recorded = await import('@/modules/moderation').then(module =>
      module.recordModerationAction(
        moderatorActor(seeded.moderatorId),
        'report_resolved',
        'report',
        seeded.reportId,
        'The review was kept.'
      )
    );

    const [row] = await db
      .select()
      .from(moderation_actions)
      .where(eq(moderation_actions.id, recorded.id));

    expect(row?.action).toBe('report_resolved');
    expect(row?.target_type).toBe('report');
    expect(row?.target_id).toBe(seeded.reportId);
    expect(row?.actor_user_id).toBe(seeded.moderatorId);
    expect(row?.detail).toBe('The review was kept.');
  });

  it('refuses an actor without the review.manage permission', async () => {
    const seeded = await seed();

    const { recordModerationAction } = await import('@/modules/moderation');

    await expect(
      recordModerationAction(
        outsiderActor(seeded.outsiderId),
        'report_resolved',
        'report',
        seeded.reportId,
        'The review was kept.'
      )
    ).rejects.toThrow(AuthorizationError);

    expect(await auditRowsFor(seeded.reportId)).toHaveLength(0);
  });

  it('refuses an anonymous actor', async () => {
    const seeded = await seed();

    const { recordModerationAction } = await import('@/modules/moderation');

    await expect(
      recordModerationAction(
        { userId: null, roles: [], isSuperAdmin: false, permissions: [] },
        'report_resolved',
        'report',
        seeded.reportId,
        'The review was kept.'
      )
    ).rejects.toThrow(AuthenticationError);

    expect(await auditRowsFor(seeded.reportId)).toHaveLength(0);
  });
});

describe('removeReview', () => {
  it('refuses an actor without the review.manage permission and keeps the review', async () => {
    const seeded = await seed();

    await expect(removeReview(outsiderActor(seeded.outsiderId), seeded.reviewId)).rejects.toThrow(
      AuthorizationError
    );

    const rows = await db.select().from(reviews).where(eq(reviews.id, seeded.reviewId));

    expect(rows).toHaveLength(1);
  });

  it('permanently deletes the review and its reactions', async () => {
    const seeded = await seed();

    await toggleReviewEnjoying(seeded.reviewId, seeded.outsiderId);

    const removed = await removeReview(moderatorActor(seeded.moderatorId), seeded.reviewId);

    expect(removed.id).toBe(seeded.reviewId);

    const reviewRows = await db.select().from(reviews).where(eq(reviews.id, seeded.reviewId));
    const reactionRows = await db
      .select()
      .from(review_reactions)
      .where(eq(review_reactions.review_id, seeded.reviewId));

    expect(reviewRows).toHaveLength(0);
    expect(reactionRows).toHaveLength(0);
  });

  it('keeps the report as moderation history with its snapshot', async () => {
    const seeded = await seed();

    await removeReview(moderatorActor(seeded.moderatorId), seeded.reviewId);

    const [row] = await db
      .select()
      .from(review_reports)
      .where(eq(review_reports.id, seeded.reportId));

    expect(row).toBeDefined();
    expect(row?.review_id).toBeNull();
    expect(row?.review_id_snapshot).toBe(seeded.reviewId);
  });

  it('refuses to remove a review that no longer exists', async () => {
    const seeded = await seed();

    await removeReview(moderatorActor(seeded.moderatorId), seeded.reviewId);

    await expect(
      removeReview(moderatorActor(seeded.moderatorId), seeded.reviewId)
    ).rejects.toThrow(NotFoundError);
  });
});

describe('resolveReviewReportAction', () => {
  it('resolves the report, records the audit trail, and notifies the reporter', async () => {
    const seeded = await seed();

    resolveActorMock.mockResolvedValue(moderatorActor(seeded.moderatorId));

    const result = await resolveReviewReportAction({
      reportId: seeded.reportId,
      outcome: 'The review was kept because it is not spam.',
    });

    expect(result.ok).toBe(true);

    const [report] = await db
      .select()
      .from(review_reports)
      .where(eq(review_reports.id, seeded.reportId));

    expect(report?.status).toBe('resolved');
    expect(report?.resolution_outcome).toBe('The review was kept because it is not spam.');
    expect(report?.resolved_by).toBe(seeded.moderatorId);
    expect(report?.resolved_at).not.toBeNull();

    const auditRows = await db
      .select()
      .from(moderation_actions)
      .where(
        and(
          eq(moderation_actions.action, 'report_resolved'),
          eq(moderation_actions.target_id, seeded.reportId)
        )
      );

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.actor_user_id).toBe(seeded.moderatorId);

    const notificationRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.user_id, seeded.reporterId));

    expect(notificationRows).toHaveLength(1);
    expect(notificationRows[0]?.event_type).toBe('review_report_resolved');
    expect(notificationRows[0]?.content).toBe('The review was kept because it is not spam.');
  });

  it('refuses an actor without the review.manage permission and changes nothing', async () => {
    const seeded = await seed();

    resolveActorMock.mockResolvedValue(outsiderActor(seeded.outsiderId));

    const result = await resolveReviewReportAction({
      reportId: seeded.reportId,
      outcome: 'The review was kept.',
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe('forbidden');
    }

    const [report] = await db
      .select()
      .from(review_reports)
      .where(eq(review_reports.id, seeded.reportId));

    expect(report?.status).toBe('active');
    expect(report?.resolution_outcome).toBeNull();

    expect(await auditRowsFor(seeded.reportId)).toHaveLength(0);
    expect(await notificationsFor(seeded.reporterId)).toHaveLength(0);
  });

  it('refuses an empty outcome and changes nothing', async () => {
    const seeded = await seed();

    resolveActorMock.mockResolvedValue(moderatorActor(seeded.moderatorId));

    const result = await resolveReviewReportAction({ reportId: seeded.reportId, outcome: '   ' });

    expect(result.ok).toBe(false);

    const [report] = await db
      .select()
      .from(review_reports)
      .where(eq(review_reports.id, seeded.reportId));

    expect(report?.status).toBe('active');
    expect(await auditRowsFor(seeded.reportId)).toHaveLength(0);
    expect(await notificationsFor(seeded.reporterId)).toHaveLength(0);
  });

  it('rolls the whole resolution back when the notification cannot be written', async () => {
    const seeded = await seed();

    resolveActorMock.mockResolvedValue(moderatorActor(seeded.moderatorId));
    notifyReporterMock.mockRejectedValueOnce(new Error('The notification could not be written.'));

    const result = await resolveReviewReportAction({
      reportId: seeded.reportId,
      outcome: 'The review was kept.',
    });

    expect(result.ok).toBe(false);

    const [report] = await db
      .select()
      .from(review_reports)
      .where(eq(review_reports.id, seeded.reportId));

    expect(report?.status).toBe('active');
    expect(report?.resolution_outcome).toBeNull();
    expect(report?.resolved_at).toBeNull();

    expect(await auditRowsFor(seeded.reportId)).toHaveLength(0);
    expect(await notificationsFor(seeded.reporterId)).toHaveLength(0);
  });
});

describe('removeReviewAction', () => {
  it('removes the review, resolves its open reports, and notifies the reporters', async () => {
    const seeded = await seed();

    resolveActorMock.mockResolvedValue(moderatorActor(seeded.moderatorId));

    const result = await removeReviewAction({ reviewId: seeded.reviewId });

    expect(result.ok).toBe(true);

    expect(await db.select().from(reviews).where(eq(reviews.id, seeded.reviewId))).toHaveLength(0);

    const [report] = await db
      .select()
      .from(review_reports)
      .where(eq(review_reports.id, seeded.reportId));

    expect(report?.status).toBe('resolved');
    expect(report?.resolution_outcome).toContain('permanently removed');
    expect(report?.review_id).toBeNull();
    expect(report?.review_id_snapshot).toBe(seeded.reviewId);

    const auditRows = await db
      .select()
      .from(moderation_actions)
      .where(
        and(
          eq(moderation_actions.action, 'review_removed'),
          eq(moderation_actions.target_id, seeded.reviewId)
        )
      );

    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.target_id).toBe(seeded.reviewId);

    const notificationRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.user_id, seeded.reporterId));

    expect(notificationRows).toHaveLength(1);
  });

  it('refuses an actor without the review.manage permission and keeps the review', async () => {
    const seeded = await seed();

    resolveActorMock.mockResolvedValue(outsiderActor(seeded.outsiderId));

    const result = await removeReviewAction({ reviewId: seeded.reviewId });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe('forbidden');
    }

    expect(await db.select().from(reviews).where(eq(reviews.id, seeded.reviewId))).toHaveLength(1);
    expect(await auditRowsFor(seeded.reviewId)).toHaveLength(0);
  });
});
