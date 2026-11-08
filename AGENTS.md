# AI DRAMA STREAMING PLATFORM
## Complete Detailed Micro-Prompt Development Pack
**Version:** Detailed Edition  
**Total prompts:** 220  
**Development approach:** Dependency-ordered, independently executable micro-tasks  
**Primary objective:** Build a reliable, maintainable, scalable international drama and movie streaming platform while keeping the initial production architecture resource-efficient.

---

# PART 1 — GLOBAL INSTRUCTIONS FOR OPENCODE

## 1.1 How to execute this pack

Follow the prompts in numerical order. Each prompt is an independent development task, but it may depend on infrastructure or functionality implemented by earlier prompts.

For every prompt:

1. Inspect the existing project before making changes.
2. Understand the existing architecture, conventions, database schema, and completed work.
3. Implement only the functionality described in that prompt.
4. Do not unnecessarily rewrite working code or replace established architectural decisions.
5. Add appropriate validation, error handling, security controls, and tests.
6. Run relevant tests, type checks, linting, and build checks.
7. Fix errors introduced by the implementation.
8. Update the project progress documentation with completed work, changed files, tests, and any remaining limitations.
9. Stop after completing the assigned prompt. Do not automatically begin the next prompt.

If a requirement is ambiguous or a decision has not been specified, ask the user before making a consequential architectural or product decision. Do not repeatedly ask questions whose answers are already defined in this specification.

## 1.2 Finalized technology stack

Use the following stack unless a specific future upgrade is explicitly approved.

| Area | Technology |
|---|---|
| Application | Next.js full-stack |
| Framework | Next.js App Router |
| Language | TypeScript |
| UI | React Server Components by default |
| Styling | Tailwind CSS |
| UI components | shadcn/ui |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Authentication | Better Auth |
| Social login | Google OAuth only |
| Video player | Vidstack |
| Forms | React Hook Form |
| Validation | Zod |
| Client-side server state | TanStack Query where needed |
| Testing | Vitest and Playwright |
| Logging | Pino structured JSON |
| Search | PostgreSQL full-text search and trigram indexes |
| API | Hybrid Server Actions and REST |
| API documentation | OpenAPI/Swagger |
| Reverse proxy | Nginx |
| Process management | systemd |
| OS | Ubuntu 24.04 LTS |
| CI/CD | GitHub Actions |

## 1.3 Initial architecture restrictions

The initial implementation must remain a lightweight modular monolith.

Do not introduce:

- Docker or Docker Compose.
- Redis.
- Persistent background workers.
- pg-boss or another job queue.
- A separate worker service.
- Sharp or server-side image optimization.
- Next.js server-side image optimization.
- Video uploads or video staging.
- Video processing or transcoding.
- Video proxying, relaying, or rehosting.
- Odysee or LBRY APIs, SDKs, authentication, claim IDs, or upload workflows.
- SSE or WebSockets without an explicitly approved requirement.
- External object storage or CDN integration.
- Email notification infrastructure.
- Sentry, Prometheus, or Grafana in the initial version.
- Scheduled content publishing.
- Recurring episode-release schedules.
- Scheduled announcements.
- Complex job orchestration.

Use short-lived systemd-triggered maintenance commands only where specified. These are not persistent background workers or a job queue.

## 1.4 Mandatory video-source architecture

The administrator must enter a public, direct HTTPS MP4 streaming URL into an episode's video-source field.

The system must:

- Store the supplied URL in PostgreSQL.
- Validate the URL's syntax and HTTPS scheme.
- Provide a browser-based playback preview.
- Verify actual playback rather than assuming that an `.mp4` extension proves compatibility.
- Use Vidstack to play the external source directly in the viewer's browser.
- Require the external host to support appropriate CORS and byte-range requests for browser playback and seeking.
- Avoid unrestricted server-side fetching of administrator-supplied URLs.
- Avoid a backend video proxy.
- Make no claim that the source URL is hidden or protected from viewers.
- Allow manual source replacement after a successful preview and administrator confirmation.
- Reset progress for the affected episode after a confirmed replacement while preserving watch-history records and their historical dates.

There must be no Odysee/LBRY integration and no video-file upload infrastructure in the initial version.

## 1.5 Code quality requirements

- Use strict TypeScript.
- Keep domain logic separate from UI components.
- Use server-side authorization as the security authority.
- Validate all untrusted input on the server.
- Use database transactions for critical multi-record operations.
- Use explicit error handling.
- Avoid duplicated business logic.
- Avoid oversized components and unnecessarily complex abstractions.
- Use indexes appropriate to real query patterns.
- Preserve existing data and relationships during migrations.
- Never silently discard user data.
- Do not use mock data in production functionality.
- Do not mark a feature complete merely because its UI renders.

## 1.6 Documentation and completion tracking

Maintain the following project documentation:

- `docs/PROJECT_STATUS.md` — overall project progress.
- `docs/ARCHITECTURE.md` — implemented architecture and important design decisions.
- `docs/DATABASE.md` — schema and relationship documentation.
- `docs/API.md` — REST API documentation and conventions.
- `docs/SECURITY.md` — security decisions and known limitations.
- `docs/CHANGELOG.md` — significant implementation changes.
- `docs/DECISIONS.md` — finalized decisions and approved changes.

