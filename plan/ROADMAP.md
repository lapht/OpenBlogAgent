# OpenBlogAgent Roadmap

Legend: `[x]` done, `[~]` partial, `[ ]` planned. Detailed work items live in the GitHub milestones (M1 Trustworthy baseline → M6 Operational readiness, then Post-MVP). See `docs/CURRENT_STATE.md` for what is verified.

## Vision

Build a robust, open and extensible platform for automated blog operations.

## Phase 1 - Foundation (Completed)

- [x] TypeScript monorepo with npm workspaces
- [x] Core contracts package
- [x] Dependency injection bootstrap (`tsyringe`; removed later, see ADR-009)
- [x] Fastify API skeleton (`/health`, `/version`)
- [x] Environment configuration (`dotenv` + `zod`)
- [x] Pino logger facade
- [x] CI workflow (`.github/workflows/ci.yml`: build, deps check, typecheck, lint, format, test)
- [x] Code quality baseline (ESLint, Prettier, Husky, Commitlint)
- [x] Docker baseline
- [x] Open-source governance docs

## Phase 2 - Runtime Contracts

- [x] Unified typed provider contract with timeouts and error classification (OpenRouter and Ollama)
- [ ] Expand graph runtime contracts and execution abstractions
- [ ] Finalize plugin contract surface in SDK

## Phase 3 - Infrastructure Adapters

- [x] SQLite memory storage (`packages/storage`; transactional, versioned migrations)
- [x] Markdown publisher (safe file names, no silent overwrite)
- [~] WordPress publisher (idempotent, drafts first, taxonomy resolution; tested with mocked HTTP only, never against a real site)
- [ ] Ghost publisher — **not implemented**: `GhostPublisher` only prepares a payload and makes no HTTP call
- [ ] Tool adapters and capability registration model

## Phase 4 - Orchestration

- [ ] Workflow assembly model
- [ ] Agent role composition model
- [~] Execution lifecycle and observability (statuses, resume, run-correlated logs done; metrics and tracing planned)

## Phase 5 - Product Surface

- [ ] Dashboard implementation
- [x] CLI (`generate`, `resume`, `approve`, `list`; `--dry-run`, `--json`; documented exit codes)
- [ ] Plugin developer examples

## Phase 6 - Production Readiness

- [ ] Release automation
- [ ] Versioning policy and package publishing
- [ ] Security hardening and SLO monitoring
