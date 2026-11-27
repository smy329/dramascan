import { sql } from 'drizzle-orm';

import { content_view_events, playback_analytics_events } from './schema';

/**
 * The effective target of an analytics row (D-032 §4).
 *
 * Every event row carries both a legacy `content_type`/`content_id` pair and a
 * typed `drama_id`/`movie_id` pair. The typed target wins whenever the two
 * disagree; the legacy pair is kept because it is the only evidence for a row
 * that cannot be placed.
 *
 * The expressions live in one file so that the grouping and the filter of a
 * query can never drift apart: a row is counted under the target it is
 * filtered by.
 */

/**
 * The content type of a view row.
 *
 * The typed target decides. A row that cannot be placed falls back to the
 * legacy type, which is the only evidence it carries.
 */
export const viewTargetTypeExpression = sql`case
  when ${content_view_events.drama_id} is not null then 'drama'
  when ${content_view_events.movie_id} is not null then 'movie'
  else ${content_view_events.content_type}
end`;

/**
 * The target id of a view row.
 *
 * A view event names a drama or a movie, so the legacy id is a title id and
 * is a safe fallback for a row that cannot be placed.
 */
export const viewTargetIdExpression = sql`coalesce(
  ${content_view_events.drama_id},
  ${content_view_events.movie_id},
  ${content_view_events.content_id}
)`;

/**
 * The content type of a playback row.
 *
 * The typed target decides. A row that cannot be placed falls back to the
 * legacy type, which is the only evidence it carries.
 */
export const playbackTargetTypeExpression = sql`case
  when ${playback_analytics_events.drama_id} is not null then 'drama'
  when ${playback_analytics_events.movie_id} is not null then 'movie'
  else ${playback_analytics_events.content_type}
end`;

/**
 * The target id of a playback row.
 *
 * The legacy `content_id` of a playback row may be an episode, so it is not a
 * fallback: a playback row that cannot be placed names no title, and the
 * operator reconciles it through the integrity report.
 */
export const playbackTargetIdExpression = sql`coalesce(
  ${playback_analytics_events.drama_id},
  ${playback_analytics_events.movie_id}
)`;

/**
 * The content id of a playback row.
 *
 * A playback row is about one episode or one movie. The typed columns say
 * which: the episode of a drama, the movie of a film. The legacy
 * `content_id` carries the same value for every row the application writes,
 * so it is only the fallback for a row that cannot be placed.
 */
export const playbackContentIdExpression = sql`coalesce(
  ${playback_analytics_events.episode_id},
  ${playback_analytics_events.movie_id},
  ${playback_analytics_events.content_id}
)`;
