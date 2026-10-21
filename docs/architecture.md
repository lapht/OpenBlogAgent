# Architecture Overview

OpenBlogAgent follows Clean Architecture principles:

- `apps/`: entry points (server, cli)
- `packages/`: reusable modules and contracts
- Wiring is explicit constructor/factory injection (no DI container); see ADR-009 in `decisions`

Dependencies flow from outer layers to contracts, never to concrete business logic.

The workflow in `packages/graph` depends on ports (`LlmPort`, `PublishPort`, `TaxonomyPort`, `MemoryPort`); `packages/app` (`createApplication`) wires the concrete adapters from config; `apps/cli` and `apps/server` are thin entry points (see ADR-010, ADR-011).

## Runtime shape

```text
CLI (apps/cli) --> createApplication (packages/app) --> workflow (packages/graph)
                                                          |-- agents  -> LlmPort    -> providers (OpenRouter, Ollama)
                                                          |-- publish -> PublishPort -> publishers (Markdown, WordPress)
                                                          `-- memory  -> MemoryPort  -> storage (SQLite)
```

A run is the LangGraph `planner → writer → editor → seo → duplicate_check → quality → classification → publisher` (the quality node can loop back to the writer a bounded number of times). Every step's output is stored, which is what lets `resume` skip finished steps and `approve` publish a stored article later. The CLI is the supported interface; the Fastify server only exposes `/health` and `/version`. Logs are structured and correlated by `workflowId` (ADR-024). See [Operations](operations.md) for statuses and recovery, and [Decisions](DECISIONS.md) for the reasoning.
