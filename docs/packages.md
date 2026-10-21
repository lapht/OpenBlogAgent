# Packages

## Core Packages

- `@openblog/core`: contracts and dependency injection container scaffold
- `@openblog/config`: environment loading and validation with dotenv + Zod
- `@openblog/logger`: Pino-based logger facade
- `@openblog/sdk`: single public API surface

## Domain Packages

- `@openblog/graph`
- `@openblog/agents`
- `@openblog/providers`
- `@openblog/storage`: persistence layer (SQLite connection, migrations, repositories, memory service)
- `@openblog/publishers`
- `@openblog/tools`

## Storage Notes

`@openblog/storage` includes:

- database connection primitives
- migration runner for persistence tables
- repositories for workflows, topics, prompts, and articles
- memory service with duplicate-topic detection

See [Memory and Persistence](memory.md) for details.
