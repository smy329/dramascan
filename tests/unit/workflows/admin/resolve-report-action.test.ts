import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The reporter notification of a content report (D-075).
 *
 * A viewer who reported a drama or a movie is owed the outcome: the platform
 * promises that a moderation outcome reaches the reporter, and the outcome is
 * a mandatory event — no preference switch withholds it.
 *
 * The notification carries the report id as its content id, so a repeated
 * resolution cannot produce a second notification for the same report.
 *
 * The workflow owns the notification (ARCHITECTURE §10): the users module
 * resolves the report, the notifications module writes the row, and the
 * workflow is the only place that may coordinate the two.
 */

const { notifyReporterMock, resolveContentReportMock, resolveActorMock } = vi.hoisted(() => ({
  notifyReporterMock: vi.fn(),
  resolveContentReportMock: vi.fn(),
  resolveActorMock: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/modules/authorization', () => ({
  resolveActor: resolveActorMock,
}));

vi.mock('@/modules/users', () => ({
  resolveContentReport: resolveContentReportMock,
}));

vi.mock('@/modules/notifications', () => ({
  notifyReporter: notifyReporterMock,
}));

vi.mock('@/platform/logging', () => ({
  createRequestLogger: () => ({
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    requestId: 'test-request',
    module: 'notifications',
  }),
}));

import { resolveReportAction } from '@/workflows/admin/resolve-report-action';

describe('resolveReportAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    resolveActorMock.mockResolvedValue({
      userId: 'moderator-1',
      roles: ['moderator'],
      isSuperAdmin: false,
      permissions: ['review.manage'],
    });

    resolveContentReportMock.mockResolvedValue({
      id: 'report-1',
      reporterId: 'reporter-1',
      contentType: 'drama',
      contentId: 'drama-1',
      reason: 'incorrect_information',
      description: null,
      status: 'resolved',
      createdAt: new Date('2026-11-20T10:00:00.000Z'),
      updatedAt: new Date('2026-11-20T11:00:00.000Z'),
    });
  });

  it('tells the reporter that the report was resolved', async () => {
    const result = await resolveReportAction({
      reportId: 'report-1',
      status: 'resolved',
      note: 'The description was corrected.',
    });

    expect(result.ok).toBe(true);
    expect(notifyReporterMock).toHaveBeenCalledTimes(1);

    const call = notifyReporterMock.mock.calls[0]?.[0] as {
      reporterUserId: string;
      resolutionOutcome: string;
      eventType: string;
      contentId: string | null;
    };

    expect(call.reporterUserId).toBe('reporter-1');
    expect(call.eventType).toBe('content_report_resolved');
    expect(call.contentId).toBe('report-1');
    expect(call.resolutionOutcome).toContain('The description was corrected.');
  });

  it('names the outcome when the moderator left no note', async () => {
    await resolveReportAction({ reportId: 'report-1', status: 'reviewed' });

    const call = notifyReporterMock.mock.calls[0]?.[0] as { resolutionOutcome: string };

    expect(call.resolutionOutcome.length).toBeGreaterThan(0);
  });

  it('does not notify when the report could not be resolved', async () => {
    resolveContentReportMock.mockRejectedValue(new Error('The report no longer exists.'));

    const result = await resolveReportAction({ reportId: 'report-1', status: 'resolved' });

    expect(result.ok).toBe(false);
    expect(notifyReporterMock).not.toHaveBeenCalled();
  });

  it('keeps the resolution successful when the reporter notification fails', async () => {
    // The report has already been resolved when the notification is written.
    // A failed write must not tell the moderator that the resolution failed:
    // it did not (D-064, D-075).
    notifyReporterMock.mockRejectedValue(new Error('The notification could not be written.'));

    const result = await resolveReportAction({ reportId: 'report-1', status: 'resolved' });

    expect(result.ok).toBe(true);
  });
});
