
- **Prompt 026:** Ratings and reviews data models. src/modules/reviews/schema.ts defines atings, eviews, eview_reactions, and eview_reports tables. Enforces one active rating/review per user per drama with unique constraints, supports review editing with preserved timestamps, and multiple reports from different users. Standard UUID primary keys, snake_case naming, and inline timestamptz. Typecheck, lint, test, build: all passing.### Fixed

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