Create these files when appropriate during the foundation phase. Do not repeatedly create duplicate documentation files.

---

## 1.7 Documentation Discovery for Coding Agents

When starting any project task, coding agents must follow this discovery procedure:

1. Read `AGENTS.md` before starting any project task to understand global instructions and the documentation discovery rules.
2. Read `docs/README.md` to discover the documentation structure and locate the relevant documentation categories.
3. Read the relevant architecture, requirements, and technical decision documents before modifying related functionality. The authoritative documents are:
   - `docs/architecture/ARCHITECTURE.md` for module boundaries and dependency direction
   - `docs/requirements/REQUIREMENTS.md` for product scope and feature requirements
   - `docs/decisions/DECISIONS.md` for approved decisions (D-000 through D-017+)
   - `docs/development/CONVENTIONS.md` for day-to-day coding, data, API, error, logging, testing, and migration rules
4. Read the current `PROJECT_STATUS.md` to understand the current prompt, completed work, changed files, tests, unresolved issues, and the next task.
5. Inspect the relevant module's `index.ts` (its only public API), then its service/query/repository files, then its tests.
6. Search before creating. Use `grep`/`glob` to find an existing helper, service, type, or convention.
7. Run the current checks (typecheck, lint, tests) before changing behavior, so pre-existing failures are distinguishable from new ones.
8. Preserve working code, established architecture, public APIs, and user data unless the assigned prompt explicitly changes them.
9. Update `docs/PROJECT_STATUS.md`, and `docs/CHANGELOG.md`/`docs/DECISIONS.md` when applicable, before declaring the prompt complete.
10. Never invent, contradict, or silently change previously approved decisions. Treat the initial implementation scope and future upgrade backlog as separate boundaries.
11. Use the canonical documentation locations (`docs/`) rather than creating new documentation files randomly in the project root. If a new document is needed, add it to the appropriate subfolder in `docs/` and update `docs/README.md`.

If the requested behavior is not established by the specification or an active decision, ask. Do not repeatedly ask questions whose answers are already defined in this specification.

## Git and GitHub Version Control Workflow

### Mandatory Rule

After successfully completing every individual micro-prompt, save the completed changes in Git and push them to the configured GitHub repository.

This workflow applies to all implementation prompts, documentation prompts, configuration changes, bug fixes, and approved project modifications.

### Required Workflow After Every Prompt

1. Finish the requested implementation.
2. Review all changed and newly created files.
3. Inspect `git status` and review the complete relevant `git diff`.
4. Check for accidental changes, unrelated modifications, debug code, temporary files, credentials, API keys, `.env` files, and other sensitive information.
5. Run the relevant tests, lint checks, TypeScript checks, and build checks when applicable.
6. Fix issues caused by the current implementation before considering the prompt complete.
7. Stage only the intended project changes.
8. Create one meaningful Git commit for the completed micro-prompt.
9. Push that commit to the configured GitHub remote and current working branch.
10. Verify that the push succeeded.
11. Report the result to the user.

### Commit Message Convention

Use clear conventional commit messages.

Examples:

- `docs: organize project documentation`
- `feat: implement Google OAuth authentication`
- `feat: add drama management`
- `fix: resolve episode ordering issue`
- `refactor: improve database repository structure`
- `test: add playback progress tests`
- `chore: configure production environment`

Include the micro-prompt number in the commit message when practical.

Example:

`feat: implement Google OAuth authentication (Prompt 030)`

### Git Safety Rules

- Never commit `.env` files, secrets, credentials, private keys, access tokens, or other sensitive information.
- Check `.gitignore` before staging files.
- Never use `git push --force` or rewrite shared Git history.
- Never run destructive Git commands such as `git reset --hard`, `git clean -fd`, or mass file deletion without explicit user approval.
- Never overwrite or discard unrelated user changes.
- Do not amend previous commits to hide the history of completed prompts.
- Do not commit generated build artifacts, temporary files, or unnecessary dependencies.
- Preserve the existing branch and remote configuration unless the user explicitly approves a change.
- Never claim that a commit or push succeeded without verifying the command result.

### Existing Changes and Failures

- Before committing, identify whether uncommitted changes existed before the current prompt.
- Do not include unrelated user changes in the current prompt's commit.
- If tests, lint, type checking, or build fail, investigate and fix failures caused by the current work.
- If an unresolved issue prevents safe completion, do not falsely report success. Explain the issue and request approval before pushing an unsafe state.
- If GitHub authentication or network connectivity prevents pushing, preserve the local commit and clearly report that the push remains incomplete.
- Never silently skip the GitHub push step.

### Final Report After Every Prompt

Provide:

- Prompt number and title.
- Implementation status.
- Tests and verification results.
- Commit message.
- Commit hash.
- GitHub push status.
- Any unresolved issues.

**Completion requirement:** A micro-prompt is considered fully completed only when its implementation has been verified, its changes have been committed, and its commit has been successfully pushed to the configured GitHub branch.

