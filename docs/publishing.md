# Publishing Engine

The publishing engine is a modular layer that allows the article workflow to publish generated content without knowing which platform will receive it.

## Architecture

The flow is:

```text
Topic -> Planner -> Writer -> Publisher -> Output
```

The agents only produce content. The publisher layer is responsible for:

- selecting the correct publisher,
- validating the article payload,
- publishing to the target destination,
- returning a typed result.

## Core concepts

- IPublisher: common interface for all publishers.
- DefaultPublisherManager: central component that routes the publish request.
- MarkdownPublisher: writes Markdown with YAML front matter to the output directory.
- WordPressPublisher: creates a post (draft by default) through the WordPress REST API. Markdown is rendered to HTML with `marked` and sanitized with `sanitize-html`; the payload includes the slug; the response (`id`, `link`, `status`, `slug`) is returned in `PublishResult.metadata`. Only Application Passwords are supported, and HTTP errors map to distinct codes: `auth_failed` (401), `forbidden` (403), `invalid_request` (other 4xx), `server_error` (5xx), `network_error`, `timeout` and `unexpected_response`.
- GhostPublisher: placeholder for a future Ghost Admin API integration. It is not registered by the factory, has no configuration, and always fails with `not_implemented`.

## Configuration

The centralized config system supports:

- OPENBLOG_DEFAULT_PUBLISHER
- OPENBLOG_OUTPUT_DIR
- OPENBLOG_WORDPRESS_ENDPOINT
- OPENBLOG_WORDPRESS_USERNAME
- OPENBLOG_WORDPRESS_APPLICATION_PASSWORD
- OPENBLOG_WORDPRESS_STATUS
- OPENBLOG_TAXONOMY_ALLOW_CREATE (`true`|`false`, default `false`)
- OPENBLOG_TAXONOMY_CATEGORIES / OPENBLOG_TAXONOMY_TAGS (comma-separated static lists) and OPENBLOG_TAXONOMY_FILE (JSON `{ "categories": [], "tags": [] }`; the lists override the file)

`OPENBLOG_WORDPRESS_ENDPOINT` is the base REST URL (e.g. `https://example.com/wp-json/wp/v2`, without `/posts`; it must end in `/wp-json/wp/v2`). All variables are validated in `packages/config` (`loadEnv()`); apps must read configuration only from the parsed object.

## Registering a new publisher

1. Implement the IPublisher interface.
2. Register the publisher in the workflow via the publishers array or by extending the factory.
3. Expose any new configuration keys in the config schema.

## Usage inside the workflow

The workflow receives publisher instances from the factory and uses the manager to publish generated content. Agents remain unaware of the target platform.
