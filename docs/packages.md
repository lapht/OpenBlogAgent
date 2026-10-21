# Packages

## Core Packages

- `@openblog/config`: environment loading and validation with dotenv + Zod
- `@openblog/logger`: Pino-based logger facade
- `@openblog/shared`: constants shared by apps (request-id header, product name)
- `@openblog/types`: small shared type aliases

## Domain Packages

- `@openblog/graph`
- `@openblog/agents`
- `@openblog/providers`
- `@openblog/storage`: persistence layer (SQLite connection, migrations, repositories, memory service)
- `@openblog/publishers`

## Storage Notes

`@openblog/storage` includes:

- database connection primitives
- migration runner for persistence tables
- repositories for workflows, topics, prompts, and articles
- memory service with duplicate-topic detection

See [Memory and Persistence](memory.md) for details.
