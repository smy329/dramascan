# Domain Modules

Each domain module is self-contained and exposes exactly one public surface:
`index.ts`.

- Create a module directory only when its implementation begins. Do not add empty
  module directories or placeholder types ahead of time. A module's data model is part
  of its implementation: the schema-structure prompt may create `schema.ts` alone, and
  `index.ts` is added when the module gains a public API.
- Keep `schema.ts`, `service.ts`, `queries.ts`, `validation.ts`, and `repository.ts`
  owned by the module; everything except `index.ts` is private to that module.
- Domain-specific types belong inside the owning module, not in
  `src/lib/contracts/`.
- Cross-module imports target only `<module>/index.ts`.
- `index.ts` is server-only. Types or schemas that must reach the browser belong in
  `src/lib/contracts/`.

See `docs/architecture/ARCHITECTURE.md` and
`docs/development/directory-conventions.md` for the full boundary rules.
