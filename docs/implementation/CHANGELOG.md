
- **Prompt 027:** Notification data models. src/modules/notifications/schema.ts defines push_subscriptions, 
otification_preferences, 
otifications, 
otification_deliveries, nnouncements, and dmin_notifications tables. Supports five event preferences (new_episode, new_drama_season, website_announcement, account_security mandatory, global_on_off), read/unread status, delivery tracking, and mandatory security notifications that cannot be disabled. UUID primary keys, snake_case naming, and soft-delete. Typecheck: next typegen passes; tsc --noEmit has overload resolution limitations with 7 tables in one file. Lint, build (CSS), and tests pass.### Fixed

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





