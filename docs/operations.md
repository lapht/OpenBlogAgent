# Operations

How to run, inspect, recover and back up OpenBlogAgent. Settings are in [Configuration](configuration.md); what a publish does is in [Publishing](publishing.md).

## Commands

Run after `npm run build` as `npm start -- <command>` (or `openblog <command>` from the `bin` of `apps/cli`, or inside Docker).

| Command            | What it does                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `generate <topic>` | Plan, write, edit, add SEO metadata, check quality, classify and publish as the policy allows     |
| `resume <id>`      | Continue a `failed` or `interrupted` run from its last good step; finished steps are not repeated |
| `approve <id>`     | Publish a stored article live; `--override "reason"` if it failed the quality gate                |
| `reject <id>`      | Close a stored article as rejected, for good; `--reason "why"` is required                        |
| `revise <id>`      | Send a stored article back to the writer; `--feedback "what to change"` is required               |
| `list`             | The 20 most recent runs, newest first, with status, failed step, total tokens and cost            |

Options: `--dry-run`, `--publisher <id>`, `--force`, `--recover-stale` (`list` only: mark runs with no activity for `OPENBLOG_RUN_STALE_AFTER_MINUTES` as `interrupted` first, logging how many), `--json`, `--help`, and for `generate` the brief options `--brief <file>` (YAML or JSON), `--language`, `--audience`, `--tone`, `--keyword`, `--min-words`, `--max-words`, `--notes`, `--source <url>` (repeatable) (flags override the file; see the README). An invalid brief exits `64` before any provider call; `--dry-run` and `--json` show the effective brief. `--dry-run` runs everything except the publish call, on a throwaway copy of the database: nothing is stored, written or sent, and earlier runs are still visible to duplicate checks, `resume` and `approve`.

## Run statuses

| Status              | Meaning                                                                                                                      | Next step                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `running`           | In progress (or the process died: it stays `running` until recovered)                                                        | Wait, or `list --recover-stale` then `resume` if the process is gone       |
| `interrupted`       | Recovered as abandoned: no activity for `OPENBLOG_RUN_STALE_AFTER_MINUTES`; its steps are kept                               | `resume <id>`                                                              |
| `awaiting_approval` | The article passed the quality gate; under `draft` a draft is at the target, under `publish_after_approval` nothing was sent | `approve <id>`                                                             |
| `published`         | The target confirmed a live post (or file)                                                                                   | none                                                                       |
| `needs_review`      | The quality gate rejected the article after the allowed regenerations; nothing was published                                 | Read the violations, then `approve <id> --override "reason"` or regenerate |
| `failed`            | A step or the publisher failed; `failed_step` and `error_code` say which                                                     | Fix the cause, then `resume <id>`                                          |
| `duplicate`         | The topic, slug or title was already published                                                                               | `generate ... --force` if intended                                         |
| `rejected`          | A reviewer closed the article with `reject`; terminal                                                                        | none (`approve`, `revise` and `resume` refuse it); `generate` again        |

A stored article also has a review state (`needs_review` → `approved` → `published`). If publishing fails during `approve`, the article stays `approved` and approving again retries it.

### Reject and revise

Both apply to runs in `needs_review` or `awaiting_approval`. Any other status is refused with a stable code: `already_published`, `already_rejected`, `invalid_state` (for example `failed`: use `resume`), `not_found`, `invalid_input` (empty reason or feedback); the CLI exits `1` and prints it as `error.code`.

- `reject <id> --reason "..."` sets the status `rejected` and stores the reason, who rejected and when. A rejected article does not count as a duplicate of later runs (topic, slug and title are free again). A draft that was already sent to a target is **not** deleted there; remove it by hand.
- `revise <id> --feedback "..."` runs the writer again with your feedback and the version you read, keeping the outline, then editor, SEO, quality gate, review, classification and publisher under the same `OPENBLOG_PUBLICATION_POLICY`. The stored brief is reused and everything counts against the run budget (what the first version spent included). Feedback, who and when are stored. If the quality gate asks for a regeneration, your feedback is kept in the writer prompt. If a draft of this run is already at the target, the revision updates that same post (same slug; the Markdown publisher replaces its own draft file). Each revision adds a writer attempt, so the run's step history shows them all. The result is one of the usual outcomes, so `needs_review` → `revise` → `awaiting_approval` → `approve` → `published` works.

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

## HTTP API

