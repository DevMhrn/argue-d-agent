# Documentation Map

Use this directory for durable project context, design notes, architecture records, and future contributor-facing documentation. Keep the root README focused on setup and demo flow.

## Core Docs

- [Product Context](./product-context.md) - the plain-English subrogation story, Lumen's six-agent model, safety rules, and ownership boundary.
- [Architecture](./architecture.md) - current orchestration flow, room behavior, gates, and package assembly.
- [Project Plan](./project-plan.md) - hackathon strategy, milestones, and broader delivery plan.
- [Contributor Guide](../AGENTS.md) - repository conventions for coding agents and human contributors.

## Suggested Structure

As this repository grows, keep docs organized by purpose:

- `docs/product-context.md` for the shared problem narrative and user mental model.
- `docs/architecture.md` for the current orchestration design.
- `docs/project-plan.md` for historical planning and hackathon strategy.
- `docs/design/` for feature designs and implementation specs.
- `docs/decisions/` for architecture decision records.
- `docs/integrations/` for provider, Band, ingestion, and ledger integration contracts.
- `docs/operations/` for deployment, environment, and runbook notes.

Prefer adding focused docs over expanding `docs/project-plan.md`. When moving or renaming docs, update this map and grep the repository for stale links before reporting completion.
