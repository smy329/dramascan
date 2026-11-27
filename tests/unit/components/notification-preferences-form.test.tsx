// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { ActionResult } from '@/lib/contracts/common';
import type { NotificationPreferenceSet } from '@/modules/notifications/preferences.shared';

/**
 * The notification preference form (Prompt 150 / D-085).
 *
 * The form saves the switches the viewer changed. It never sends the switches
 * it did not change, so two devices cannot silently reset each other: a stale
 * form on one device must not carry the value another device has already
 * changed.
 */

const { saveNotificationPreferences } = vi.hoisted(() => ({
  saveNotificationPreferences: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/workflows/notifications/preferences', () => ({
  saveNotificationPreferences: (payload: unknown) => saveNotificationPreferences(payload),
}));

const { NotificationPreferencesForm } = await import(
  '@/components/notifications/notification-preferences-form'
);

afterEach(() => {
  cleanup();
  saveNotificationPreferences.mockReset();
});

const PREFERENCES: NotificationPreferenceSet = {
  newEpisode: true,
  newDrama: true,
  newDramaSeason: true,
  websiteAnnouncement: true,
  // The account-security notification is essential: it cannot be switched
  // off, so the form never offers a switch for it.
  accountSecurity: true,
  globalInApp: true,
  globalPush: true,
};

function renderForm(preferences: NotificationPreferenceSet = PREFERENCES) {
  return render(<NotificationPreferencesForm preferences={preferences} />);
}

function savedSet(overrides: Partial<NotificationPreferenceSet> = {}): NotificationPreferenceSet {
  return { ...PREFERENCES, ...overrides };
}

describe('NotificationPreferencesForm', () => {
  it('submits only the switch the viewer changed', async () => {
    saveNotificationPreferences.mockResolvedValue({
      ok: true,
      data: savedSet({ globalPush: false }),
    } satisfies ActionResult<NotificationPreferenceSet>);

    renderForm();

    fireEvent.click(screen.getByRole('switch', { name: 'Browser push' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => expect(saveNotificationPreferences).toHaveBeenCalledTimes(1));
    expect(saveNotificationPreferences).toHaveBeenCalledWith({ globalPush: false });
  });

  it('submits nothing when the viewer changed no switch', async () => {
    saveNotificationPreferences.mockResolvedValue({
      ok: true,
      data: savedSet(),
    } satisfies ActionResult<NotificationPreferenceSet>);

    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => expect(saveNotificationPreferences).toHaveBeenCalledTimes(1));
    expect(saveNotificationPreferences).toHaveBeenCalledWith({});
  });

  it('submits every switch the viewer changed', async () => {
    saveNotificationPreferences.mockResolvedValue({
      ok: true,
      data: savedSet({ newEpisode: false, globalInApp: false }),
    } satisfies ActionResult<NotificationPreferenceSet>);

    renderForm();

    fireEvent.click(screen.getByRole('switch', { name: 'New episodes' }));
    fireEvent.click(screen.getByRole('switch', { name: 'In-app notifications' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => expect(saveNotificationPreferences).toHaveBeenCalledTimes(1));
    expect(saveNotificationPreferences).toHaveBeenCalledWith({
      newEpisode: false,
      globalInApp: false,
    });
  });

  it('describes the browser push switch as an account-wide control', () => {
    renderForm();

    const description = screen.getByText(/browser push notifications/i);

    expect(description.textContent).toMatch(/account/i);
    expect(description.textContent).not.toMatch(/this browser/i);
  });
});
