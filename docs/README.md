# Documentation Map

Use this directory for durable project context. Keep current contracts in one canonical place and link instead of repeating them.

## Core Docs

- [Product Context](./product-context.md) - problem narrative, users, and safety rules.
- [Architecture](./architecture.md) - current system wiring, flow, gates, and extension points.
- [Master Context & Decision Log](./CONTEXT.md) - raw reasoning, decisions, competitive context, and status history.
- [Project Plan](./project-plan.md) - historical hackathon strategy and milestones.
- [Ingestion Start Context](./ingestion-start-context.md) - historical ingestion-lane context and session history; live contracts are in Architecture and Database README.
- [Backend README](../backend/README.md) - production Python lane map, local commands, ingestion test notes.
- [Frontend README](../frontend/README.md) - Next.js console routes, API contracts, upload behavior.
- [Contributor Guide](../AGENTS.md) - repository conventions for coding agents and human contributors.
- [Fallow local gate](../AGENTS.md#fallow-local-gate) - repo health checks, audit gate, and legacy ignore scope.

## Suggested Structure

As this repository grows:

- `docs/design/` for feature designs and implementation specs.
- `docs/decisions/` for architecture decision records.
- `docs/integrations/` for provider, Band, ingestion, and ledger integration contracts.
- `docs/operations/` for deployment, environment, and runbook notes.

Prefer focused docs over expanding historical context files. When moving or renaming docs, update this map and grep for stale links before reporting completion.
