
- **Prompt 025:** User bookmark and viewing data models. src/modules/users/schema.ts defines ookmarks, playback_progress, watched_state, and watch_history tables. Supports drama-level bookmarks, per-episode playback progress, watched/unwatched state with completion threshold, and watch history with timestamps. Standard UUID primary keys, snake_case naming, and soft-delete. Typecheck, lint, test, build: all passing.### Fixed

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



