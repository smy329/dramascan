// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ReviewReportQueue, type ReviewReportRow } from '@/components/admin/moderation/review-report-queue';

/**
 * The review-report moderation queue.
 *
 * Resolving a report removes it from the queue, so the page re-renders with an
 * empty list the moment the action succeeds. The confirmation must survive
 * that re-render: a moderator who resolves the only report in the queue would
 * otherwise see the empty state and no confirmation at all, and could not tell
 * whether the click had worked.
 */

const { resolveReviewReportActionMock, removeReviewActionMock } = vi.hoisted(() => ({
  resolveReviewReportActionMock: vi.fn(),
  removeReviewActionMock: vi.fn(),
}));

vi.mock('@/workflows/moderation/review-moderation', () => ({
  resolveReviewReportAction: resolveReviewReportActionMock,
  removeReviewAction: removeReviewActionMock,
}));

const REPORT: ReviewReportRow = {
  id: 'report-1',
  reviewId: 'review-1',
  reviewIdSnapshot: 'review-1',
  reason: 'spam_advertising',
  description: 'This review looks like spam to me.',
  status: 'active',
  reviewTitle: 'A reported review',
  reviewContent: 'Buy my product.',
  reviewRemoved: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

afterEach(cleanup);

beforeEach(() => {
  resolveReviewReportActionMock.mockReset();
  removeReviewActionMock.mockReset();
});

describe('ReviewReportQueue', () => {
  it('keeps the confirmation visible when resolving empties the queue', async () => {
    resolveReviewReportActionMock.mockResolvedValue({ ok: true, data: undefined });

    const view = render(<ReviewReportQueue reports={[REPORT]} canRemove />);

    fireEvent.change(screen.getByLabelText('Resolution outcome'), {
      target: { value: 'The review was kept.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Resolve report' }));

    await waitFor(() => {
      expect(
        screen.getByText('The report was resolved and the reporter was notified.')
      ).toBeTruthy();
    });

    // The resolved report leaves the queue and the page is re-rendered.
    view.rerender(<ReviewReportQueue reports={[]} canRemove />);

    expect(
      screen.getByText('The report was resolved and the reporter was notified.')
    ).toBeTruthy();
    expect(screen.getByText('There are no review reports in this queue.')).toBeTruthy();
  });

  it('keeps the failure message visible when resolving empties the queue', async () => {
    resolveReviewReportActionMock.mockResolvedValue({
      ok: false,
      error: { code: 'forbidden', message: 'You may not resolve reports.' },
    });

    const view = render(<ReviewReportQueue reports={[REPORT]} canRemove />);

    fireEvent.change(screen.getByLabelText('Resolution outcome'), {
      target: { value: 'The review was kept.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Resolve report' }));

    await waitFor(() => {
      expect(screen.getByText('You may not resolve reports.')).toBeTruthy();
    });

    view.rerender(<ReviewReportQueue reports={[]} canRemove />);

    expect(screen.getByText('You may not resolve reports.')).toBeTruthy();
  });

  it('refuses to resolve a report without an outcome', () => {
    render(<ReviewReportQueue reports={[REPORT]} canRemove />);

    fireEvent.click(screen.getByRole('button', { name: 'Resolve report' }));

    expect(resolveReviewReportActionMock).not.toHaveBeenCalled();
    expect(screen.getByText('Write what was decided before resolving the report.')).toBeTruthy();
  });
});
