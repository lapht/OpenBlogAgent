# Architecture Overview

OpenBlogAgent follows Clean Architecture principles:

- `apps/`: entry points (server, dashboard, cli)
- `packages/`: reusable modules and contracts
- `packages/core`: domain-level interfaces and DI entry point
- `packages/sdk`: stable public surface for plugin authors

Dependencies flow from outer layers to contracts, never to concrete business logic.
