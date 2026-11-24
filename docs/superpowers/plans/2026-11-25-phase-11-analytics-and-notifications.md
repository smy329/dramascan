## Phase 11 — Analytics and Notifications (Prompts 139–154)

### Overview
This phase implements privacy-conscious analytics, view counting, playback metrics, an admin dashboard, date filters, refresh behavior, and a full notification system (in-app + browser push + preferences).

### Existing Infrastructure (already built)
- **Analytics schema**: `guest_sessions`, `content_view_events`, `playback_analytics_events`, `analytics_daily_aggregates`, `search_events`
- **Notifications schema**: `push_subscriptions`, `notification_preferences`, `notifications`, `notification_deliveries`, `announcements`, `admin_notifications`
- **Playback schema**: `subtitle_tracks`, `playback_failure_reports`
- **Read models**: `analytics/read-models/discovery.ts` (ranked content)
- **Migrations up to**: `0017_audit_log_nullable_entity.sql`

### Prompt-by-Prompt Plan

| Prompt | Title | Key Deliverables |
|--------|-------|-----------------|
| 139 | Anonymous Guest Session Tracking | `guest_sessions` table with anonymous `session_id`, `ip_hash` (hashed only), `country_code`; no fingerprinting; retention policy |
| 140 | Drama View Counting | Count one view per visitor per drama in 6-hour rolling window; deduplication via unique index on `(content_id, content_type, guest_session_id, viewed_hour_bucket)` where `deleted_at IS NULL`; applies to both authenticated user IDs and guest session IDs |
| 141 | Episode Playback Analytics | `playback_analytics_events` stores `play_pause`/`seek`/`completion`/`exit` events; bounded writes (not per-second); `guest_session_id` + `user_id` classification; hour bucket for aggregation |
| 142 | Watch Duration & Completion Metrics | Derived from `playback_analytics_events`: start events, actual watch duration, completion threshold; distinguish intentional starts from player opens; invalid/implausible data filtered |
| 143 | Analytics Aggregation | Daily aggregates (`analytics_daily_aggregates`) computed on-demand via short-lived maintenance commands; no Redis/pg-boss/persistent queue; indexes on `date`, `content_id`, `content_type`; aggregation queries are bounded |
| 144 | Admin Analytics Dashboard | Dashboard page for Analyst+ role; overview metrics, content performance, viewer activity, engagement trends; `Asia/Dhaka` timezone for display; UTC storage |
| 145 | Analytics Date Filters | Today/Yesterday/Last 7/30/90 Days/This Month/Last Month/custom; UTC storage, `Asia/Dhaka` display; range validation; prevent unrestricted queries |
| 146 | Dashboard Refresh Behavior | Operational metrics refresh at sensible interval (e.g., 30s); historical require manual refresh; last-updated timestamp displayed |
| 147 | Browser Push Infrastructure | Provider abstraction; prefer Firebase Cloud Messaging (free); native Web Push fallback; provider-specific code isolated |
| 148 | Notification Permission & Subscription | Browser permission request at appropriate time (not on first load); store subscriptions securely; handle denial/expire/unsubscribe |
| 149 | In-App Notifications | Bell icon + unread count + notification history + mark-read; deep links; per-user privacy |
| 150 | Notification Preferences | 5 preferences: new_episode, new_drama_season, website_announcement, account_security (mandatory), global_in_app/global_push on/off; essential security notifications always delivered |
| 151 | New Episode Notifications | On manual publish, find bookmarked drama users with `new_episode` preference; create in-app notifications; browser push where permitted; no recurring schedules |
| 152 | New Drama/Season Notifications | Same pattern for new dramas and seasons; avoid duplicates from retries; no email/scheduled |
| 153 | Website Announcement Notifications | Admin creates announcements; respect user preferences; no scheduled/recurring; respect preferences |
| 154 | Notification Delivery Safety & Cleanup | Handle delivery failures, expired subscriptions, duplicate triggers, invalid records; bounded operations; short-lived maintenance only; no persistent queue or email fallback |

### Files to Create/Modify
- `drizzle/0018_analytics_and_notifications.sql` — new migration adding any missing tables/columns/indexes
- `src/modules/analytics/schema.ts` — may need additions
- `src/modules/analytics/view-counts.ts` — view counting workflow
- `src/modules/analytics/aggregation.ts` — aggregation queries
- `src/modules/analytics/date-filters.ts` — date filter logic
- `src/modules/notifications/notifications.ts` — notification writes
- `src/modules/notifications/preferences.ts` — preference management
- `src/modules/notifications/subscriptions.ts` — push subscription management
- `src/modules/notifications/announcements.ts` — announcement management
- `src/modules/playback/analytics.ts` — playback event recording
- `src/workflows/admin/analytics-dashboard.ts` — dashboard workflow
- New UI components for dashboard, notification center, preference toggles
- `src/app/admin/analytics/page.tsx` — admin dashboard page
- Migration `0018` for any new tables/columns

### Privacy & Performance Principles
- Guest analytics completely separate from authenticated user activity
- No personal identifiers stored in event tables (anonymous `guest_session_id` only)
- `ip_hash` is a one-way hash, not raw IP
- Bounded database writes — aggregation on-demand, not per-second
- No Redis, pg-boss, persistent background workers
- All indexes for query performance; maintenance commands are short-lived
- Asia/Dhaka for display timezone; UTC for storage
- Essential security notifications (account_security) always mandatory, cannot be disabled