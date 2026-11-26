import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_VIEWER_TYPES,
  analyticsViewerType,
} from '@/modules/analytics/viewer-types';

/**
 * The request-time viewer classification (D-074).
 *
 * The event tables carry no personal identifier, so they cannot answer "was
 * this viewer signed in?" on their own. The `guest_sessions.user_id` column
 * cannot answer it either: the row is linked to the account when the viewer
 * signs in, so a later join reclassifies the events that were recorded before
 * the sign-in.
 *
 * The classification is therefore taken from the request and written on the
 * event row: it says what the viewer was *when the event happened*.
 */
describe('the viewer classification', () => {
  it('classifies an anonymous request as a guest', () => {
    expect(analyticsViewerType(null)).toBe('guest');
  });

  it('classifies a signed-in request as authenticated', () => {
    expect(analyticsViewerType('a3f0c2d4-1111-4222-8333-444455556666')).toBe('authenticated');
  });

  it('knows exactly two classifications', () => {
    expect(ANALYTICS_VIEWER_TYPES).toEqual(['guest', 'authenticated']);
  });
});
