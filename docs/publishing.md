# Publishing Engine

The publishing engine is a modular layer that allows the article workflow to publish generated content without knowing which platform will receive it.

## Architecture

The flow is:

```text
Topic -> Planner -> Writer -> Editor -> SEO -> Quality gate -> Classification -> Publisher -> Output
```

The agents only produce content. The publisher layer is responsible for:

- selecting the correct publisher,
- validating the article payload,
- publishing to the target destination,
- returning a typed result.

## Publication policy: drafts first

`OPENBLOG_PUBLICATION_POLICY` decides when an article can go live. It is `draft` by default, so a run never produces a live post by itself:

| Policy                   | After the quality gate passes                                                | Run ends as         |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------- |
| `draft` (default)        | Sent to the target as a draft (WordPress draft; a file with `status: draft`) | `awaiting_approval` |
| `publish_after_approval` | Nothing is sent                                                              | `awaiting_approval` |
| `publish_if_gate_passes` | Published live immediately (use with care)                                   | `published`         |

An article that fails the gate is never sent, under any policy (`needs_review`). `npm start -- approve <workflowId>` publishes the stored article live, once; `reject` closes it and `revise` sends it back to the writer with feedback; see [Operations](operations.md).

## Markdown output

The default publisher. `generate` writes `{OPENBLOG_OUTPUT_DIR}/{slug}.md` (default `output/articles/`): YAML front matter (title, slug, description, status, category, tags, dates, author, language) followed by the article (`language` is the run's content language, `OPENBLOG_CONTENT_LANGUAGE` or the brief's). WordPress and Ghost have no per-post language in the payloads this project sends, so they ignore it. The `status` is `draft` until `approve` replaces the file with the live version (only a draft written by this publisher is replaced). Any other existing file is never overwritten unless `OPENBLOG_MARKDOWN_OVERWRITE=true`; the publish fails with `already_exists`.

## WordPress prerequisites

1. WordPress 5.6 or later with the REST API reachable (`https://your-site/wp-json/wp/v2/posts` answers). Pretty permalinks must be enabled for `/wp-json`.
2. A user that may create posts (Author or higher; Editor if you want `OPENBLOG_TAXONOMY_ALLOW_CREATE=true` to create categories and tags).
3. An **application password** for that user: Users → Profile → Application Passwords. Only application passwords are supported; the site must serve HTTPS or allow application passwords on HTTP.
4. Configure:

```bash
OPENBLOG_DEFAULT_PUBLISHER=wordpress
OPENBLOG_WORDPRESS_ENDPOINT=https://your-site/wp-json/wp/v2
OPENBLOG_WORDPRESS_USERNAME=bot
OPENBLOG_WORDPRESS_APPLICATION_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx
```

### Ghost

1. In Ghost Admin: Settings → Integrations → Add custom integration. Copy its **Admin API key** (`<id>:<secret>`).
2. Configure:

```bash
OPENBLOG_DEFAULT_PUBLISHER=ghost
OPENBLOG_GHOST_ENDPOINT=https://your-site
OPENBLOG_GHOST_ADMIN_API_KEY=<id>:<secret>
```

The same advice applies: try `generate "topic" --dry-run --publisher ghost` and the default `draft` policy first. The tests use a fake Ghost server only; no automated test has run against a real Ghost site.

**Try it on a test site first.** With the default `draft` policy nothing becomes visible, and `npm start -- generate "topic" --dry-run --publisher wordpress` exercises everything but the post itself. Published posts are keyed by slug: publishing again updates the existing post (or fails with `conflict` when `OPENBLOG_WORDPRESS_ON_EXISTING=conflict`).

## Core concepts