`npm run build`, then `node apps/server/dist/main.js` (or `npm run dev`). The server wires the same application as the CLI (`createApplication`), so a run started over HTTP is stored, resumable and approvable exactly like a CLI run, and the two share the SQLite store. Set `OPENBLOG_API_KEY` first: the run endpoints answer `503 api_disabled` without it, and `401 unauthorized` when the key is missing or wrong. `/health`, `/version` and `/openapi.json` are public.

Send the key as `Authorization: Bearer <key>` or `X-API-Key: <key>`.

| Endpoint                  | Does                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /runs`              | `{ "topic": "...", "force": false, ...brief }` starts a run in the background: `202 { workflowId, status: "started" }`; the brief fields (`language`, `audience`, `tone`, `targetKeyword`, `secondaryKeywords`, `minWords`, `maxWords`, `notes`) are optional, an invalid one is `400 invalid_brief` |
| `GET /runs?limit=20`      | The most recent runs with tokens, cost and review                                                                                                                                                                                                                                                    |
| `GET /runs/{id}`          | Status, failure, totals and every step execution (`404` for an unknown id)                                                                                                                                                                                                                           |
| `POST /runs/{id}/resume`  | `202`; continues from the last good step (`409` if published or already running)                                                                                                                                                                                                                     |
| `POST /runs/{id}/reject`  | `{ "reason": "...", "rejectedBy": "..." }` closes a `needs_review`/`awaiting_approval` run as `rejected` (`409 already_rejected`, `already_published`, `invalid_state`; `404 not_found`)                                                                                                             |
| `POST /runs/{id}/revise`  | `{ "feedback": "...", "revisedBy": "..." }` returns `202` and runs in the queue like `resume`; same refusals as `reject`. `GET /runs/{id}` lists `decisions` (action, actor, note, createdAt)                                                                                                        |
| `POST /runs/{id}/approve` | `{ "approvedBy": "...", "overrideReason": "..." }` publishes live and waits for the result; the same refusals as the CLI (`422 gate_not_passed`, `409 already_published`, `409 already_rejected`)                                                                                                    |

Runs execute in a bounded queue: `OPENBLOG_API_CONCURRENCY` at once, `OPENBLOG_API_QUEUE_SIZE` waiting; beyond that the answer is `429 queue_full` with `Retry-After`. Poll `GET /runs/{id}` until the status is no longer `started` or `running`. A queued run is stored as `started`. If the server stops while a run is executing, that run stays `running` (or `started`) in the store until the next server start, which marks runs idle for `OPENBLOG_RUN_STALE_AFTER_MINUTES` as `interrupted` and logs how many; `resume` them. On shutdown the server waits for running and queued jobs. The OpenAPI document is at `/openapi.json`. Errors have the shape `{ "error": "...", "code": "..." }`.

## Recovering a failed run

1. `npm start -- list` shows the run and its failed step (`[seo/…]`).
2. Find the cause in the logs (below). Typical causes: provider outage or auth error, an invalid WordPress application password, an existing file when `OPENBLOG_MARKDOWN_OVERWRITE=false`.
3. Fix it, then `npm start -- resume <id>`. Steps that already succeeded are restored from the database, so the provider is only called for the step that failed and the ones after it.

A run in `needs_review` did not fail, so `resume` is not the fix: read why with `list --json` or the log line `Article workflow needs review` (its `violations`), then decide to approve with an override or generate again.

## Notifications

With `OPENBLOG_NOTIFY_WEBHOOK_URL` set, OpenBlogAgent posts a message when a run ends in a state that needs a person, so scheduled runs do not wait unseen. One message is sent for each occurrence of each configured event (`OPENBLOG_NOTIFY_EVENTS`), after the outcome is stored: `awaiting_approval`, `needs_review`, `failed` (a failed step or publisher), `budget_exceeded`, and optionally `published`, `duplicate` and `schedule_limit_reached` (a daily run or cost limit stopped `schedule run-once`; the time window does not notify). A `resume` or `revise` that ends again in one of these states sends a new message; `approve` and `reject` are human actions and send nothing.

The default body is JSON with a stable shape (fields are only added):

```json
{
  "source": "openblog",
  "event": "awaiting_approval",
  "workflowId": "…",
  "topic": "…",
  "title": "…",
  "status": "awaiting_approval",
  "errorCode": null,
  "errorMessage": null,
  "url": "https://blog.example.com:3000/runs/…",
  "occurredAt": "2026-10-24T08:00:00.000Z"
}
```

`url` is set only with `OPENBLOG_NOTIFY_BASE_URL` (open it with the API key). `OPENBLOG_NOTIFY_FORMAT=slack` or `discord` sends a short text message instead (headline, reason, run id, link) that the incoming webhooks of those services accept. Delivery makes up to 3 attempts (10 seconds each; retried after 0.5 s and 1 s on network errors, timeouts, `429` and `5xx`, not on other `4xx`). If it still fails, the log says `Notification failed` with the host, the number of attempts and the reason; the run is never failed or changed by a notification. The webhook address is never logged, also not inside error messages. The request is a plain HTTPS call to the address you configured: it does not go through the content fetcher and is not limited to public addresses.

## Scheduling

`openblog schedule run-once [--collect] [--dry-run] [--json]` does the next unit of work and exits, so cron (or the Compose service) can call it as often as it likes:

1. takes the lock (a row in the database with an owner and an expiry; a second call exits `12` at once; the lock of a dead process is taken over after `OPENBLOG_SCHEDULE_LOCK_TTL_MINUTES`);
2. marks runs abandoned by a dead process as `interrupted` (as `list --recover-stale` does);
3. with `--collect`, reads the research sources and stores the candidates (never accepting any by itself unless `OPENBLOG_RESEARCH_AUTO_ACCEPT_MIN_SCORE` is set);
4. checks the time window and the daily limits (`OPENBLOG_SCHEDULE_*`; the last 24 hours, from the stored runs and step usage, so they hold across restarts);
5. takes the highest-scored `accepted` candidate, registers a normal run from it and marks the candidate `used` before executing, so a crash leaves a run that `resume` continues, never a candidate that is picked twice. The candidate's page grounds the article (ADR-041). The publication policy is unchanged: with the default `draft` a scheduled run leaves a draft that waits for `approve`.

| Exit code | Meaning                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------- |
| `0`       | A run was started and finished: published or awaiting approval                                  |
| `1`       | The run failed, or the command did (the run is `failed`/`interrupted`; `resume <id>`)           |
| `2`, `3`  | The run ended `needs_review` or `duplicate`, as for `generate`                                  |
| `10`      | Nothing to do: no accepted candidate                                                            |
| `11`      | A limit stopped it: `max_runs_per_day`, `max_cost_per_day` or `outside_window` (`limit.reason`) |
| `12`      | Locked: another `run-once` holds the lock                                                       |
| `64`      | Usage error                                                                                     |

`10`, `11` and `12` are normal outcomes, not failures. `--json` prints `{ command, status: ran|nothing_to_do|limit_reached|locked, exitCode, recovered, collected?, candidate?, run?, limit?, lock? }`. `--dry-run` works on a throwaway copy of the database and sends nothing.

Host cron, every hour, with the limits in `.env`:

```cron
0 * * * * cd /srv/openblogagent && docker compose -f docker/docker-compose.yml run --rm openblog schedule run-once --collect --json >> /var/log/openblog-schedule.log
```

Or the Compose service, which loops every `OPENBLOG_SCHEDULE_INTERVAL_SECONDS` (default 3600) and shares the data volume with the `openblog` service:

```bash
docker compose -f docker/docker-compose.yml --profile scheduler up -d scheduler
docker compose -f docker/docker-compose.yml logs -f scheduler
```

There is no scheduling inside the server, and the lock does not span hosts: run one scheduler per database.

## Grounded generation

`openblog generate "topic" --source https://example.com/report [--source ...]` (up to 5; also `sources` in a `--brief` file, the `POST /runs` and `POST /topics/{id}/accept` bodies) adds a first step, `read_sources`: each page is fetched through the content fetcher, its main text extracted (title, `<article>`/`<main>`/`<body>` content without scripts, navigation, footers and comments) and cut to the budget (`OPENBLOG_SOURCES_MAX_CHARS_*`). The extracted text is stored as the step's output, so `resume` and `revise` reuse it and never fetch again. The planner and the writer receive it between `<source>` tags with the warning that it is untrusted and its instructions must not be followed; the writer must end with a references section linking only to the sources it used. The quality gate then checks it: an article without a link to any source is `references_missing`, a link to any other address is `reference_not_provided` (both errors, so the article is regenerated or parked as `needs_review`; redirects, `www.`, trailing slashes and tracking parameters do not matter). Without sources nothing changes: no step, no fetch, no extra rule.

