# Repository Guidelines

## Project Structure & Module Organization

Lumen is an AI-assisted insurance subrogation recovery workflow. Read `docs/product-context.md` before changing product behavior, `docs/architecture.md` before changing system flow, and `docs/README.md` for the documentation map.

Current production code is `backend/` plus the active Next.js app in `frontend/`. `src/`, `server/`, and `frontend/_legacy/` are legacy demo/reference paths; avoid changing them unless the task explicitly targets legacy behavior. Sample claims and statutes live in `data/`.

## Build, Test, and Development Commands

- `pnpm install` installs dependencies from `pnpm-lock.yaml`.
- `./run.sh demo` runs the deterministic Python mock pipeline with no API keys.
- `./run.sh typecheck` smoke-imports the active Python backend packages.
- `./run.sh dev` starts the active FastAPI backend, arq worker, and Next.js frontend.
- `pnpm --dir frontend build` builds the active Next.js frontend.
- Legacy only: `pnpm demo`, `pnpm demo:live`, `pnpm serve`, `pnpm serve:live`, `pnpm typecheck`.

Keep mock mode working before changing live-provider behavior.

## Coding Style & Naming Conventions

Production Python code in `backend/` uses Pydantic v2 models, async-first FastAPI patterns, and strict typing. Avoid `Any`. Each lane owns a single folder; do not write across lane boundaries. Storage-layer Pydantic models live in `backend/schemas/`; pipeline-internal Pydantic models live in `backend/app/types.py`.

The legacy TypeScript demo (`src/`, `server/`) follows the original conventions: two-space indentation, single quotes, semicolons, named exports, concise interfaces, no `any`. Pure helpers for gate logic, prompts in `src/prompts.ts`, agent definitions in `src/agents.ts`, settings in `src/config.ts`. File naming by responsibility (`ledger.ts`, `room.ts`, `<domain>Gate.ts`).

## Testing Guidelines

No dedicated test framework is currently present. Before reporting current-flow changes as complete, run `./run.sh typecheck`, `./run.sh demo`, and relevant frontend checks from `frontend/` such as `pnpm exec tsc --noEmit` and `pnpm build`. Only run root `pnpm typecheck` or `pnpm demo` when the legacy TypeScript demo is in scope. When adding tests, start with focused tests for pure modules, especially schema parsing and gate behavior. Use behavior-focused names, for example `citationGate rejects unknown ids`.

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

The local `fallow.toml` ignores legacy demo paths and root-only legacy dependencies. Run `pnpx fallow` before frontend-structure handoff, `pnpx react-compiler-marker` before active React handoff, and the audit command before commits.

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
| verify active React Compiler compatibility | `pnpx react-compiler-marker` |
| consolidate duplication | `pnpx fallow dupes --trace dup:<fingerprint>` |
| find feature flags | `pnpx fallow flags` |
| surface security candidates | `pnpx fallow security` |
| understand a finding | `pnpx fallow explain <issue-type>` |
| scope a monorepo | `--workspace <glob> / --changed-workspaces <ref>` (global flags, prefix any command) |
<!-- fallow:setup-hooks:end -->
