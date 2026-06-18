# Repository Guidelines

## Project Structure & Module Organization

Lumen is an AI-assisted insurance subrogation recovery workflow. Read `docs/product-context.md` before changing product behavior, and use `docs/README.md` as the documentation map. Long-form docs live in `docs/`, including `docs/architecture.md` and `docs/project-plan.md`.

The production Python backend lives under `backend/`:

- `backend/app/` — orchestration pipeline (FastAPI server, agents, gates, room, Band-SDK probes). Entry points are `python -m backend.app.run_server` and `python -m backend.app.run_demo`.
- `backend/schemas/` — application-level Pydantic models that mirror the database tables. One file per table; `*Row` for reads, `*Create` for inserts.
- `backend/ingestion/` — file uploads, per-format text extraction, source-anchored persistence. FastAPI router at `/api/ingest`.
- `backend/ledger/` — graph builder (Gowtham's lane). Reads ingested documents, writes typed nodes + edges.
- `backend/db/` — SQL migrations and schema overview README. Apply migrations into Supabase via the SQL editor.

The static UI lives in `frontend/` (HTML/JS/CSS). Sample claims and statute fixtures live in `data/`. The legacy TypeScript demo stack (`src/`, `server/`) is kept at the repo root for the offline `pnpm demo` showcase — production behavior lives in `backend/`.

## Build, Test, and Development Commands

- `pnpm install` installs dependencies from `pnpm-lock.yaml`.
- `pnpm demo` runs the deterministic mock pipeline with no API keys.
- `pnpm demo:live` runs live provider calls with `LUMEN_MOCK=0`; configure `.env` first.
- `pnpm serve` starts the local Express server in mock mode.
- `pnpm serve:live` starts the server with live provider calls.
- `pnpm typecheck` runs `tsc --noEmit` against the TypeScript project.

Keep mock mode working before changing live-provider behavior.

## Coding Style & Naming Conventions

Production Python code in `backend/` uses Pydantic v2 models, async-first FastAPI patterns, and strict typing — avoid `Any`. Each lane owns a single folder; do not write across lane boundaries. Storage-layer Pydantic models live in `backend/schemas/`; pipeline-internal Pydantic models live in `backend/app/types.py`.

The legacy TypeScript demo (`src/`, `server/`) follows the original conventions: two-space indentation, single quotes, semicolons, named exports, concise interfaces, no `any`. Pure helpers for gate logic, prompts in `src/prompts.ts`, agent definitions in `src/agents.ts`, settings in `src/config.ts`. File naming by responsibility (`ledger.ts`, `room.ts`, `<domain>Gate.ts`).

## Testing Guidelines

No dedicated test framework is currently present. Before reporting changes as complete, run `pnpm typecheck` and `pnpm demo`. When adding tests, start with focused TypeScript tests for pure modules, especially schema parsing and gate behavior. Use behavior-focused names, for example `citationGate rejects unknown ids`.

## Commit & Pull Request Guidelines

Recent history uses concise Conventional Commit-style subjects such as `feat: ...`, `fix: ...`, and `test: ...`. Keep one logical change per commit. Pull requests should include a short description, commands run, changed environment variables, and sample CLI or UI output when pipeline behavior changes.

## Security & Configuration Tips

Do not commit `.env` or API keys. Start from `.env.example`, keep mock mode as the safe default, and confirm live model and provider settings before using `LUMEN_MOCK=0`. After renaming config keys, agents, providers, or models, search the whole repository for stale references.

## Agent-Specific Instructions

Preserve the central safety rules: downstream agents must cite existing fact IDs or statute IDs, and high-value, low-confidence, close-liability, or gate-failed cases should escalate to a human with the full packet for review.

---

<!-- fallow:setup-hooks:start -->
## Fallow local gate

Before any `git commit` or `git push`, run `pnpx fallow audit --format json --quiet --explain --gate-marker agent` from the repo root. If the verdict is `fail`, fix the reported findings before retrying. Treat JSON runtime errors like `{ "error": true, ... }` as non-blocking.

Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict. Inherited findings on touched files are reported under `attribution` and annotated with `introduced: false`, but do not block the commit. Set `[audit] gate = "all"` in `fallow.toml` to gate every finding in changed files.

The local `fallow.toml` scopes analysis to active code by ignoring the legacy TypeScript demo paths `src/**`, `server/**`, and `frontend/_legacy/**`, plus the root-only legacy dependencies listed under `ignoreDependencies`. Run `pnpx fallow` before handoff when changing frontend structure, and run the audit command before commits.

For non-skill agents, treat the task map below as the local onboarding source: run the listed `pnpx fallow` command before destructive edits, before commits, and before pull request handoff.

## Fallow task map

| When the agent is about to... | Run |
|---|---|
| delete an "unused" export or file | `pnpx fallow dead-code --trace <file>:<export>` |
| delete an "unused" dependency | `pnpx fallow dead-code --trace-dependency <name>` |
| commit or open a PR | `pnpx fallow audit --base <ref>` |
| prioritize refactoring | `pnpx fallow health --hotspots --targets` |
| ask who owns code | `pnpx fallow health --ownership` |
| check untested-but-reachable code | `pnpx fallow health --coverage-gaps` |
| consolidate duplication | `pnpx fallow dupes --trace dup:<fingerprint>` |
| find feature flags | `pnpx fallow flags` |
| surface security candidates | `pnpx fallow security` |
| understand a finding | `pnpx fallow explain <issue-type>` |
| scope a monorepo | `--workspace <glob> / --changed-workspaces <ref>` (global flags, prefix any command) |
<!-- fallow:setup-hooks:end -->
