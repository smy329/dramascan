/**
 * The playback event catalogue (Prompts 141, 142 / D-085).
 *
 * This file is pure: it holds the list of events the player reports and the
 * shape of a playback target, and nothing else. It carries no `server-only`
 * marker and no database import, so the player and the server may both import
 * it directly (D-049).
 *
 * The catalogue has one owner. Two copies drift: the player starts reporting an
 * event the server does not know, or the server stores an event the player
 * never sends. The browser and the server therefore read the same list.
 */

/** The event types the player reports. */
export const PLAYBACK_EVENT_TYPES = [
  'play',
  'play_pause',
  'seek',
  'completion',
  'exit',
] as const;

/** One playback event type. */
export type PlaybackEventType = (typeof PLAYBACK_EVENT_TYPES)[number];

/** What a playback event is about. */
export type PlaybackEventTarget =
  | { type: 'drama'; episodeId: string; dramaId: string }
  | { type: 'movie'; movieId: string };
