# Architecture Decisions

**Project:** DramaScan — International Drama & Movie Streaming Platform  
**Version:** 1.0  
**Date:** 2026-11-08  

This document records architecture decisions approved by the user or established by the specification. These decisions define the internal shape of the single Next.js deployable and must not be silently contradicted.

---

## D-008 — Modular Monolith Shape and Module Boundaries

**Date:** 2026-11-08  
**Status:** Approved by user  
**Resolves:** Prompt 003  

**Decision:** The application is a single-deployable Next.js modular monolith with feature modules over a shared platform layer, plus an explicit application-level workflow layer.

- `src/platform/` is infrastructure (DB, config, errors, logging, rate limiting, cache, HTTP mapping) and imports no modules.
- `src/modules/<domain>/` owns its Drizzle schema, repository, services, queries, and validation, and exposes exactly one public `index.ts`.
- Modules are assigned to fixed layers: platform; `auth`; `authorization`; `content`/`users`/`playback`/`reviews`; `moderation`/`notifications`/`analytics`; `administration`/`maintenance`.
- `src/workflows/` coordinates cross-module operations and owns shared transactions.
- `src/app/` contains entrypoints only; `src/components/` is client-safe and imports no module; `src/lib/contracts/` holds client-safe DTOs.
- `src/db/` is a composition root outside the layer stack: it assembles module schemas and creates the Drizzle instance, and is the only place allowed to import module `schema.ts` files.

**Consequences:**

- Upward imports and unlisted same-layer imports are forbidden. The allowed matrix is in `ARCHITECTURE.md` §7.
- Only four same-layer edges are permitted: `users → content`, `playback → content`, `reviews → content`, `administration → maintenance`.
- `auth` and `authorization` are separate modules. Authorization may depend on authentication; authentication never depends on authorization.
- Architecture rules are enforced by ESLint boundary rules, `import/no-cycle`, TypeScript strict mode, and CI.
- Adding a module, dependency, or exception requires a new decision entry and an `ARCHITECTURE.md` update.

---

## D-009 — Cross-Module Orchestration Through Workflows

**Date:** 2026-11-08  
**Status:** Approved by user  
**Resolves:** Prompt 003  

**Decision:** Modules never import another module to trigger a side effect. Cross-module operations are coordinated by a thin workflow in `src/workflows/` that calls each participating module's public API independently with explicit, validated payloads and a trusted actor context. Workflows own sequencing and transaction boundaries, not domain rules. Single-module operations remain in that module's service; no workflow is created for them.

**Consequences:**

- `content` never imports `notifications`; `workflows/publish-content` calls both.
- `playback` never imports `analytics`; `workflows/save-playback-progress` calls both.
- No event bus, broker, queue, outbox, or background worker is introduced.
- Post-commit effects (cache invalidation, push dispatch) run after commit without an automatic retry loop.

---

## D-010 — Entrypoint Allocation: Server Components, Server Actions, REST

**Date:** 2026-11-08  
**Status:** Approved by user  
**Resolves:** Prompt 003  

**Decision:** Server Components perform all public and admin page reads through module query services. Server Actions perform form submissions and mutations through the relevant service or workflow. REST route handlers exist only for client-driven reads/polling, analytics beacons, exports/downloads, Better Auth, health checks, OpenAPI, and explicitly approved external integrations. Server Actions and REST call the same services and guards; no parallel business logic is permitted.

**Consequences:**

- Route handlers contain HTTP adaptation only; domain rules stay in services and workflows.
- Every REST endpoint has an equivalent authorization path to its Server Action counterpart.
- Query services enforce visibility, ownership, and resource-level access, not only entrypoints.
- The REST allowlist is fixed in `ARCHITECTURE.md` §9.2; expanding it requires a decision.

---

## D-011 — Data Ownership and Approved Cross-Module Reads

**Date:** 2026-11-08  
**Status:** Approved by user  
**Resolves:** Prompt 003  

**Decision:** Each module exclusively owns and writes its tables. Cross-module reads normally use the owner's public query API. Cross-module JOINs are permitted only in explicitly documented read-only locations: `analytics/read-models/` (reporting), `administration/read-models/` (operational summaries), `users/read-models/` (admin user listing over `auth` identity), and the moderation queue query. `analytics` is the reporting module but is not a mandatory intermediary for watch-page or admin operational reads.

**Consequences:**

- No module, workflow, or script writes another module's tables; workflows call each owner's service inside a shared transaction.
- Cross-module foreign keys do not grant write permission.
- Destructive cleanup is explicit in `workflows/permanently-delete-content`, not cross-module cascades.
- Sensitive projections (such as video source URLs) are returned only by the owning module's restricted queries.

---

## D-012 — Transaction Coordination

**Date:** 2026-11-08  
**Status:** Approved by user  
**Resolves:** Prompt 003  

**Decision:** A workflow that requires atomicity opens one PostgreSQL transaction through `platform/db/transaction.ts` and passes the same `DbExecutor` explicitly to every participating module operation. Repositories and services accept the executor and never open or commit a competing transaction. Any thrown error rolls back; partial writes are not allowed for all-or-nothing operations.

**Consequences:**

- Cross-module atomic operations (publish, source replacement, permanent deletion, conversion, role changes, import apply) use a single shared transaction.
- Post-commit effects run after commit; failures are recorded without an automatic retry loop.
- No distributed transactions, two-phase commit, eventual consistency, outbox, or queue is introduced.

---

## Architectural Drivers (Fixed)

These are fixed by the specification and are not open for reinterpretation:

| Driver | Consequence |
|---|---|
| Single Next.js App Router deployment, low-RAM production server | One process, one PostgreSQL database, no service split |
| PostgreSQL + Drizzle ORM | One connection pool; transactions are local and cheap |
| Better Auth, Google OAuth only | Authentication is a bounded integration, not a general identity platform |
| Server-side authorization is the security authority | Guards at every entrypoint and re-checks inside services |
| Direct external HTTPS MP4 playback | No media pipeline, no storage service, no proxy module |
| No Docker, Redis, queues, workers, SSE, WebSockets | No event bus, no asynchronous cross-module consistency |
| Short-lived systemd maintenance commands | Maintenance is a CLI entrypoint, not a runtime service |
| Preserve data across edits, moves, conversions, source replacement | Transactions and explicit ownership; no cross-module table writes |
| Future extraction must remain possible | Modules own their tables and expose narrow public APIs |
| Single deployable, shared PostgreSQL, no excluded infrastructure | One runtime datastore; no cache server, broker, or secondary store |