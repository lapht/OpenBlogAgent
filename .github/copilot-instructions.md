## OpenBlogAgent Agent Instructions

### Graphify (optional)

For any question about repo architecture, structure, component relationships, or where to change code:

1. Run `graphify query "<question>"` first when `graphify-out/graph.json` exists locally (it is generated and not tracked in git).
2. Use `graphify path "<A>" "<B>"` for dependency/relationship tracing.
3. Use `graphify explain "<concept>"` for focused concept summaries.

Use `graphify-out/wiki/index.md` for broad navigation if present. Read `graphify-out/GRAPH_REPORT.md` only when query/path/explain is not enough.

If no local graph exists, read the code and `docs/` directly.

### Canonical Commands

Treat scripts in [package.json](../package.json) as source of truth.

- Install: `npm install`
- Build all: `npm run build`
- Build workflow subset: `npm run build`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Test: `npm run test`
- Test watch: `npm run test:watch`
- Dev server: `npm run dev`

### Monorepo Boundaries

- [apps](../apps): entrypoints (`cli`, `server`, `dashboard`).
- [packages](../packages): reusable modules and domain implementations.
- Keep clean-architecture direction from [docs/architecture.md](../docs/architecture.md): avoid introducing inward dependencies from contracts/core toward outer implementation layers.
- For extensions/plugins, depend on [packages/sdk](../packages/sdk) (see [docs/plugins.md](../docs/plugins.md)), not internal package internals.

### Publishing Separation

Follow [docs/publishing.md](../docs/publishing.md):

- Agents generate content.
- Publisher layer selects destination, validates payload, and publishes.
- New publisher work must include interface implementation, registration, and config schema keys.

### Testing And Quality

- Run `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` before declaring work complete.
- Keep or add tests in `tests/**/*.test.ts` (Vitest Node environment; see [vitest.config.ts](../vitest.config.ts)).
- Follow contribution and commit conventions in [CONTRIBUTING.md](../CONTRIBUTING.md).

### Link-First References

Prefer linking to existing docs rather than duplicating them:

- [README.md](../README.md)
- [docs/development.md](../docs/development.md)
- [docs/packages.md](../docs/packages.md)
- [docs/architecture.md](../docs/architecture.md)
- [docs/plugins.md](../docs/plugins.md)
- [docs/publishing.md](../docs/publishing.md)
