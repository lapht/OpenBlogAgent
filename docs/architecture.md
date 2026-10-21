# Architecture Overview

OpenBlogAgent follows Clean Architecture principles:

- `apps/`: entry points (server, cli)
- `packages/`: reusable modules and contracts
- Wiring is explicit constructor/factory injection (no DI container); see ADR-009 in `decisions`

Dependencies flow from outer layers to contracts, never to concrete business logic.
