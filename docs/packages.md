# Packages

## Core Packages

- `@openblog/config`: environment loading and validation with dotenv + Zod
- `@openblog/logger`: Pino logger with secret redaction and per-run log context (`workflowId`, `step`, `attempt`); logs go to stderr
- `@openblog/shared`: constants shared by apps (request-id header, product name)
- `@openblog/types`: small shared type aliases

## Domain Packages

- `@openblog/app`: composition root, `createApplication(config, overrides?)` builds the workflow from validated config and returns `{ workflow, info, dispose }`
- `@openblog/graph`: the article workflow and the ports it depends on (`LlmPort`, `PublishPort`, `TaxonomyPort`, `MemoryPort`)
- `@openblog/agents`: planner, writer, editor, SEO and classification agents, structured-output helper, deterministic quality rules
- `@openblog/providers`: OpenRouter and Ollama text generation with timeouts, retries and error classification
- `@openblog/storage`: persistence layer (SQLite connection, migrations, repositories, memory service)
- `@openblog/publishers`: Markdown and WordPress publishers, the publisher manager and taxonomy providers

## Storage Notes

`@openblog/storage` includes:

- database connection primitives
- migration runner for persistence tables
- repositories for workflows, steps, topics, prompts, and articles
- memory service with duplicate-topic detection

See [Memory and Persistence](memory.md) for details.

## Apps

- `apps/cli`: the supported interface (`generate`, `resume`, `approve`, `list`); also the Docker image's entry point
- `apps/server`: Fastify app exposing `GET /health` and `GET /version`