- IPublisher: common interface for all publishers.
- DefaultPublisherManager: central component that routes the publish request.
- MarkdownPublisher: writes `{OPENBLOG_OUTPUT_DIR}/{slug}.md` with YAML front matter (title, slug, description, category, tags as a list, createdAt, updatedAt, author, language) produced by a YAML serializer. The slug is slugified (`^[a-z0-9]+(-[a-z0-9]+)*$`) and the path is checked to stay inside the output directory (`invalid_slug` otherwise). An existing file is never replaced unless `OPENBLOG_MARKDOWN_OVERWRITE=true`; otherwise the publish fails with `already_exists`.
- WordPressPublisher: creates a post (draft by default) through the WordPress REST API. Markdown is rendered to HTML with `marked` and sanitized with `sanitize-html`; the payload includes the slug; the response (`id`, `link`, `status`, `slug`) is returned in `PublishResult.metadata`. Publishing is idempotent: before writing, the publisher queries `GET /posts?slug=<slug>&status=any`; an existing post is updated in place with `PUT /posts/<id>` (its status is kept unless `OPENBLOG_WORDPRESS_STATUS=publish`), or the publish fails with `conflict` when `OPENBLOG_WORDPRESS_ON_EXISTING=conflict`. The result metadata has `action` (`created`|`updated`); id, link and status are stored on the article row (`publish_remote_*`). Only Application Passwords are supported, and HTTP errors map to distinct codes: `auth_failed` (401), `forbidden` (403), `invalid_request` (other 4xx), `server_error` (5xx), `network_error`, `timeout` and `unexpected_response`.
- GhostPublisher: creates a post through the Ghost Admin API (`<site>/ghost/api/admin/posts/?source=html`), registered when `OPENBLOG_GHOST_ENDPOINT` is set. Each request carries a fresh HS256 JWT signed with the secret of `OPENBLOG_GHOST_ADMIN_API_KEY` (`Authorization: Ghost <jwt>`, valid five minutes). Markdown is rendered to sanitized HTML. Ghost has no categories, so the category becomes the first (primary) tag followed by the tags, which Ghost creates by name. The post is a draft unless the workflow asks for `publish` (Ghost status `published`). Publishing is idempotent: the publisher looks the slug up first (`GET /posts/slug/<slug>/`, any status; a 404 means none) and updates an existing post in place with `PUT /posts/<id>` using its `updated_at`; an update never takes a live post back to draft. The result metadata has `id`, `link`, `status`, `slug` and `action` (`created`|`updated`), stored on the article row like WordPress. HTTP errors map to `auth_failed` (401), `forbidden` (403), `invalid_request` (other 4xx), `server_error` (5xx), `network_error`, `timeout` and `unexpected_response`; a missing or malformed setting fails with `validation_failed` before any request. Members and newsletters are not touched.

## Configuration

Every variable is described in [Configuration](configuration.md). The ones that matter for publishing:

- OPENBLOG_PUBLICATION_POLICY
- OPENBLOG_DEFAULT_PUBLISHER
- OPENBLOG_OUTPUT_DIR
- OPENBLOG_MARKDOWN_OVERWRITE (`true`|`false`, default `false`)
- OPENBLOG_WORDPRESS_ENDPOINT
- OPENBLOG_WORDPRESS_USERNAME
- OPENBLOG_WORDPRESS_APPLICATION_PASSWORD
- OPENBLOG_GHOST_ENDPOINT
- OPENBLOG_GHOST_ADMIN_API_KEY
- OPENBLOG_WORDPRESS_STATUS
- OPENBLOG_WORDPRESS_ON_EXISTING (`update`|`conflict`, default `update`)
- OPENBLOG_TAXONOMY_ALLOW_CREATE (`true`|`false`, default `false`)
- OPENBLOG_TAXONOMY_CATEGORIES / OPENBLOG_TAXONOMY_TAGS (comma-separated static lists) and OPENBLOG_TAXONOMY_FILE (JSON `{ "categories": [], "tags": [] }`; the lists override the file)

`OPENBLOG_WORDPRESS_ENDPOINT` is the base REST URL (e.g. `https://example.com/wp-json/wp/v2`, without `/posts`; it must end in `/wp-json/wp/v2`). All variables are validated in `packages/config` (`loadEnv()`); apps must read configuration only from the parsed object.

## Registering a new publisher

1. Implement the IPublisher interface.
2. Register the publisher in the workflow via the publishers array or by extending the factory.
3. Expose any new configuration keys in the config schema.

## Usage inside the workflow

The workflow receives publisher instances from the factory and uses the manager to publish generated content. Agents remain unaware of the target platform.