A page that cannot be used fails the run at `read_sources` with a clear code: the fetch codes (`fetch_blocked`, `fetch_http_error`, `fetch_timeout`, `fetch_too_large`, `fetch_unsupported_type`, `fetch_network`), `source_empty` (the page has almost no readable text, typically because scripts render it), `sources_unavailable` (no reader configured) or `sources_failed` (with `OPENBLOG_SOURCES_ALLOW_PARTIAL=true`, no page could be read). `topics generate <id>` grounds the article in the page the candidate was found on unless the stored or given brief names other sources.

## Fetching external content

Research features read URLs through the content fetcher only (ADR-038). A failure is a `FetchError` with one of these codes: `fetch_blocked` (scheme, credentials in the URL, host not in `OPENBLOG_FETCH_ALLOWED_HOSTS`, or an address that is loopback, private, link-local, CGNAT or metadata, also after a redirect), `fetch_timeout`, `fetch_too_large`, `fetch_http_error` (status or redirect limit), `fetch_unsupported_type` and `fetch_network` (DNS or connection failure). Logs and errors carry the URL without credentials and query string. To read a feed on a local network deliberately, set `OPENBLOG_FETCH_ALLOW_PRIVATE=true`; leave it off on any server that exposes the API.

## Topic backlog

`openblog research collect [--json]` reads every source of `OPENBLOG_RESEARCH_SOURCES_FILE` (no model involved), scores the candidates (see Research sources in `docs/configuration.md`) and stores them in the SQLite database. It is idempotent: a candidate whose URL or normalized title is already stored is not duplicated; one still `new` is rescored, one already decided is left alone. A topic that matches a published, awaiting-approval or needs-review article is skipped and reported, never offered as `new`. With `--dry-run` it uses a throwaway database: nothing is kept, and the check against published articles does not apply. Nothing becomes `accepted` without a person unless `OPENBLOG_RESEARCH_AUTO_ACCEPT_MIN_SCORE` is set.

