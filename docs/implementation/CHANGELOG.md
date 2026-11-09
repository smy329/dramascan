
- **Prompt 024:** Categories and platforms data models. src/modules/content/schema.ts defines categories and platforms tables with unique slugs and names, plus many-to-many join tables drama_categories, drama_platforms, movie_categories, movie_platforms. Reusable taxonomy entities enable content classification across drama and movie types. Standard timestamps and snake_case naming. Typecheck, lint, test, build: all passing.### Fixed

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


