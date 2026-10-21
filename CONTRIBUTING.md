# Contributing

## Development Setup

1. Install Node.js LTS and npm.
2. Run `npm ci`.
3. Copy `.env.example` to `.env` and adjust values.
4. Run `npm run build` and `npm run test`.

## Workflow

1. Create a feature branch from `main`.
2. Keep changes focused and small.
3. Run lint, test and build locally.
4. Open a pull request using the template.

## Commit Convention

This repository enforces Conventional Commits through commitlint.

## Required Checks

Every pull request and every push to `main` runs `.github/workflows/ci.yml` on Node 20 (the version used in `docker/Dockerfile`) and Node 22. All of these must pass:

1. `npm ci`
2. `npm run build`
3. `npm run typecheck`
4. `npm run lint`
5. `npm run format`
6. `npm test`

Run them locally before opening a pull request.