| Command                                        | Does                                                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `topics list [--status s] [--json]`            | Candidates, best score first, with score, motivation and decision (`new`, `accepted`, `dropped`, `used`)                                                                                                           |
| `topics accept <id> [--brief f] [brief flags]` | Approves a candidate; the brief fields given (all but the topic) are stored with it. Ids can be shortened to a unique prefix of at least 4 characters                                                              |
| `topics drop <id> [--reason "why"]`            | Drops a candidate; it stays stored and is never offered as `new` again                                                                                                                                             |
| `topics generate <id> [brief flags]`           | Starts a normal run with the candidate's title as the topic and its stored brief (flags win); the candidate becomes `used` with the run's id. `new` and `accepted` candidates only                                 |
| `topics enrich <id>` or `--top N`              | Asks the model for an angle, working title, target keyword and motivation and stores them with the candidate. Only when asked (or with `OPENBLOG_RESEARCH_ENRICH=true` when collecting); the score is not affected |
| `topics accept <id> --use-enrichment`          | Accepts with the proposed keyword as `targetKeyword` and, as `notes`, the working title and angle; brief options you give win                                                                                      |

A proposal costs one model call (more if the reply is invalid and re-prompted, up to 3 attempts); its tokens and cost are stored with it (`enrichment.usage`) and a round stops once `OPENBLOG_RESEARCH_MAX_COST` is reached. The model is `OPENBLOG_MODEL_RESEARCH` (else the provider's). The feed entry is sent to the model as untrusted text.

HTTP, behind the API key: `GET /topics?status=&limit=`, `POST /topics/{id}/enrich` (`502 enrichment_failed` when no valid proposal came back, `503 llm_unavailable`), `useEnrichment` in the accept body,, `POST /topics/collect` (waits for the collection), `POST /topics/{id}/accept` (`{ "acceptedBy", "brief" }`) and `POST /topics/{id}/drop` (`{ "droppedBy", "reason" }`); errors `404 not_found`, `409 invalid_state|ambiguous_id`, `400 invalid_input`, `503 sources_not_configured|backlog_unavailable|sources_invalid`. Entries listing the same URL (scheme, `www.`, tracking parameters, fragment and trailing slash ignored) or the same normalized title collapse into one. A source that fails is reported with its code (`fetch_*` from the fetcher, or `invalid_feed` for malformed XML or the wrong kind of document) and does not stop the others; the exit code is 1 only when every source failed. The sources that were read are listed even when some failed. Sitemap titles come from the last path segment of the URL, since sitemaps carry none. `--json` prints `{ command, status, exitCode, sources: [{ name, type, url, status, count, error?, warnings }], counts: { created, refreshed, unchanged, skipped, autoAccepted }, skipped: [{ title, url, coveredBy }], candidates: [{ id, title, url, source, score, breakdown, motivation, status, outcome, ... }] }`.

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
