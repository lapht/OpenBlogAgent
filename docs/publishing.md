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
- WordPressPublisher: sends content to a WordPress REST endpoint.
- GhostPublisher: prepares a Ghost integration payload and can be extended later.

## Configuration

The centralized config system supports:

- OPENBLOG_DEFAULT_PUBLISHER
- OPENBLOG_OUTPUT_DIR
- OPENBLOG_WORDPRESS_ENDPOINT
- OPENBLOG_WORDPRESS_USERNAME
- OPENBLOG_WORDPRESS_PASSWORD
- OPENBLOG_WORDPRESS_APPLICATION_PASSWORD
- OPENBLOG_WORDPRESS_STATUS
- OPENBLOG_GHOST_ENDPOINT
- OPENBLOG_GHOST_API_KEY
- OPENBLOG_GHOST_STATUS

## Registering a new publisher

1. Implement the IPublisher interface.
2. Register the publisher in the workflow via the publishers array or by extending the factory.
3. Expose any new configuration keys in the config schema.

## Usage inside the workflow

The workflow receives publisher instances from the factory and uses the manager to publish generated content. Agents remain unaware of the target platform.
