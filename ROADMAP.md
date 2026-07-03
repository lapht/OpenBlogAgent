# OpenBlogAgent Roadmap

## Vision

Build a robust, open and extensible platform for automated blog operations.

## Phase 1 - Foundation (Completed)

- [x] TypeScript monorepo with npm workspaces
- [x] Core contracts package
- [x] Dependency injection bootstrap (`tsyringe`)
- [x] Fastify API skeleton (`/health`, `/version`)
- [x] Environment configuration (`dotenv` + `zod`)
- [x] Pino logger facade
- [x] CI workflow (lint, build, test)
- [x] Code quality baseline (ESLint, Prettier, Husky, Commitlint)
- [x] Docker baseline
- [x] Open-source governance docs

## Phase 2 - Runtime Contracts

- [ ] Expand provider contracts (OpenRouter, Ollama)
- [ ] Expand graph runtime contracts and execution abstractions
- [ ] Finalize plugin contract surface in SDK

## Phase 3 - Infrastructure Adapters

- [ ] Storage adapters (database, cache, memory)
- [ ] Publisher adapters (WordPress, Ghost, Markdown)
- [ ] Tool adapters and capability registration model

## Phase 4 - Orchestration

- [ ] Workflow assembly model
- [ ] Agent role composition model
- [ ] Execution lifecycle and observability contracts

## Phase 5 - Product Surface

- [ ] Dashboard implementation
- [ ] CLI implementation
- [ ] Plugin developer examples

## Phase 6 - Production Readiness

- [ ] Release automation
- [ ] Versioning policy and package publishing
- [ ] Security hardening and SLO monitoring
