# DramaScan — International Drama & Movie Streaming Platform

**A modular monolith streaming platform for dramas and movies.**

---

## Documentation

Detailed project documentation is organized in the `docs/` directory. See
[`docs/README.md`](docs/README.md) for the documentation index and table of contents.

## Quick Start

Requirements: Node.js 24 LTS and npm.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

| Command | Purpose |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm run start` | Start the production server |

## Documentation Structure

- `AGENTS.md` — Global instructions for OpenCode and coding agents
- `docs/` — Complete project documentation directory (categories: project, architecture, requirements, decisions, development, implementation, future)
- `docs/requirements/REQUIREMENTS.md` — Approved product scope and future upgrade backlog
- `docs/architecture/ARCHITECTURE.md` — Modular monolith architecture, module boundaries, and communication rules
- `docs/development/CONVENTIONS.md` — Day-to-day coding, data, API, error, logging, testing, and migration conventions
- `docs/development/DATABASE.md` — Database schema conventions, ownership map, and migration practices
- `docs/development/API.md` — REST and Server Action contracts
- `docs/architecture/SECURITY.md` — Security principles, planned controls, and known limitations
- `docs/decisions/DECISIONS.md` — Finalized decisions and approved changes
- `docs/implementation/CHANGELOG.md` — Notable changes by release
- `docs/implementation/PROJECT_STATUS.md` — Single source of truth for prompt progress

---

The application foundation is implemented (Prompt 006). Product features are added
incrementally according to the [Detailed Micro-Prompt Development Pack](AGENTS.md).