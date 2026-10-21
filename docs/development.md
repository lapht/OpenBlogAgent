# Development Guide

## Commands

- `npm ci`
- `npm run build` (tests that use the composition root resolve `@openblog/*` through `dist`, so build before `npm test`)
- `npm run typecheck`
- `npm run lint`
- `npm run format`
- `npm test` (offline: no network or API keys needed; `tests/e2e` runs the whole workflow with fakes)
- `npm run check:deps` and `npm run check:docs` (docs match the env schema, links resolve)

## Local API

The server app exposes:

- `GET /health`
- `GET /version`

Run locally with `npm run dev`.

## Further Reading

- [Architecture Overview](architecture.md)
- [Configuration](configuration.md)
- [Operations](operations.md)
- [Packages](packages.md)
- [Publishing](publishing.md)
- [Memory and Persistence](memory.md)
