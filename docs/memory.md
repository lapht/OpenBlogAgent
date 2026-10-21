# Memory and Persistence

This document explains how persistent memory works in OpenBlogAgent.

## Goals

- Persist workflow executions across runs.
- Persist planner and writer prompts for auditability.
- Persist generated article artifacts and publish metadata.
- Detect duplicate topics without coupling agents to database code.

## Design Constraints

- Agents never read or write the database directly.
- Persistence is handled in `@openblog/storage` through repositories and `MemoryService`.
- Workflow orchestration in `@openblog/graph` interacts with memory through an interface, not a DB client.

## Components

### Database Layer

- `SQLiteDatabaseConnection` creates and manages the SQLite connection.
- `runStorageMigrations` creates tables and indexes.

### Repository Layer

- `WorkflowRepository`: workflow lifecycle records (`started`, `completed`, `failed`).
- `TopicRepository`: normalized topic history and duplicate lookup.
- `PromptRepository`: planner/writer prompts associated with a workflow.
- `ArticleRepository`: final article payload and publication metadata.

### Service Layer

`MemoryService` orchestrates repositories and exposes use-case methods:

- `beginWorkflow(...)`
- `savePrompt(...)`
- `completeWorkflow(...)`
- `failWorkflow(...)`

### Integration Layer

- CLI creates a SQLite-backed memory handle via `createSQLiteMemoryService(...)`.
- Workflow receives `memoryService` as an optional dependency.
- Workflow nodes call memory service methods during execution.

## Database Schema

Tables created by migrations:

- `workflows`
  - identity, topic, normalized topic
  - lifecycle status and timestamps
  - duplicate flags and parent workflow reference
  - optional metadata and error message
- `topics`
  - unique normalized topic
  - first topic text and first workflow reference
  - hit counter and timestamps
- `prompts`
  - prompt payload (`planner` or `writer`)
  - reference to workflow
  - creation timestamp
- `articles`
  - one row per workflow
  - article markdown, edited markdown, SEO payload
  - category/tags and publish result payload

## Duplicate Detection

Duplicate detection happens in `MemoryService.beginWorkflow(...)`:

1. Normalize incoming topic with:
   - trim
   - lowercase
   - collapse multiple spaces
2. Search `topics.normalized_topic`.
3. If found:
   - mark workflow as duplicate
   - set `duplicateOfWorkflowId` to first workflow id
   - increment `topics.hit_count`
4. If not found:
   - create new topic record
   - mark workflow as non-duplicate

## Workflow Lifecycle Persistence

At runtime:

1. Workflow starts and calls `beginWorkflow`.
2. Planner node stores planner prompt via `savePrompt`.
3. Writer node stores writer prompt via `savePrompt`.
4. On success, workflow calls `completeWorkflow`.
5. On failure, workflow calls `failWorkflow`.

## Configuration

Environment variable for DB path:

- `OPENBLOG_MEMORY_DB_PATH` (optional)

Default when not provided:

- `data/openblog-memory.db` (resolved from current working directory)

## Example Query Snippets

Latest workflows:

```sql
SELECT id, name, topic, status, is_duplicate, started_at, completed_at
FROM workflows
ORDER BY started_at DESC
LIMIT 20;
```

Prompts for one workflow:

```sql
SELECT prompt_type, content, created_at
FROM prompts
WHERE workflow_id = ?
ORDER BY created_at ASC;
```

Duplicate topic hotspots:

```sql
SELECT normalized_topic, first_topic, hit_count, last_seen_at
FROM topics
ORDER BY hit_count DESC, last_seen_at DESC
LIMIT 20;
```

## Current Test Coverage

`tests/unit/memory-service.test.ts` validates:

- workflow lifecycle persistence (`completed` and `failed`)
- prompt persistence
- topic duplicate detection and hit count updates
- article persistence on successful completion
