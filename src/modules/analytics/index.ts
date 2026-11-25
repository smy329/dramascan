/**
 * Analytics module public API (server-only).
 *
 * The single public surface for the analytics domain. Callers get the
 * read models they are allowed to use, not the module's schema or inner
 * helpers.
 */

import 'server-only';

export { getContentViewCount } from './view-counts';

export {
  DISCOVERY_PAGE_SIZE_DEFAULT,
  DISCOVERY_PAGE_SIZE_MAX,
  DISCOVERY_SORTS,
  listHighestRatedContent,
  listMostViewedContent,
  listPopularContent,
  listRankedContent,
  listTrendingContent,
} from './read-models/discovery';

export type {
  DiscoveryQuery,
  DiscoverySort,
  RankedContent,
  RankedContentPage,
  RankedContentType,
  TrendingPin,
} from './read-models/discovery';

export {
  DASHBOARD_ROW_LIMIT,
  getAnalyticsLastUpdated,
  getAnalyticsOverview,
  listContentPerformance,
  listEngagementTrend,
  listViewerActivity,
} from './read-models/dashboard';

export type {
  AnalyticsOverview,
  ContentPerformanceRow,
  EngagementTrendPoint,
  ViewerActivityRow,
} from './read-models/dashboard';

export {
  DATE_RANGE_PRESETS,
  DATE_RANGE_PRESET_LABELS,
  DASHBOARD_TIME_ZONE,
  DASHBOARD_UTC_OFFSET_MINUTES,
  MAX_RANGE_DAYS,
  addDays,
  buildDateRange,
  daysBetween,
  dhakaDateString,
  eachDay,
  endOfDhakaDay,
  endOfMonth,
  isCalendarDay,
  isDateRangePreset,
  resolveDateRange,
  startOfDhakaDay,
  startOfMonth,
  utcHourBucket,
} from './date-filters';

export type { DateRange, DateRangePreset } from './date-filters';

export {
  GUEST_SESSION_COOKIE,
  GUEST_SESSION_MAX_AGE_SECONDS,
  ensureGuestSessionId,
  generateGuestSessionId,
  readGuestSessionId,
} from './guest-session';

export { resolveAnalyticsVisitor } from './visitor';

export type { AnalyticsVisitor } from './visitor';

export { VIEW_DEDUP_WINDOW_HOURS, recordContentView } from './view-counting-workflow';

export type { ContentViewResult } from './view-counting-workflow';

export {
  PLAYBACK_EVENT_TYPES,
  getPlaybackAnalyticsSummary,
  recordPlaybackEvent,
} from './playback-analytics-workflow';

export type {
  PlaybackEventResult,
  PlaybackEventTarget,
  PlaybackEventType,
} from './playback-analytics-workflow';

export {
  MAX_PLAYBACK_POSITION_SECONDS,
  MAX_PLAYBACK_WATCH_SECONDS,
  PLAYBACK_WATCH_DURATION_TOLERANCE_SECONDS,
  clampPlaybackEvent,
} from './playback-plausibility';

export type {
  PlaybackPlausibility,
  PlaybackPlausibilityInput,
} from './playback-plausibility';

export { aggregateDailyAnalytics, aggregateDateRange, aggregateToday } from './aggregation-workflow';

export {
  ANALYTICS_EVENT_RETENTION_DAYS,
  ANALYTICS_RETENTION_BATCH_SIZE,
  ANALYTICS_RETENTION_MAX_BATCH_SIZE,
  GUEST_SESSION_RETENTION_DAYS,
  purgeExpiredGuestData,
} from './retention';

export type {
  AnalyticsRetentionOptions,
  AnalyticsRetentionResult,
} from './retention';

export {
  analyticsContentTypeSchema,
  analyticsPlaybackEventTypeSchema,
  analyticsPlaybackInputSchema,
  analyticsViewInputSchema,
  parseAnalyticsPlaybackInput,
  parseAnalyticsViewInput,
} from './analytics-inputs';

export type {
  AnalyticsPlaybackInput,
  AnalyticsViewInput,
} from './analytics-inputs';

export { isPublicAnalyticsTarget } from './analytics-targets';
