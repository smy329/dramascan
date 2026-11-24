import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  OPTIONAL_EVENT_PREFERENCES,
  isDeliveryAllowed,
  type NotificationPreferenceSet,
} from '@/modules/notifications/delivery-rules';

/**
 * Notification delivery rule coverage (Prompt 150).
 *
 * The rule is a conjunction: a notification is delivered when the global
 * switch of its channel is on **and** the event preference is on. Account and
 * security notifications are mandatory and are never withheld by a switch.
 */

function preferences(overrides: Partial<NotificationPreferenceSet> = {}): NotificationPreferenceSet {
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...overrides };
}

describe('isDeliveryAllowed', () => {
  it('allows a notification when both switches are on', () => {
    expect(isDeliveryAllowed(preferences(), 'new_episode', 'in_app')).toBe(true);
    expect(isDeliveryAllowed(preferences(), 'new_episode', 'push')).toBe(true);
  });

  it('refuses the event when its preference is off', () => {
    const set = preferences({ newEpisode: false });

    expect(isDeliveryAllowed(set, 'new_episode', 'in_app')).toBe(false);
    expect(isDeliveryAllowed(set, 'new_episode', 'push')).toBe(false);
  });

  it('refuses the channel when its global switch is off', () => {
    const set = preferences({ globalInApp: false });

    expect(isDeliveryAllowed(set, 'new_episode', 'in_app')).toBe(false);
    expect(isDeliveryAllowed(set, 'new_episode', 'push')).toBe(true);
  });

  it('keeps the two global switches independent', () => {
    const set = preferences({ globalPush: false });

    expect(isDeliveryAllowed(set, 'new_episode', 'in_app')).toBe(true);
    expect(isDeliveryAllowed(set, 'new_episode', 'push')).toBe(false);
  });

  it('never withholds an account security notification', () => {
    const set = preferences({
      accountSecurity: false,
      globalInApp: false,
      globalPush: false,
    });

    expect(isDeliveryAllowed(set, 'account_security', 'in_app')).toBe(true);
    expect(isDeliveryAllowed(set, 'account_security', 'push')).toBe(true);
  });

  it('keeps the five event preferences independent', () => {
    const set = preferences({
      newEpisode: false,
      newDrama: false,
      newDramaSeason: false,
      websiteAnnouncement: false,
    });

    expect(isDeliveryAllowed(set, 'new_episode', 'in_app')).toBe(false);
    expect(isDeliveryAllowed(set, 'new_drama', 'in_app')).toBe(false);
    expect(isDeliveryAllowed(set, 'new_drama_season', 'in_app')).toBe(false);
    expect(isDeliveryAllowed(set, 'website_announcement', 'in_app')).toBe(false);
  });

  it('offers a switch for every optional event and none for security', () => {
    expect(OPTIONAL_EVENT_PREFERENCES).toEqual([
      'new_episode',
      'new_drama',
      'new_drama_season',
      'website_announcement',
    ]);
    expect(OPTIONAL_EVENT_PREFERENCES).not.toContain('account_security');
  });
});
