
- **Prompt 028:** Analytics data models. src/modules/analytics/schema.ts defines guest_sessions, content_view_events, playback_analytics_events, nalytics_daily_aggregates, and search_events tables. Supports anonymous guest sessions, bounded playback event aggregation (no per-second writes), content view counting with 6-hour deduplication windows, daily aggregates, and search events. Keeps personal identifiers separate from anonymous analytics. UUID primary keys, snake_case naming, and soft delete. Typecheck: next typegen passes; build compiles. Lint, test (17 tests) pass.### Fixed

- **Prompt 004:** Corrected a self-referential instruction in `DATABASE.md` Â§9 so the
  change process says to update "this document's relationship/index notes."

### Removed

- Nothing removed.

### Security

- **Prompt 004:** Established security documentation requirements: server-side
  authorization as the sole authority, deny-by-default behavior, no secret exposure in
  logs/exports/errors, no server-side fetching of arbitrary administrator media URLs, and
  fail-closed rate limiting for sensitive operations. No control is implemented yet.
- **Prompt 019:** Database credentials remain server-only. Connection validation errors
  never include passwords, and pool errors are logged with connection URLs, password
  fragments, and URL credentials redacted.

---

## Release History

No releases yet. The first release entry is added when a deployable application exists.






