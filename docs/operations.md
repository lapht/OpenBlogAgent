# Operations

How to run, inspect, recover and back up OpenBlogAgent. Settings are in [Configuration](configuration.md); what a publish does is in [Publishing](publishing.md).

## Commands

Run after `npm run build` as `npm start -- <command>` (or `openblog <command>` from the `bin` of `apps/cli`, or inside Docker).

| Command            | What it does                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `generate <topic>` | Plan, write, edit, add SEO metadata, check quality, classify and publish as the policy allows |
| `resume <id>`      | Continue a `failed` run from its last good step; finished steps are not repeated              |
| `approve <id>`     | Publish a stored article live; `--override "reason"` if it failed the quality gate            |
| `list`             | The 20 most recent runs, newest first, with status, failed step, total tokens and cost        |

Options: `--dry-run`, `--publisher <id>`, `--force`, `--json`, `--help`. `--dry-run` runs everything except the publish call, on a throwaway copy of the database: nothing is stored, written or sent, and earlier runs are still visible to duplicate checks, `resume` and `approve`.

## Run statuses

| Status              | Meaning                                                                                                                      | Next step                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `running`           | In progress (or the process died: it will stay `running`)                                                                    | Wait, or `resume` if the process is gone                                   |
| `awaiting_approval` | The article passed the quality gate; under `draft` a draft is at the target, under `publish_after_approval` nothing was sent | `approve <id>`                                                             |
| `published`         | The target confirmed a live post (or file)                                                                                   | none                                                                       |
| `needs_review`      | The quality gate rejected the article after the allowed regenerations; nothing was published                                 | Read the violations, then `approve <id> --override "reason"` or regenerate |
| `failed`            | A step or the publisher failed; `failed_step` and `error_code` say which                                                     | Fix the cause, then `resume <id>`                                          |
| `duplicate`         | The topic, slug or title was already published                                                                               | `generate ... --force` if intended                                         |

A stored article also has a review state (`needs_review` → `approved` → `published`). If publishing fails during `approve`, the article stays `approved` and approving again retries it.

## Exit codes

| Code | Meaning                                                                   |
| ---- | ------------------------------------------------------------------------- |
| `0`  | Success: published, stored and waiting for approval, or `list` / `--help` |
| `1`  | Failed: a step, the publisher or the command itself failed                |
| `2`  | Needs review: the quality gate rejected the article                       |
| `3`  | Duplicate: topic, slug or title already published                         |
| `64` | Usage error: bad command line (the usage is printed on stderr)            |

## Scripting with `--json`

With `--json`, stdout holds exactly one JSON object and nothing else (logs go to stderr). For `generate`, `resume` and `approve`:

```json
{
  "command": "generate",
  "status": "awaiting_approval",
  "exitCode": 0,
  "dryRun": false,
  "workflowId": "…",
  "topic": "…",
  "title": "…",
  "slug": "…",
  "publisherId": "markdown",
  "outputPath": "output/articles/….md",
  "remoteUrl": null,
  "failure": null,
  "violations": []
}
```

`list` returns `{ "command": "list", "status": "ok", "exitCode": 0, "runs": [...] }`. An error that stops the command returns `{ "status": "error", "exitCode": 1, "error": { "code", "message" } }`. Fields are only ever added.

## Recovering a failed run

1. `npm start -- list` shows the run and its failed step (`[seo/…]`).
2. Find the cause in the logs (below). Typical causes: provider outage or auth error, an invalid WordPress application password, an existing file when `OPENBLOG_MARKDOWN_OVERWRITE=false`.
3. Fix it, then `npm start -- resume <id>`. Steps that already succeeded are restored from the database, so the provider is only called for the step that failed and the ones after it.

A run in `needs_review` did not fail, so `resume` is not the fix: read why with `list --json` or the log line `Article workflow needs review` (its `violations`), then decide to approve with an override or generate again.

## Logs

JSON lines on stderr, one per event. Make them readable in development with `OPENBLOG_LOG_PRETTY=true`.

| Field        | Where               | Meaning                                                                                                                                                                                |
| ------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflowId` | every line of a run | The id `resume` and `approve` take                                                                                                                                                     |
| `step`       | lines inside a step | `planner`, `writer`, `editor`, `seo`, `duplicate_check`, `quality`, `classification`, `publisher`                                                                                      |
| `attempt`    | lines inside a step | Which execution of the step (regenerations and resumes count up)                                                                                                                       |
| `msg`        | every line          | `Step finished` (with `outcome`, `durationMs`, and on failure `errorCode`, `error`), `LLM call completed` (with `provider`, `model`, `durationMs`, token counts), `Article workflow …` |

Secrets are redacted and request headers are never logged, so logs are safe to attach to an issue. To follow one run: `npm start -- generate "…" 2>&1 >/dev/null | jq 'select(.workflowId == "<id>")'`.

## Backups of the SQLite database

All state lives in one file (`OPENBLOG_MEMORY_DB_PATH`, default `data/openblog-memory.db`, in Docker the `openblog-data` volume): runs, step outputs (what `resume` needs), prompts and stored articles (what `approve` needs). Losing it loses the duplicate history and pending approvals, not published posts.

The database runs in WAL mode, so do not copy only the `.db` file while a command is running. Take a consistent copy with SQLite's online backup:

```bash
sqlite3 data/openblog-memory.db ".backup 'backup/openblog-$(date +%F).db'"
```

or copy the file when no command is running, together with any `-wal` file. Restore by putting the backup at `OPENBLOG_MEMORY_DB_PATH`. In Docker:

```bash
docker run --rm -v openblog-data:/data -v "$PWD/backup:/backup" debian:bookworm-slim \
  cp /data/openblog-memory.db /backup/   # with no openblog container running
```

Migrations run automatically when a command opens the database; keep a backup before upgrading.

## Docker

See the README for building and running. The image runs the CLI as an unprivileged user; data and output live in the `openblog-data` and `openblog-output` volumes and survive container recreation. The container cannot reach an Ollama on the host at `127.0.0.1`: Compose sets `OLLAMA_BASE_URL` to `host.docker.internal`.
