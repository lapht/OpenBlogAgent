# OpenBlogAgent

OpenBlogAgent is a TypeScript monorepo foundation for a future open-source blog automation platform.

This repository intentionally contains only architecture, contracts and infrastructure.
No business logic, AI workflow or provider runtime implementation is included.

## Goals

- Production-ready project baseline
- Clean Architecture + SOLID boundaries
- Dependency Injection ready with `tsyringe`
- Extensible plugin-oriented API via `@openblog/sdk`

## Monorepo Layout

```text
apps/
  server/
  dashboard/
  cli/
packages/
  core/
  graph/
  agents/
  providers/
  storage/
  publishers/
  tools/
  logger/
  shared/
  types/
  config/
  sdk/
docs/
docker/
scripts/
examples/
.github/
```

## Server Endpoints

- `GET /health`
- `GET /version`

## Quick Start

1. Install dependencies:

  ```bash
  npm install
  ```

2. Configure environment:

	```bash
	cp .env.example .env
	```

3. Run quality checks:

  ```bash
  npm run lint
  npm run test
  npm run build
  ```

4. Run local server:

  ```bash
  npm run dev
  ```

## Tooling

- Node.js LTS + TypeScript
- npm Workspaces
- Fastify
- Zod + dotenv
- Pino
- tsyringe
- Vitest
- ESLint + Prettier
- Husky + Commitlint + lint-staged
- GitHub Actions
- Docker

## Documentation

See `docs/` for architecture, package boundaries, development and plugin notes.
